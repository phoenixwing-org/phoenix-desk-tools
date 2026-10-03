import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeFreecadCommand,
  buildFreecadChildEnvironment,
  hasSafeFreecadCommand,
  normalizeFreecadDirectoryPreference,
  redactSensitiveJson,
  redactSensitiveText,
  resolveFreecadCommand,
  truncateExternalProcessText,
} from "./freecadProcessSecurity.js";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freecad-process-security-"));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, relativePath: string): string {
  const filename = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, "fixture\n", "utf8");
  return filename;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("FreeCAD process security", () => {
  it("resolves the internal CLI and rejects the macOS GUI launcher, including through a symlink", () => {
    const root = makeTempRoot();
    const app = path.join(root, "FreeCAD.app");
    const cli = writeFile(root, "FreeCAD.app/Contents/Resources/bin/freecadcmd");
    const gui = writeFile(root, "FreeCAD.app/Contents/MacOS/FreeCAD");
    const disguised = path.join(root, "freecadcmd");
    const cliAlias = path.join(root, "freecadcmd-cli");
    fs.symlinkSync(gui, disguised);
    fs.symlinkSync(cli, cliAlias);

    const canonicalCli = fs.realpathSync.native(cli);
    expect(resolveFreecadCommand(app)).toBe(canonicalCli);
    expect(resolveFreecadCommand("", cliAlias)).toBe(canonicalCli);
    expect(() => resolveFreecadCommand("", gui)).toThrow(/GUI launcher/i);
    expect(() => resolveFreecadCommand(gui)).toThrow(/GUI launcher/i);
    expect(() => resolveFreecadCommand("", disguised)).toThrow(/GUI launcher/i);
    expect(() => assertSafeFreecadCommand(gui)).toThrow(/Contents\/Resources\/bin\/freecadcmd/i);
    expect(normalizeFreecadDirectoryPreference(app)).toBe(app);
    expect(normalizeFreecadDirectoryPreference("")).toBe("");
    expect(hasSafeFreecadCommand(app)).toBe(true);
    expect(hasSafeFreecadCommand(root)).toBe(false);
    expect(() => normalizeFreecadDirectoryPreference(gui)).toThrow(/GUI launcher/i);
  });

  it("constructs a minimal child environment without mutating or forwarding caller credentials", () => {
    const source = {
      PATH: "/usr/bin:/bin",
      path: "/untrusted/lowercase-path",
      HOME: "/tmp/example-home",
      TMPDIR: "/tmp/example-temp",
      LANG: "zh_CN.UTF-8",
      NODE_OPTIONS: "--test-only-option",
      PHOENIX_FREECAD_CMD: "/test/freecadcmd",
      EXAMPLE_API_KEY: "unit-test-sensitive-value",
      EXAMPLE_AUTH_TOKEN: "unit-test-auth-value",
    };
    const snapshot = { ...source };
    const child = buildFreecadChildEnvironment(source, {
      FCD_BATCH_STEP_DIR: "/tmp/step",
      FCD_BATCH_OUT_DIR: "/tmp/out",
    });

    expect(source).toEqual(snapshot);
    expect(child).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/tmp/example-home",
      TMPDIR: "/tmp/example-temp",
      LANG: "zh_CN.UTF-8",
      QT_QPA_PLATFORM: "offscreen",
      FCD_BATCH_STEP_DIR: "/tmp/step",
      FCD_BATCH_OUT_DIR: "/tmp/out",
    });
    expect(Object.keys(child)).not.toContain("EXAMPLE_API_KEY");
    expect(Object.keys(child)).not.toContain("EXAMPLE_AUTH_TOKEN");
    expect(Object.keys(child)).not.toContain("NODE_OPTIONS");
    expect(Object.keys(child)).not.toContain("PHOENIX_FREECAD_CMD");
    if (process.platform !== "win32") expect(Object.keys(child)).not.toContain("path");
    expect(() => buildFreecadChildEnvironment(source, {
      EXAMPLE_TOKEN: "unit-test-value",
    })).toThrow(/not allowed/i);
  });

  it("redacts credential-shaped values from text and JSON while preserving diagnostics", () => {
    const sentinel = "unit-test-sensitive-value";
    const input = [
      `EXAMPLE_API_KEY=${sentinel}`,
      `"EXAMPLE_AUTH_TOKEN": "${sentinel}"`,
      `Authorization: Bearer ${sentinel}`,
      `Cookie: session=${sentinel}; other=value`,
      `https://example-user:${sentinel}@example.invalid/resource`,
      "[phoenix] OK=2 skip=1 fail=0 total=3",
    ].join("\n");
    const sanitized = redactSensitiveText(input);

    expect(sanitized).not.toContain(sentinel);
    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).toContain("[phoenix] OK=2 skip=1 fail=0 total=3");
    expect(redactSensitiveJson({
      EXAMPLE_TOKEN: sentinel,
      nested: { message: `EXAMPLE_PASSWORD=${sentinel}`, safe: "kept" },
    })).toEqual({
      EXAMPLE_TOKEN: "[REDACTED]",
      nested: { message: "EXAMPLE_PASSWORD=[REDACTED]", safe: "kept" },
    });
  });

  it("caps external output while retaining both the diagnostic header and final summary", () => {
    const input = `header\n${"x".repeat(400_000)}\n[phoenix] OK=1 skip=0 fail=0 total=1`;
    const result = truncateExternalProcessText(input, 32_000);
    expect(result.length).toBeLessThanOrEqual(32_000);
    expect(result).toContain("header");
    expect(result).toContain("output truncated");
    expect(result).toContain("[phoenix] OK=1 skip=0 fail=0 total=1");
  });

  it("keeps the manual STEP runner on an empty allowlisted environment and rejects the GUI", () => {
    const root = makeTempRoot();
    const stepDir = path.join(root, "step");
    const outDir = path.join(root, "out");
    const fakeCommand = writeFile(root, "FreeCAD.app/Contents/Resources/bin/freecadcmd");
    fs.writeFileSync(fakeCommand, [
      "#!/usr/bin/env bash",
      '[[ -z "${EXAMPLE_API_KEY-}" ]] || exit 91',
      'printf "SAFE_CHILD=%s|%s|%s|%s\\n" "$FCD_BATCH_STEP_DIR" "$FCD_BATCH_OUT_DIR" "$QT_QPA_PLATFORM" "${EXAMPLE_API_KEY-unset}"',
    ].join("\n"));
    fs.chmodSync(fakeCommand, 0o755);
    const runner = path.resolve(process.cwd(), "../scripts/example_run_step_batch.sh");
    const result = spawnSync("bash", [runner], {
      encoding: "utf8",
      env: {
        ...process.env,
        EXAMPLE_API_KEY: "unit-test-sensitive-value",
        FREECADCMD: fakeCommand,
        OUT_DIR: outDir,
        STEP_DIR: stepDir,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`SAFE_CHILD=${stepDir}|${outDir}|offscreen|unset`);
    expect(result.stdout).not.toContain("unit-test-sensitive-value");

    const gui = writeFile(root, "FreeCAD.app/Contents/MacOS/FreeCAD");
    fs.chmodSync(gui, 0o755);
    const rejected = spawnSync("bash", [runner], {
      encoding: "utf8",
      env: { ...process.env, FREECADCMD: gui, OUT_DIR: outDir, STEP_DIR: stepDir },
    });
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toMatch(/GUI launcher/i);
  });
});
