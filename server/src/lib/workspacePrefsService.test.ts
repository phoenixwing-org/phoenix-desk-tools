import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import {
  loadWorkspacePrefs,
  loadWorkspacePrefsSnapshot,
  loadWorkspaceSection,
  saveWorkspaceSection,
  workspacePrefsStorageInfo,
} from "./workspacePrefsService.js";

const roots: string[] = [];

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-prefs-service-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("workspace preference SQLite service", () => {
  it("imports the legacy JSON once and then treats SQLite as authoritative", () => {
    const root = workspace();
    const jsonPath = path.join(root, ".phoenix", "phoenix-workspace-prefs.json");
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify({
      version: 7,
      PartVersion: 3,
      code_ignore: { custom_ignore: ["build"] },
      nav_modules: { scope: "code" },
    }), "utf8");

    expect(loadWorkspacePrefs(root)).toMatchObject({
      version: 7,
      PartVersion: 3,
      code_ignore: { custom_ignore: ["build"] },
      nav_modules: { scope: "code" },
    });

    fs.writeFileSync(jsonPath, JSON.stringify({
      code_ignore: { custom_ignore: ["stale-json"] },
    }), "utf8");
    expect(loadWorkspaceSection(root, "code_ignore", { custom_ignore: [] })).toEqual({
      custom_ignore: ["build"],
    });

    const info = workspacePrefsStorageInfo(root);
    expect(info).toMatchObject({ storage: "sqlite", legacy_json_path: jsonPath });
    const db = pnwCreateDb(info.database_path);
    try {
      const sections = db.all<{ section: string }>(
        "SELECT section FROM phoenix_workspace_pref ORDER BY section",
      ).map((row) => row.section);
      expect(sections).toEqual(["__meta__", "code_ignore", "nav_modules"]);
    } finally {
      db.close();
    }
  });

  it("merges one section without replacing others and deletes null-valued keys", () => {
    const root = workspace();
    expect(saveWorkspaceSection(
      root,
      "code_rename",
      { old: "A", new: "B", remove_me: true },
      { old: "", new: "" },
    )).toEqual({ old: "A", new: "B", remove_me: true });
    saveWorkspaceSection(root, "code_ignore", { custom_ignore: ["out"] }, { custom_ignore: [] });

    expect(saveWorkspaceSection(
      root,
      "code_rename",
      { new: "C", remove_me: null },
      { old: "", new: "" },
    )).toEqual({ old: "A", new: "C" });
    expect(loadWorkspacePrefs(root)).toMatchObject({
      code_rename: { old: "A", new: "C" },
      code_ignore: { custom_ignore: ["out"] },
    });
  });

  it("initializes a meta marker even without legacy JSON", () => {
    const root = workspace();
    expect(loadWorkspacePrefs(root)).toEqual({});
    const db = pnwCreateDb(workspacePrefsStorageInfo(root).database_path);
    try {
      expect(db.get<{ section: string }>(
        "SELECT section FROM phoenix_workspace_pref WHERE section = '__meta__'",
      )?.section).toBe("__meta__");
    } finally {
      db.close();
    }
  });

  it("reads a disposable snapshot without initializing or locking the workspace database", () => {
    const root = workspace();
    const phoenixDir = path.join(root, ".phoenix");
    const legacyPath = path.join(phoenixDir, "phoenix-workspace-prefs.json");
    const databasePath = path.join(phoenixDir, "phoenix-workspace.sqlite");
    fs.mkdirSync(phoenixDir, { recursive: true });
    fs.writeFileSync(legacyPath, JSON.stringify({ code_ignore: { custom_ignore: ["legacy"] } }), "utf8");

    expect(loadWorkspacePrefsSnapshot(root)).toMatchObject({
      code_ignore: { custom_ignore: ["legacy"] },
    });
    expect(fs.existsSync(databasePath)).toBe(false);

    loadWorkspacePrefs(root);
    const before = fs.statSync(databasePath);
    expect(loadWorkspacePrefsSnapshot(root)).toMatchObject({
      code_ignore: { custom_ignore: ["legacy"] },
    });
    const after = fs.statSync(databasePath);
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(fs.existsSync(`${databasePath}.lock`)).toBe(false);
  });

  it("retries when the preference database changes while it is copied", () => {
    const root = workspace();
    saveWorkspaceSection(root, "code_ignore", { custom_ignore: ["before"] }, { custom_ignore: [] });
    const databasePath = workspacePrefsStorageInfo(root).database_path;
    const originalCopy = fs.copyFileSync.bind(fs);
    let injectedUpdate = false;
    const copySpy = vi.spyOn(fs, "copyFileSync").mockImplementation((source, destination, mode) => {
      originalCopy(source, destination, mode);
      if (String(source) !== databasePath || injectedUpdate) return;
      injectedUpdate = true;
      const db = pnwCreateDb(databasePath);
      try {
        db.run(
          "UPDATE phoenix_workspace_pref SET value_json = ? WHERE section = ?",
          [JSON.stringify({ custom_ignore: ["after"] }), "code_ignore"],
        );
      } finally {
        db.close();
      }
    });

    try {
      expect(loadWorkspacePrefsSnapshot(root)).toMatchObject({
        code_ignore: { custom_ignore: ["after"] },
      });
      expect(copySpy).toHaveBeenCalledTimes(2);
    } finally {
      copySpy.mockRestore();
    }
  });

  it("reuses an immutable-by-copy snapshot until the database signature changes", () => {
    const root = workspace();
    saveWorkspaceSection(root, "code_ignore", { custom_ignore: ["before"] }, { custom_ignore: [] });
    const first = loadWorkspacePrefsSnapshot(root);
    (first.code_ignore as { custom_ignore: string[] }).custom_ignore.push("caller-mutation");

    expect(loadWorkspacePrefsSnapshot(root)).toMatchObject({
      code_ignore: { custom_ignore: ["before"] },
    });

    saveWorkspaceSection(root, "code_ignore", { custom_ignore: ["after"] }, { custom_ignore: [] });
    expect(loadWorkspacePrefsSnapshot(root)).toMatchObject({
      code_ignore: { custom_ignore: ["after"] },
    });
  });

  it("does not follow a symlink masquerading as the workspace preference database", () => {
    const root = workspace();
    const outside = workspace();
    saveWorkspaceSection(outside, "code_ignore", { custom_ignore: ["outside"] }, { custom_ignore: [] });
    const phoenixDir = path.join(root, ".phoenix");
    fs.mkdirSync(phoenixDir, { recursive: true });
    fs.symlinkSync(
      workspacePrefsStorageInfo(outside).database_path,
      path.join(phoenixDir, "phoenix-workspace.sqlite"),
    );

    expect(() => loadWorkspacePrefsSnapshot(root)).toThrow("not a regular file");
  });

  it("rejects invalid workspaces and section names", () => {
    const root = workspace();
    expect(() => loadWorkspacePrefs(path.join(root, "missing"))).toThrow("Not a valid workspace");
    expect(() => loadWorkspaceSection(root, "../bad", {})).toThrow("Invalid workspace preference section");
  });
});
