import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensurePhoenixDatabase } from "../lib/phoenixDatabaseService.js";

const roots: string[] = [];
const retiredRoutes = [
  ["GET", "/api/code/index"],
  ["GET", "/api/code/index/catdlg"],
  ["POST", "/api/code/index/scan"],
  ["GET", "/api/code/index/entries"],
  ["GET", "/api/code/index/extension-discovery"],
  ["GET", "/api/code/index/extra-extensions"],
  ["PUT", "/api/code/index/extra-extensions"],
  ["POST", "/api/code/index/purge-missing"],
  ["POST", "/api/code/index/export-json"],
  ["GET", "/api/code/rename/prefs"],
  ["PUT", "/api/code/rename/prefs"],
  ["POST", "/api/code/rename/preview"],
  ["POST", "/api/code/rename/apply"],
  ["POST", "/api/code/uuid/scan"],
  ["POST", "/api/code/uuid/apply"],
  ["GET", "/api/code/reorder-members/prefs"],
  ["PUT", "/api/code/reorder-members/prefs"],
  ["POST", "/api/code/reorder-members/resolve"],
  ["POST", "/api/code/reorder-members/run"],
  ["POST", "/api/code/reorder-members/self-test"],
  ["GET", "/api/code/reorder-members/top-level"],
  ["GET", "/api/code/reorder-members/top-dirs"],
  ["GET", "/api/code/codegen/documents"],
  ["POST", "/api/code/codegen/open"],
  ["POST", "/api/code/codegen/document-state"],
  ["PUT", "/api/code/codegen/document"],
  ["POST", "/api/code/codegen/preflight"],
  ["POST", "/api/code/codegen/apply"],
  ["POST", "/api/code/codegen/source-preview"],
  ["POST", "/api/code/codegen/source-states"],
] as const;

function snapshot(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  function walk(relative: string) {
    const absolute = path.join(root, relative);
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      entries[`${relative}/`] = "directory";
      for (const name of fs.readdirSync(absolute).sort()) walk(path.join(relative, name));
    } else {
      entries[relative] = fs.readFileSync(absolute).toString("base64");
    }
  }
  walk("");
  return entries;
}

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "retired-code-routes-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const userData = path.join(root, "user-data");
  fs.mkdirSync(workspace);
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, "launcher-prefs.json"), JSON.stringify({
    workspace, recent_workspaces: [workspace], freecad_dir: "",
  }));
  fs.writeFileSync(path.join(workspace, "OldName.cpp"), "class OldName {};\n// 12345678-1234-1234-1234-123456789abc\n");
  fs.writeFileSync(path.join(workspace, "Sample.CATDlg"), "CATDlgDialog PreservedDialog {\nCATDlgPushButton ApplyButton;\n}\n");
  const database = ensurePhoenixDatabase(workspace);
  const db = pnwCreateDb(database);
  try {
    db.run("INSERT INTO phoenix_code_file_asset(repo_rel_path, filename, asset_kind, file_ext, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["OldName.cpp", "OldName.cpp", "cpp", ".cpp", "2026-01-01T00:00:00Z"]);
    db.run("INSERT INTO phoenix_code_scan(scanned_at, scan_root, stats_json) VALUES (?, ?, ?)",
      ["2026-01-01T00:00:00Z", workspace, '{"total":1}']);
    for (const section of ["code_rename", "reorder_members", "kt_codegen"]) {
      db.run("INSERT INTO phoenix_workspace_pref(section, value_json, updated_at) VALUES (?, ?, ?)",
        [section, '{"preserve":true}', "2026-01-01T00:00:00Z"]);
    }
  } finally {
    db.close();
  }
  fs.writeFileSync(path.join(userData, "code-index.json"), JSON.stringify({ workspace_path: workspace, entries: ["OldName.cpp"] }));
  fs.writeFileSync(path.join(userData, "code-index-extra-extensions.json"), '[".legacy"]');
  fs.writeFileSync(path.join(workspace, ".phoenix", "code-rename.ignore"), "LegacyGenerated\n");
  vi.stubEnv("PHOENIX_USER_DATA_DIR", userData);
  vi.resetModules();
  const { createPhoenixServerApp } = await import("../serverApp.js");
  const { shellRoutes } = await import("./shell.js");
  return { app: createPhoenixServerApp(), shellRoutes, root, workspace, database };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("retired Code routes", () => {
  it("returns 404 for every former index, rename, UUID, reorder, and codegen endpoint without modifying user data", async () => {
    const { app, shellRoutes, root } = await setup();
    const before = snapshot(root);
    for (const [method, route] of retiredRoutes) {
      expect(shellRoutes.routes.some((item) => item.path === route), route).toBe(false);
      const response = await app.request(route, {
        method,
        ...(method === "GET" ? {} : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ old: "OldName", new: "NewName", dry_run: false, custom_ignore: ["Changed"] }),
        }),
      });
      expect(response.status, `${method} ${route}`).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ path: route, error: "未找到 API 路由" });
    }
    expect(snapshot(root)).toEqual(before);
  });

  it("does not parse retired mutation requests or leave codegen middleware registered", async () => {
    const { app, shellRoutes, root } = await setup();
    const before = snapshot(root);
    expect(shellRoutes.routes.filter((item) => item.path.startsWith("/api/code/"))
      .map((item) => `${item.method} ${item.path}`)).toEqual([
      "GET /api/code/ignore/prefs",
      "PUT /api/code/ignore/prefs",
      "GET /api/code/ignore/suggestions",
    ]);
    for (const route of ["/api/code/codegen/apply", "/api/code/rename/apply", "/api/code/index/scan"]) {
      const response = await app.request(route, {
        method: "POST", headers: { "content-type": "application/json" }, body: "not-json",
      });
      expect(response.status, route).toBe(404);
    }
    expect(snapshot(root)).toEqual(before);
  });

  it("retains ignore preferences and independent CAA dialog indexing without purging retired data", async () => {
    const { app, workspace, database } = await setup();
    const prefs = await app.request("/api/code/ignore/prefs");
    expect(prefs.status).toBe(200);
    await expect(prefs.json()).resolves.toMatchObject({
      consumers: [], ignore_file_patterns: ["LegacyGenerated"],
    });
    const saved = await app.request("/api/code/ignore/prefs", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ custom_ignore: ["KeepGenerated"] }),
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ custom_ignore: ["KeepGenerated"], consumers: [] });
    expect((await app.request("/api/code/ignore/suggestions")).status).toBe(200);
    expect((await app.request("/api/caa/health")).status).toBe(200);
    const scan = await app.request("/api/caa/index/scan", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceRoot: workspace }),
    });
    expect(scan.status).toBe(200);
    await expect(scan.json()).resolves.toMatchObject({ indexed: true, count: 1 });
    const groups = await app.request(`/api/caa/index/groups?workspaceRoot=${encodeURIComponent(workspace)}`);
    expect(groups.status).toBe(200);
    await expect(groups.json()).resolves.toMatchObject({ indexed: true, count: 1 });
    const db = pnwCreateDb(database);
    try {
      expect(db.get("SELECT repo_rel_path FROM phoenix_code_file_asset")).toEqual({ repo_rel_path: "OldName.cpp" });
      expect(db.get("SELECT stats_json FROM phoenix_code_scan")).toEqual({ stats_json: '{"total":1}' });
      expect(db.all("SELECT section, value_json FROM phoenix_workspace_pref WHERE section IN ('code_rename', 'reorder_members', 'kt_codegen') ORDER BY section"))
        .toEqual(["code_rename", "kt_codegen", "reorder_members"].map((section) => ({ section, value_json: '{"preserve":true}' })));
      expect(db.get("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_phoenix_code_file_kind'"))
        .toEqual({ name: "idx_phoenix_code_file_kind" });
    } finally {
      db.close();
    }
  });
});
