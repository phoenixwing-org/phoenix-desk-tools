import fs from "node:fs";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return fs.readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("Tauri dev Wing 真源契约", () => {
  const packageJson = JSON.parse(read("../../../package.json"));
  const tauriSource = read("../../../src-tauri/src/lib.rs");

  it("默认 Tauri dev 使用 Registry Wing，本地联调使用 tauri:wing", () => {
    expect(packageJson.scripts["tauri:dev"]).toBe(
      "node scripts/run-with-phoenix-wing.mjs registry -- node scripts/run-tauri-dev.mjs",
    );
    expect(packageJson.scripts["tauri:wing"]).toBe(
      "node scripts/run-with-phoenix-wing.mjs local -- pnpm run tauri:dev:local-wing-services",
    );
    expect(packageJson.scripts["tauri:dev:local-wing-services"]).toBe(
      "pnpm brand:sync && node scripts/run-tauri-dev.mjs",
    );
    expect(packageJson.scripts["brand:sync"]).toBe(
      "node scripts/sync-phoenix-wing-brand-assets.mjs",
    );
    expect(packageJson.scripts["tauri:dev:registry"]).toBeUndefined();
  });

  it("Rust 开发态 Node 子进程继承包装器注入的 loader 环境", () => {
    expect(tauriSource).not.toContain(".env_clear()");
    expect(tauriSource).not.toContain('env_remove("NODE_OPTIONS")');
    expect(tauriSource).toContain('.env("PHOENIX_REPO_ROOT", &root)');
  });
});
