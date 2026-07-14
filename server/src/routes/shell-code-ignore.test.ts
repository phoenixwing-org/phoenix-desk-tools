import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWorkspacePrefs } from "../lib/workspacePrefsService.js";

const tempRoots: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function makeTempRoot(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(root);
  return root;
}

async function importShellRoutes(home: string, workspace: string) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const prefsDir = path.join(home, ".phoenix");
  fs.mkdirSync(prefsDir, { recursive: true });
  fs.writeFileSync(
    path.join(prefsDir, "launcher-prefs.json"),
    JSON.stringify({ recent_workspaces: [workspace], freecad_dir: "", workspace }, null, 2),
    "utf8",
  );
  vi.resetModules();
  return import("./shell.js");
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("shell code ignore routes", () => {
  it("serves frontend-shaped prefs, saves custom ignore, and lists process dir suggestions", async () => {
    const home = makeTempRoot("shell-code-ignore-home-");
    const workspace = makeTempRoot("shell-code-ignore-ws-");
    fs.mkdirSync(path.join(workspace, "artifacts"));
    fs.mkdirSync(path.join(workspace, "build-ui"));

    const { shellRoutes } = await importShellRoutes(home, workspace);

    const prefsRes = await shellRoutes.request("/api/code/ignore/prefs");
    expect(prefsRes.status).toBe(200);
    const prefs = await prefsRes.json();
    expect(prefs.workspace_path).toBe(workspace);
    expect(prefs.ignore_builtin).toContain("build-*");
    expect(prefs.ignore_patterns).toContain("node_modules");
    expect(prefs.process_dirs_auto_seeded).toEqual(["artifacts"]);
    expect(prefs.process_dirs_seeded).toBe(true);
    expect(prefs.custom_ignore).toEqual(["artifacts"]);
    expect(prefs.process_dir_suggestions).toEqual([]);

    const suggestionsRes = await shellRoutes.request("/api/code/ignore/suggestions");
    const suggestions = await suggestionsRes.json();
    expect(suggestions.suggested_patterns).toEqual([]);

    const saveRes = await shellRoutes.request("/api/code/ignore/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ custom_ignore: ["artifacts"], ignore_preset: "caa" }),
    });
    expect(saveRes.status).toBe(200);
    const saved = await saveRes.json();
    expect(saved.custom_ignore).toEqual(["artifacts"]);
    expect(saved.ignore_custom_patterns).toContain("ImportedInterfaces");
    expect(saved.process_dir_suggestions).toEqual([]);
    const stored = loadWorkspacePrefs(workspace);
    expect(stored.code_ignore).toMatchObject({ custom_ignore: ["artifacts"], ignore_preset: "caa", process_dirs_seeded: true });
  });
});
