import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_WING_PACKAGE_NAMES,
  createPhoenixWingSourceAliases,
  createPhoenixWingTypePaths,
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
    fs.writeFileSync(path.join(packageRoot, "src", "index.ts"), "export {};\n");
    fs.writeFileSync(path.join(packageRoot, "dist", "index.js"), "export {};\n");
    const hasUi = packageName === "@phoenix-wing/code-core";
    if (hasUi) {
      fs.mkdirSync(path.join(packageRoot, "src", "ui"), { recursive: true });
      fs.writeFileSync(path.join(packageRoot, "src", "ui", "index.ts"), "export {};\n");
      fs.writeFileSync(path.join(packageRoot, "src", "ui", "fixture-model.ts"), "export {};\n");
    }
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: packageName,
        exports: {
          ".": { import: "./dist/index.js" },
          ...(hasUi
            ? {
                "./ui": { import: "./dist/ui/index.js" },
                "./ui/fixture-model": { import: "./dist/ui/fixture-model.js" },
              }
            : {}),
        },
      }),
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
      .toThrow(/pnpm dev/u);
  });

  it("Web alias 覆盖 aggregate、保留的七个包和长子路径优先，不再要求 Codegen", () => {
    const { wingRoot } = createWingFixture();
    const aliases = createPhoenixWingSourceAliases(wingRoot);
    expect(aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({ find: "phoenix-wing", replacement: path.join(wingRoot, "src") }),
      expect.objectContaining({
        find: "@phoenix-wing/git-node",
        replacement: path.join(wingRoot, "packages/git-node/src"),
      }),
      expect.objectContaining({
        find: "@phoenix-wing/code-core",
        replacement: path.join(wingRoot, "packages/code-core/src"),
      }),
    ]));
    expect(aliases.some(({ find }) => find instanceof RegExp && find.test("@phoenix-wing/code-core/fixtures/a.json")))
      .toBe(true);
    expect(aliases).toContainEqual({
      find: "@phoenix-wing/code-core/ui/fixture-model",
      replacement: path.join(
        wingRoot,
        "packages/code-core/src/ui/fixture-model.ts",
      ),
    });
    expect(aliases.findIndex(({ find }) => find === "@phoenix-wing/code-core/ui/fixture-model"))
      .toBeLessThan(aliases.findIndex(({ find }) => find === "@phoenix-wing/code-core/ui"));
    expect(LOCAL_WING_PACKAGE_NAMES).toHaveLength(7);
    expect(LOCAL_WING_PACKAGE_NAMES).not.toContain("@phoenix-wing/kt-codegen");
  });

  it("Node resolver 按本地 package exports 命中 dist", () => {
    const { wingRoot } = createWingFixture();
    expect(resolveLocalWingExport(wingRoot, "@phoenix-wing/code-core"))
      .toBe(path.join(wingRoot, "packages/code-core/dist/index.js"));
    expect(resolveLocalWingExport(wingRoot, "@phoenix-wing/kt-codegen")).toBeNull();
    expect(resolveLocalWingExport(wingRoot, "@phoenix-wing/git-node"))
      .toBe(path.join(wingRoot, "packages/git-node/dist/index.js"));
    expect(resolveLocalWingExport(wingRoot, "element-plus")).toBeNull();
  });
});

it("local typecheck resolves aggregate and Vue declarations from public exports, never the Registry install", () => {
  const { wingRoot } = createWingFixture();
  for (const relative of [".", ...LOCAL_WING_PACKAGE_NAMES.map(name => `packages/${name.slice("@phoenix-wing/".length)}`)]) {
    const root = path.join(wingRoot, relative), manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.exports["."].types = "./dist/index.d.ts";
    if (relative === ".") manifest.exports["./layout/*.vue"] = { types: "./dist/layout/*.vue.d.ts", import: "./dist/layout/*.js" };
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    fs.writeFileSync(path.join(root, "dist/index.d.ts"), "export {};\n");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  }
  const paths = createPhoenixWingTypePaths(wingRoot);
  expect(paths["phoenix-wing"]).toEqual([path.join(wingRoot, "dist/index.d.ts")]);
  expect(paths["phoenix-wing/layout/*.vue"]).toEqual([path.join(wingRoot, "dist/layout/*.vue.d.ts")]);
  expect(paths["@phoenix-wing/cad-core"]).toEqual([path.join(wingRoot, "packages/cad-core/dist/index.d.ts")]);
  expect(paths).not.toHaveProperty("phoenix-wing/*"); // Do not expose private internals through a catch-all.
  fs.unlinkSync(path.join(wingRoot, "dist/index.d.ts"));
  expect(() => createPhoenixWingTypePaths(wingRoot)).toThrow("公开类型缺失");
});
