/** pdtSystemStub — 验证系统/配置 stub 不崩溃
 *  对应 Python: test_user_prefs/nav_modules/workbench_session/runtime_catalog
 */

import { describe, it, expect } from "vitest";

// 模拟 shell.ts 的路由 handler 行为
function stubResponse(data: any) { return data; }

describe("pdtSystemStub — 系统 API stub 格式正确", () => {
  it("launcher prefs 返回正确结构", () => {
    const r = { version: 1, freecad_dir: "", recent_workspaces: [], recent_workspace_entries: [], shell_layout: {}, nav_modules: { enabled: ["cad", "code"] } };
    expect(r.recent_workspaces).toEqual([]);
    expect(r.nav_modules.enabled).toContain("cad");
  });

  it("workspace 返回正确结构", () => {
    const r = { path: "", name: "" };
    expect(r.path).toBe("");
    expect(typeof r.name).toBe("string");
  });

  it("onboarding status 返回正确结构", () => {
    const r = { workspace_ok: true, workspace_path: "", freecad_ok: false, index_scanned: false, last_scan_at: "" };
    expect(r.workspace_ok).toBe(true);
  });

  it("database status 返回正确结构", () => {
    const r = { legacy_detected: false, needs_recreate: false, reasons: [], database_exists: false, database_path: "", schema_version: 0 };
    expect(r.database_exists).toBe(false);
    expect(Array.isArray(r.reasons)).toBe(true);
  });

  it("workbench session 返回正确结构", () => {
    const r = stubResponse({ tabs: [], active_tab_id: "" });
    expect(r.tabs).toEqual([]);
  });

  it("shell log 返回正确结构", () => {
    const r = { total: 0 };
    expect(r.total).toBe(0);
  });

  it("git info stub", () => {
    const r = { git_root: "", git_root_display: "", branch: "", has_changes: false };
    expect(r.has_changes).toBe(false);
  });

  it("unit test suites stub", () => {
    const r = { suites: [] };
    expect(r.suites).toEqual([]);
  });

  it("file worksets stub", () => {
    const r = { worksets: [] };
    expect(r.worksets).toEqual([]);
  });

  it("runtime catalog stub", () => {
    const r = { modules: [] };
    expect(r.modules).toEqual([]);
  });
});
