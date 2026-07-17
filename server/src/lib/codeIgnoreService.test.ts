import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  effectiveCodeIgnorePatterns,
  getCodeIgnorePrefs,
  listCodeIgnoreSuggestions,
  patternsToSeedFromSuggestions,
  saveCodeIgnorePrefs,
} from "./codeIgnoreService.js";
import { loadWorkspacePrefs } from "./workspacePrefsService.js";

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-ignore-service-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("codeIgnoreService", () => {
  it("returns frontend-shaped prefs with file, legacy, builtin, and custom patterns", () => {
    const workspace = makeTempRoot();
    const prefsDir = makeTempRoot();
    fs.mkdirSync(path.join(workspace, ".phoenix"));
    fs.writeFileSync(path.join(workspace, ".phoenix", "reorder-members.ignore"), "LegacySkip\n", "utf8");

    const saved = saveCodeIgnorePrefs(workspace, { custom_ignore: ["CustomSkip", "LegacySkip"], ignore_preset: "caa" }, { prefsDir });

    expect(saved.ignore_preset).toBe("caa");
    expect(saved.custom_ignore).toEqual(["CustomSkip", "LegacySkip"]);
    expect(saved.ignore_file_exists).toBe(false);
    expect(saved.legacy_ignore_sources[0]).toMatchObject({ filename: "reorder-members.ignore", patterns: ["LegacySkip"] });
    expect(saved.ignore_builtin).toContain("node_modules");
    expect(saved.ignore_custom_patterns).toContain("ImportedInterfaces");
    expect(saved.ignore_patterns).toEqual(expect.arrayContaining(["LegacySkip", "CustomSkip", "ImportedInterfaces"]));
    expect(saved.consumers).toContain("code_uuid");
    const workspacePrefs = loadWorkspacePrefs(workspace);
    expect(workspacePrefs.code_ignore).toMatchObject({ custom_ignore: ["CustomSkip", "LegacySkip"], ignore_preset: "caa", process_dirs_seeded: true });
  });

  it("suggests unignored top-level process dirs and dedupes seed patterns", () => {
    const workspace = makeTempRoot();
    const prefsDir = makeTempRoot();
    fs.mkdirSync(path.join(workspace, "artifacts"));
    fs.mkdirSync(path.join(workspace, "build-ui"));
    fs.mkdirSync(path.join(workspace, "src"));

    const suggestions = listCodeIgnoreSuggestions(workspace, { prefsDir });

    expect(suggestions.suggestions.map((s) => s.name)).toEqual(["artifacts"]);
    expect(suggestions.suggested_patterns).toEqual(["artifacts"]);
    expect(patternsToSeedFromSuggestions([
      { name: "build-a", kind: "dir", reason: "process_dir", repo_rel_path: "build-a", suggested_pattern: "build-*" },
      { name: "build-b", kind: "dir", reason: "process_dir", repo_rel_path: "build-b", suggested_pattern: "build-*" },
    ])).toEqual(["build-*"]);

    saveCodeIgnorePrefs(workspace, { custom_ignore: ["artifacts"] }, { prefsDir });
    expect(listCodeIgnoreSuggestions(workspace, { prefsDir }).suggestions).toEqual([]);
    expect(effectiveCodeIgnorePatterns(workspace, { prefsDir })).toContain("artifacts");
  });

  it("auto-seeds newly detected process directories exactly once", () => {
    const workspace = makeTempRoot();
    const prefsDir = makeTempRoot();
    fs.mkdirSync(path.join(workspace, "artifacts"));
    fs.mkdirSync(path.join(workspace, "target"));
    fs.mkdirSync(path.join(workspace, "build-ui"));

    expect(effectiveCodeIgnorePatterns(workspace, { prefsDir })).not.toContain("artifacts");
    expect(fs.existsSync(path.join(workspace, ".phoenix"))).toBe(false);
    expect(fs.existsSync(path.join(workspace, ".phoenix", "phoenix-workspace-prefs.json"))).toBe(false);

    const first = getCodeIgnorePrefs(workspace, { prefsDir });
    expect(first.process_dirs_auto_seeded).toEqual(["artifacts", "target"]);
    expect(first.process_dirs_seeded).toBe(true);
    expect(first.custom_ignore).toEqual(["artifacts", "target"]);
    expect(first.process_dir_suggestions).toEqual([]);

    fs.mkdirSync(path.join(workspace, "bld"));
    const second = getCodeIgnorePrefs(workspace, { prefsDir });
    expect(second.process_dirs_auto_seeded).toEqual([]);
    expect(second.custom_ignore).toEqual(["artifacts", "target"]);
    expect(second.process_dir_suggestions.map((item) => item.name)).toEqual(["bld"]);
  });

  it("reads the migration-era global store and writes it into workspace prefs on save", () => {
    const workspace = makeTempRoot();
    const prefsDir = makeTempRoot();
    fs.writeFileSync(path.join(prefsDir, "code-ignore.json"), JSON.stringify({
      byWorkspace: {
        [path.resolve(workspace)]: { custom_ignore: ["LegacyGlobal"], ignore_preset: "" },
      },
    }), "utf8");

    const legacy = getCodeIgnorePrefs(workspace, { prefsDir }, { autoSeed: false });
    expect(legacy.custom_ignore).toEqual(["LegacyGlobal"]);
    const saved = saveCodeIgnorePrefs(workspace, { custom_ignore: ["LegacyGlobal", "WorkspaceOnly"] }, { prefsDir });
    expect(saved.custom_ignore).toEqual(["LegacyGlobal", "WorkspaceOnly"]);
    const stored = loadWorkspacePrefs(workspace);
    expect((stored.code_ignore as any).custom_ignore).toEqual(["LegacyGlobal", "WorkspaceOnly"]);
  });

  it("keeps read-only scan consumers usable when the workspace preference database cannot open", () => {
    const workspace = makeTempRoot();
    const prefsDir = makeTempRoot();
    const phoenixDir = path.join(workspace, ".phoenix");
    fs.mkdirSync(phoenixDir);
    fs.mkdirSync(path.join(phoenixDir, "phoenix-workspace.sqlite"));
    fs.writeFileSync(path.join(phoenixDir, "code.ignore"), "GeneratedByTeam\n", "utf8");

    const patterns = effectiveCodeIgnorePatterns(workspace, { prefsDir });

    expect(patterns).toContain("node_modules");
    expect(patterns).toContain("GeneratedByTeam");
  });
});
