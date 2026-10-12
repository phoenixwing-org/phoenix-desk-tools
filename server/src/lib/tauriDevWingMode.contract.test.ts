import fs from "node:fs";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return fs.readFileSync(new URL(relative, import.meta.url), "utf8");
}

// A bounded source contract, not a Rust parser or native dev launch. The release
// isolation branch must not broaden this check beyond the debug launcher.
function developmentBackend(source: string): string {
  const startMarker = "#[cfg(debug_assertions)]\nfn backend_command(";
  const endMarker = "#[cfg(not(debug_assertions))]\nfn backend_command(";
  if (source.split(startMarker).length !== 2 || source.split(endMarker).length !== 2) {
    throw new Error("expected exactly one debug and one release backend boundary");
  }
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker);
  if (end <= start) throw new Error("debug backend boundary must precede release backend");
  return source.slice(start, end);
}

function assertLoaderInherited(source: string): void {
  const backend = developmentBackend(source);
  expect(backend).not.toContain(".env_clear()");
  expect(backend).not.toContain('env_remove("NODE_OPTIONS")');
  expect(backend).toContain('.env("PHOENIX_REPO_ROOT", &root)');
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
    assertLoaderInherited(tauriSource);
  });

  it.each([".env_clear()", '.env_remove("NODE_OPTIONS")'])("仍拒绝开发分支移除 loader：%s", operation => {
    const target = '.env("PHOENIX_REPO_ROOT", &root);';
    expect(developmentBackend(tauriSource)).toContain(target);
    const modified = tauriSource.replace(target, `.env("PHOENIX_REPO_ROOT", &root)${operation};`);
    expect(() => assertLoaderInherited(modified)).toThrow();
  });

  it("无法识别开发边界时不降级为全文件搜索或静默通过", () => {
    expect(() => developmentBackend(tauriSource.replace("#[cfg(debug_assertions)]", "#[cfg(independent_test)]"))).toThrow();
  });
});
