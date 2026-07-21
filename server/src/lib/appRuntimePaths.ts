import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function envPath(value: unknown): string {
  const raw = String(value || "").trim();
  return raw ? path.resolve(raw) : "";
}

export function runtimeRepoRoot(env: NodeJS.ProcessEnv = process.env): string {
  return envPath(env.PHOENIX_REPO_ROOT) || SOURCE_REPO_ROOT;
}

export function runtimeResourcesDir(env: NodeJS.ProcessEnv = process.env): string {
  return envPath(env.PHOENIX_RESOURCES_DIR);
}

/** Centralized host home lookup for platform-standard paths outside Phoenix's writable runtime data. */
export function runtimeHomeDirectory(): string {
  return os.homedir();
}

export function runtimeUserDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return envPath(env.PHOENIX_USER_DATA_DIR) || path.join(runtimeHomeDirectory(), ".phoenix");
}

export function legacyRuntimeUserDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return envPath(env.PHOENIX_LEGACY_USER_DATA_DIR) || path.join(runtimeHomeDirectory(), ".phoenix");
}

export function runtimeIsPackaged(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PHOENIX_PACKAGED === "1";
}

export function runtimeTestFixtureCheckoutRoot(env: NodeJS.ProcessEnv = process.env): string {
  return runtimeIsPackaged(env)
    ? path.join(runtimeUserDataDir(env), "test-fixtures")
    : path.dirname(runtimeRepoRoot(env));
}

function firstExisting(candidates: string[]): string {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || candidates.find(Boolean) || "";
}

export function runtimeAppConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const resources = runtimeResourcesDir(env);
  return firstExisting([
    envPath(env.PHOENIX_APP_CONFIG_PATH),
    resources ? path.join(resources, "phoenix", "config", "app_config.json") : "",
    path.join(runtimeRepoRoot(env), "phoenix", "config", "app_config.json"),
  ]);
}

export function runtimeTestFixtureCatalogPath(env: NodeJS.ProcessEnv = process.env): string {
  const resources = runtimeResourcesDir(env);
  return firstExisting([
    envPath(env.PHOENIX_TEST_FIXTURE_CATALOG_PATH),
    resources ? path.join(resources, "phoenix", "config", "test_fixture_catalog.json") : "",
    path.join(runtimeRepoRoot(env), "phoenix", "config", "test_fixture_catalog.json"),
  ]);
}

export function runtimeScriptCandidates(filename: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const resources = runtimeResourcesDir(env);
  return [
    resources ? path.join(resources, "scripts", filename) : "",
    path.join(runtimeRepoRoot(env), "scripts", filename),
  ].filter(Boolean);
}

export function runtimeCatalogDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return envPath(env.PHOENIX_RUNTIME_CATALOG_PATH)
    || path.join(runtimeUserDataDir(env), "runtime-catalog.sqlite");
}

export type RuntimeUserDataMigration = {
  source: string;
  target: string;
  imported: string[];
  skipped: string[];
  errors: string[];
  completed: boolean;
};

export function migrateLegacyRuntimeUserData(env: NodeJS.ProcessEnv = process.env): RuntimeUserDataMigration {
  const source = legacyRuntimeUserDataDir(env);
  const target = runtimeUserDataDir(env);
  const result: RuntimeUserDataMigration = {
    source,
    target,
    imported: [],
    skipped: [],
    errors: [],
    completed: false,
  };
  if (path.resolve(source) === path.resolve(target)) {
    result.completed = true;
    return result;
  }

  const marker = path.join(target, ".legacy-user-data-import-v1.json");
  if (fs.existsSync(marker)) {
    result.completed = true;
    return result;
  }
  fs.mkdirSync(target, { recursive: true });
  if (fs.existsSync(source) && fs.statSync(source).isDirectory()) {
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const destination = path.join(target, entry.name);
      if (fs.existsSync(destination)) {
        result.skipped.push(entry.name);
        continue;
      }
      try {
        fs.cpSync(path.join(source, entry.name), destination, {
          recursive: entry.isDirectory(),
          errorOnExist: true,
          force: false,
        });
        result.imported.push(entry.name);
      } catch (error) {
        result.errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (result.errors.length === 0) {
    fs.writeFileSync(marker, `${JSON.stringify({
      schema_version: 1,
      source,
      imported: result.imported,
      skipped: result.skipped,
      completed_at: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
    result.completed = true;
  }
  return result;
}
