import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_WING_PACKAGE_NAMES,
  createPhoenixWingSourceAliases,
  resolveLocalWingExport,
  resolvePhoenixWingContext,
} from "../../scripts/phoenix-wing-mode.mjs";

const temporaryRoots: string[] = [];

function createWingFixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "desk-local-wing-"));
  temporaryRoots.push(parent);
  const deskRoot = path.join(parent, "phoenix-desk-tools");
  const wingRoot = path.join(parent, "phoenix-wing");
  fs.mkdirSync(deskRoot, { recursive: true });
  fs.mkdirSync(path.join(wingRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(wingRoot, "package.json"),
    JSON.stringify({ name: "phoenix-wing", exports: { ".": { import: "./dist/index.js" } } }),
  );
  for (const packageName of LOCAL_WING_PACKAGE_NAMES) {
    const packageDir = packageName.slice("@phoenix-wing/".length);
    const packageRoot = path.join(wingRoot, "packages", packageDir);
    fs.mkdirSync(path.join(packageRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "dist", "index.js"), "export {};\n");
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: packageName, exports: { ".": { import: "./dist/index.js" } } }),
    );
  }
  return { deskRoot, wingRoot };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Phoenix Wing 并列仓库模式", () => {
  it("local 默认严格解析 Desk 同级 phoenix-wing", () => {
    const { deskRoot, wingRoot } = createWingFixture();
    expect(resolvePhoenixWingContext(deskRoot, { PHOENIX_WING_MODE: "local" })).toEqual({
      mode: "local",
      root: wingRoot,
      configuredBy: "并列仓库 ../phoenix-wing",
    });
  });

  it("PHOENIX_WING_SRC 兼容入口归一为仓库根", () => {
    const { deskRoot, wingRoot } = createWingFixture();
    expect(resolvePhoenixWingContext(deskRoot, {
      PHOENIX_WING_MODE: "local",
      PHOENIX_WING_SRC: path.join(wingRoot, "src"),
    }))
      .toMatchObject({ mode: "local", root: wingRoot, configuredBy: "PHOENIX_WING_SRC（兼容）" });
  });

  it("未标 mode 时忽略残留路径并保持 Registry", () => {
    const { deskRoot, wingRoot } = createWingFixture();
    expect(resolvePhoenixWingContext(deskRoot, {
      PHOENIX_WING_ROOT: wingRoot,
      PHOENIX_WING_SRC: path.join(wingRoot, "src"),
    })).toMatchObject({ mode: "registry", root: null });
  });

  it("registry 显式模式忽略本地环境变量", () => {
    const { deskRoot } = createWingFixture();
    expect(resolvePhoenixWingContext(deskRoot, {
      PHOENIX_WING_MODE: "registry",
      PHOENIX_WING_ROOT: "/missing/wing",
      PHOENIX_WING_SRC: "/missing/wing/src",
    })).toEqual({
      mode: "registry",
      root: null,
      configuredBy: "package.json + pnpm-lock.yaml",
    });
  });

  it("local 缺失时停止并提示 Registry 对照命令", () => {
    const deskRoot = fs.mkdtempSync(path.join(os.tmpdir(), "desk-without-wing-"));
    temporaryRoots.push(deskRoot);
    expect(() => resolvePhoenixWingContext(deskRoot, { PHOENIX_WING_MODE: "local" }))
      .toThrow(/pnpm dev:registry/u);
  });

  it("Web alias 覆盖 aggregate、六个包及 kt-codegen 子路径", () => {
    const { wingRoot } = createWingFixture();
    const aliases = createPhoenixWingSourceAliases(wingRoot);
    expect(aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({ find: "phoenix-wing", replacement: path.join(wingRoot, "src") }),
      expect.objectContaining({
        find: "@phoenix-wing/kt-codegen",
        replacement: path.join(wingRoot, "packages/kt-codegen/src"),
      }),
    ]));
    expect(aliases.some(({ find }) => find instanceof RegExp && find.test("@phoenix-wing/kt-codegen/fixtures/a.json")))
      .toBe(true);
  });

  it("Node resolver 按本地 package exports 命中 dist", () => {
    const { wingRoot } = createWingFixture();
    expect(resolveLocalWingExport(wingRoot, "@phoenix-wing/kt-codegen"))
      .toBe(path.join(wingRoot, "packages/kt-codegen/dist/index.js"));
    expect(resolveLocalWingExport(wingRoot, "element-plus")).toBeNull();
  });
});
