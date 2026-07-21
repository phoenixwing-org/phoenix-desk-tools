import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  packagedRuntimeChecks,
  runPackagedRuntimeCheck,
} from "./packagedRuntimeTestService.js";

const roots: string[] = [];
const ENV_KEYS = [
  "PHOENIX_RESOURCES_DIR",
  "PHOENIX_USER_DATA_DIR",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "packaged-runtime-tests-"));
  roots.push(root);
  return root;
}

function writeFile(root: string, relative: string, content = "test"): string {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content, "utf8");
  return filename;
}

function hash(filename: string): string {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("packagedRuntimeTestService", () => {
  it("executes source, FCStd XML, and CAA checks without a source test runner", async () => {
    const modules = new Set([
      "runtime/code/source-codec",
      "runtime/code/reorder-members",
      "runtime/cad/fcstd-xml",
      "runtime/caa/dialog",
    ]);
    const results = [];
    for (const runtimeCheck of packagedRuntimeChecks().filter((item) => modules.has(item.module))) {
      results.push(await runPackagedRuntimeCheck(runtimeCheck));
    }

    expect(results).toHaveLength(6);
    expect(results.filter((result) => result.status !== "passed")).toEqual([]);
  });

  it("validates staged resources and writes only to the configured user data directory", async () => {
    const resources = tempRoot();
    const userData = path.join(tempRoot(), "user-data");
    process.env.PHOENIX_RESOURCES_DIR = resources;
    process.env.PHOENIX_USER_DATA_DIR = userData;

    const nodeFile = writeFile(resources, "node/node.bin", "node");
    const serverFile = writeFile(resources, "server/server.mjs", "server");
    writeFile(resources, "phoenix/config/app_config.json", JSON.stringify({
      navigation: [{ id: "home", page: "home" }, { id: "code", page: "code_index" }],
    }));
    writeFile(resources, "scripts/freecad_batch_step_runner.py", "# adapter");
    writeFile(resources, "scripts/sw-step-export.ps1", "# adapter");
    writeFile(resources, "runtime-manifest.json", JSON.stringify({
      schema_version: 1,
      platform: process.platform,
      arch: process.arch,
      node: { version: process.version, filename: path.basename(nodeFile), sha256: hash(nodeFile) },
      server: { filename: path.basename(serverFile), sha256: hash(serverFile) },
    }));

    const modules = new Set([
      "runtime/platform/package",
      "runtime/platform/user-data",
      "runtime/cad/external-adapters",
    ]);
    const results = [];
    for (const runtimeCheck of packagedRuntimeChecks().filter((item) => modules.has(item.module))) {
      results.push(await runPackagedRuntimeCheck(runtimeCheck));
    }

    expect(results).toHaveLength(5);
    expect(results.every((result) => result.status === "passed")).toBe(true);
    expect(fs.existsSync(userData)).toBe(true);
  });

  it("reports the system Git dependency", async () => {
    const runtimeCheck = packagedRuntimeChecks().find((item) => item.module === "runtime/platform/git")!;
    await expect(runPackagedRuntimeCheck(runtimeCheck)).resolves.toMatchObject({
      status: "passed",
      message: expect.stringMatching(/^git version /i),
    });
  });

  it("rejects legacy CAD Rust artifacts in the packaged runtime", async () => {
    const resources = tempRoot();
    process.env.PHOENIX_RESOURCES_DIR = resources;
    const nodeFile = writeFile(resources, "node/node.bin", "node");
    const serverFile = writeFile(resources, "server/server.mjs", "server");
    writeFile(resources, "bin/fcstd-read", "legacy");
    writeFile(resources, "runtime-manifest.json", JSON.stringify({
      schema_version: 1,
      platform: process.platform,
      arch: process.arch,
      node: { version: process.version, filename: path.basename(nodeFile), sha256: hash(nodeFile) },
      server: { filename: path.basename(serverFile), sha256: hash(serverFile) },
    }));

    const runtimeCheck = packagedRuntimeChecks().find((item) => item.module === "runtime/platform/package")!;
    await expect(runPackagedRuntimeCheck(runtimeCheck)).resolves.toMatchObject({
      status: "failed",
      message: "Packaged runtime must not contain a CAD native bin directory",
    });
  });
});
