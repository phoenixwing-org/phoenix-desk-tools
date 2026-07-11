import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runtimeAppConfigPath,
  runtimeCatalogDatabasePath,
  migrateLegacyRuntimeUserData,
  runtimeRepoRoot,
  runtimeScriptCandidates,
  runtimeTestFixtureCatalogPath,
  runtimeTestFixtureCheckoutRoot,
  runtimeUserDataDir,
} from "./appRuntimePaths.js";

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-runtime-paths-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("app runtime paths", () => {
  it("prefers explicit paths and keeps writable state outside packaged resources", () => {
    const root = tempRoot();
    const userData = path.join(root, "user-data");
    const explicitConfig = path.join(root, "custom-config.json");
    fs.writeFileSync(explicitConfig, "{}", "utf8");
    const env = {
      PHOENIX_REPO_ROOT: path.join(root, "repo"),
      PHOENIX_USER_DATA_DIR: userData,
      PHOENIX_APP_CONFIG_PATH: explicitConfig,
    } as NodeJS.ProcessEnv;

    expect(runtimeRepoRoot(env)).toBe(path.resolve(root, "repo"));
    expect(runtimeUserDataDir(env)).toBe(path.resolve(userData));
    expect(runtimeAppConfigPath(env)).toBe(path.resolve(explicitConfig));
    expect(runtimeCatalogDatabasePath(env)).toBe(path.join(path.resolve(userData), "runtime-catalog.sqlite"));
    expect(runtimeTestFixtureCheckoutRoot({ ...env, PHOENIX_PACKAGED: "1" })).toBe(path.join(path.resolve(userData), "test-fixtures"));
    expect(runtimeTestFixtureCheckoutRoot(env)).toBe(path.dirname(path.resolve(root, "repo")));
  });

  it("resolves packaged configuration, fixture catalog, and adapter scripts", () => {
    const resources = tempRoot();
    const configDir = path.join(resources, "phoenix", "config");
    const scriptsDir = path.join(resources, "scripts");
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "app_config.json"), "{}", "utf8");
    fs.writeFileSync(path.join(configDir, "test_fixture_catalog.json"), "[]", "utf8");
    fs.writeFileSync(path.join(scriptsDir, "runner.py"), "", "utf8");
    const env = { PHOENIX_RESOURCES_DIR: resources } as NodeJS.ProcessEnv;

    expect(runtimeAppConfigPath(env)).toBe(path.join(resources, "phoenix", "config", "app_config.json"));
    expect(runtimeTestFixtureCatalogPath(env)).toBe(path.join(resources, "phoenix", "config", "test_fixture_catalog.json"));
    expect(runtimeScriptCandidates("runner.py", env)[0]).toBe(path.join(resources, "scripts", "runner.py"));
  });

  it("keeps production modules from bypassing the runtime user data directory", () => {
    const sourceRoot = path.resolve(process.cwd(), "src");
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(filename);
        else if (entry.isFile() && filename.endsWith(".ts") && !filename.endsWith(".test.ts")) files.push(filename);
      }
    };
    visit(sourceRoot);

    const offenders = files
      .filter((filename) => path.basename(filename) !== "appRuntimePaths.ts")
      .filter((filename) => fs.readFileSync(filename, "utf8").includes("os.homedir()"))
      .map((filename) => path.relative(sourceRoot, filename).replace(/\\/g, "/"));
    expect(offenders).toEqual([]);
  });

  it("imports legacy user data once without replacing newer target files", () => {
    const root = tempRoot();
    const source = path.join(root, "legacy");
    const target = path.join(root, "tauri-data");
    fs.mkdirSync(path.join(source, "code-index"), { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(source, "launcher-prefs.json"), "legacy", "utf8");
    fs.writeFileSync(path.join(source, "code-index", "index.json"), "index", "utf8");
    fs.writeFileSync(path.join(source, "keep.json"), "legacy", "utf8");
    fs.writeFileSync(path.join(target, "keep.json"), "new", "utf8");
    const env = {
      PHOENIX_USER_DATA_DIR: target,
      PHOENIX_LEGACY_USER_DATA_DIR: source,
    } as NodeJS.ProcessEnv;

    const first = migrateLegacyRuntimeUserData(env);
    expect(first).toMatchObject({
      imported: ["code-index", "launcher-prefs.json"],
      skipped: ["keep.json"],
      errors: [],
      completed: true,
    });
    expect(fs.readFileSync(path.join(target, "keep.json"), "utf8")).toBe("new");
    expect(fs.readFileSync(path.join(target, "code-index", "index.json"), "utf8")).toBe("index");

    fs.writeFileSync(path.join(source, "late.json"), "late", "utf8");
    expect(migrateLegacyRuntimeUserData(env)).toMatchObject({ imported: [], completed: true });
    expect(fs.existsSync(path.join(target, "late.json"))).toBe(false);
  });
});
