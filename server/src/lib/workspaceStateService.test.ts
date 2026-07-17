import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import {
  loadWorkspaceNavModules,
  saveWorkspaceNavModules,
} from "./workspaceStateService.js";

const tempRoots: string[] = [];

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-state-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("workspace navigation state", () => {
  it("imports legacy JSON once and writes navigation state only to SQLite", () => {
    const workspace = makeWorkspace();
    const prefsFile = path.join(workspace, ".phoenix", "phoenix-workspace-prefs.json");
    fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
    fs.writeFileSync(prefsFile, JSON.stringify({ code_ignore: { custom_ignore: ["build"] } }));

    expect(saveWorkspaceNavModules(workspace, { enabled: ["code", "unknown", "code"] })).toEqual({
      scope: "code",
      enabled: ["code"],
    });
    expect(JSON.parse(fs.readFileSync(prefsFile, "utf8"))).toEqual({
      code_ignore: { custom_ignore: ["build"] },
    });

    const db = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
    try {
      const row = db.get<{ value_json: string }>(
        "SELECT value_json FROM phoenix_workspace_pref WHERE section = ?",
        ["nav_modules"],
      );
      expect(JSON.parse(String(row?.value_json))).toEqual({ scope: "code", enabled: ["code"] });
      const imported = db.get<{ value_json: string }>(
        "SELECT value_json FROM phoenix_workspace_pref WHERE section = ?",
        ["code_ignore"],
      );
      expect(JSON.parse(String(imported?.value_json))).toEqual({ custom_ignore: ["build"] });
    } finally {
      db.close();
    }
  });

  it("prefers migration-era SQLite state and derives scope consistently", () => {
    const workspace = makeWorkspace();
    const phoenixDir = path.join(workspace, ".phoenix");
    fs.mkdirSync(phoenixDir, { recursive: true });
    fs.writeFileSync(
      path.join(phoenixDir, "phoenix-workspace-prefs.json"),
      JSON.stringify({ nav_modules: { scope: "cad", enabled: ["cad"] } }),
    );
    const db = pnwCreateDb(path.join(phoenixDir, "phoenix-workspace.sqlite"));
    try {
      db.exec(`
        CREATE TABLE phoenix_workspace_pref (
          section TEXT PRIMARY KEY NOT NULL,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      db.run(
        "INSERT INTO phoenix_workspace_pref(section, value_json, updated_at) VALUES (?, ?, ?)",
        ["nav_modules", JSON.stringify({ scope: "code" }), new Date().toISOString()],
      );
    } finally {
      db.close();
    }

    expect(loadWorkspaceNavModules(workspace)).toEqual({ scope: "code", enabled: ["code"] });
    expect(saveWorkspaceNavModules(workspace, { scope: "invalid" })).toEqual({
      scope: "all",
      enabled: ["cad", "code"],
    });
  });
});
