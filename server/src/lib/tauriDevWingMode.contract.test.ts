import fs from "node:fs";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return fs.readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("Tauri dev Wing 真源契约", () => {
  const packageJson = JSON.parse(read("../../../package.json"));
  const tauriSource = read("../../../src-tauri/src/lib.rs");

  it("默认 Tauri dev 使用 Local Wing，并保留显式 Registry 对照入口", () => {
    expect(packageJson.scripts["tauri:dev"]).toBe(
      "node scripts/run-with-phoenix-wing.mjs local -- node scripts/run-tauri-dev.mjs",
    );
    expect(packageJson.scripts["tauri:dev:registry"]).toBe(
      "node scripts/run-with-phoenix-wing.mjs registry -- node scripts/run-tauri-dev.mjs",
    );
  });

  it("Rust 开发态 Node 子进程继承包装器注入的 loader 环境", () => {
    expect(tauriSource).not.toContain(".env_clear()");
    expect(tauriSource).not.toContain('env_remove("NODE_OPTIONS")');
    expect(tauriSource).toContain('.env("PHOENIX_REPO_ROOT", &root)');
  });
});
