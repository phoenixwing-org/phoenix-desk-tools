import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function makeTempRoot(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, rel: string, text: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
}

function configureTempPrefs(home: string, workspace: string) {
  const prefsDir = path.join(home, ".phoenix");
  fs.mkdirSync(prefsDir, { recursive: true });
  fs.writeFileSync(
    path.join(prefsDir, "launcher-prefs.json"),
    JSON.stringify({ recent_workspaces: [workspace], freecad_dir: "", workspace }, null, 2),
    "utf8",
  );
}

async function importShellRoutes(home: string, workspace: string) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  configureTempPrefs(home, workspace);
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

describe("shell code index routes", () => {
  it("routes index scan, entries, catdlg, extension, purge, and export through the code index service", async () => {
    const home = makeTempRoot("shell-code-index-home-");
    const workspace = makeTempRoot("shell-code-index-ws-");
    writeFile(workspace, "src/main.cpp", "int main() { return 0; }\n");
    writeFile(workspace, "src/view.CATDlg", "CATDlgDialog View;\n");
    writeFile(workspace, "tool.kev", "custom\n");
    writeFile(workspace, "part.FCStd", "cad\n");
    writeFile(workspace, "ignored/skip.xyz", "ignored\n");
    writeFile(workspace, "build/generated.cpp", "ignored\n");

    const { shellRoutes } = await importShellRoutes(home, workspace);
    const ignoreRes = await shellRoutes.request("/api/code/ignore/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ custom_ignore: ["ignored"] }),
    });
    expect(ignoreRes.status).toBe(200);

    const discoveryRes = await shellRoutes.request("/api/code/index/extension-discovery");
    expect(discoveryRes.status).toBe(200);
    const discovery = await discoveryRes.json();
    const discoveredExts = discovery.candidates.map((c: any) => c.ext);
    expect(discoveredExts).toContain(".kev");
    expect(discoveredExts).not.toContain(".fcstd");
    expect(discoveredExts).not.toContain(".xyz");

    const saveExtRes = await shellRoutes.request("/api/code/index/extra-extensions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ extensions: ["kev"] }),
    });
    expect(saveExtRes.status).toBe(200);
    await expect(saveExtRes.json()).resolves.toMatchObject({ extra_extensions: [".kev"] });

    const scanRes = await shellRoutes.request("/api/code/index/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(scanRes.status).toBe(200);
    const scan = await scanRes.json();
    expect(scan.file_count).toBe(3);
    expect(scan.present_count).toBe(3);
    expect(scan.extra_extensions).toContain(".kev");

    const entriesRes = await shellRoutes.request("/api/code/index/entries?kind=source&q=main");
    expect(entriesRes.status).toBe(200);
    const entries = await entriesRes.json();
    expect(entries.total).toBe(1);
    expect(entries.entries[0]?.repo_rel_path).toBe("src/main.cpp");

    const catdlgRes = await shellRoutes.request("/api/code/index/catdlg");
    expect(catdlgRes.status).toBe(200);
    const catdlg = await catdlgRes.json();
    expect(catdlg.indexed).toBe(true);
    expect(catdlg.count).toBe(1);
    expect(catdlg.entries[0]?.repo_rel_path).toBe("src/view.CATDlg");

    const exportRes = await shellRoutes.request("/api/code/index/export-json", { method: "POST" });
    expect(exportRes.status).toBe(200);
    const exported = await exportRes.json();
    expect(exported.path_display).toContain("code_index.json");
    expect(fs.existsSync(exported.path)).toBe(true);

    fs.rmSync(path.join(workspace, "tool.kev"));
    const rescanRes = await shellRoutes.request("/api/code/index/scan", { method: "POST" });
    expect(rescanRes.status).toBe(200);
    const rescan = await rescanRes.json();
    expect(rescan.file_count).toBe(3);
    expect(rescan.present_count).toBe(2);

    const purgeRes = await shellRoutes.request("/api/code/index/purge-missing", { method: "POST" });
    expect(purgeRes.status).toBe(200);
    const purged = await purgeRes.json();
    expect(purged.purge_deleted).toBe(1);
    expect(purged.file_count).toBe(2);
  }, 15_000);

  it("keeps extra extensions scoped to the active workspace", async () => {
    const home = makeTempRoot("shell-code-index-home-");
    const workspaceA = makeTempRoot("shell-code-index-ws-a-");
    const workspaceB = makeTempRoot("shell-code-index-ws-b-");
    writeFile(workspaceA, "tool.kev", "custom a\n");
    writeFile(workspaceB, "tool.kev", "custom b\n");

    let mod = await importShellRoutes(home, workspaceA);
    const saveExtRes = await mod.shellRoutes.request("/api/code/index/extra-extensions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ extensions: ["kev"] }),
    });
    expect(saveExtRes.status).toBe(200);
    const scanARes = await mod.shellRoutes.request("/api/code/index/scan", { method: "POST" });
    expect(scanARes.status).toBe(200);
    const scanA = await scanARes.json();
    expect(scanA.file_count).toBe(1);
    expect(scanA.extra_extensions).toEqual([".kev"]);

    mod = await importShellRoutes(home, workspaceB);
    const extraBRes = await mod.shellRoutes.request("/api/code/index/extra-extensions");
    expect(extraBRes.status).toBe(200);
    const extraB = await extraBRes.json();
    expect(extraB.extra_extensions).toEqual([]);
    const scanBRes = await mod.shellRoutes.request("/api/code/index/scan", { method: "POST" });
    expect(scanBRes.status).toBe(200);
    const scanB = await scanBRes.json();
    expect(scanB.file_count).toBe(0);
  });

  it("does not migrate legacy global extra extensions without a matching legacy index", async () => {
    const home = makeTempRoot("shell-code-index-home-");
    const workspace = makeTempRoot("shell-code-index-ws-");
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    configureTempPrefs(home, workspace);
    fs.writeFileSync(
      path.join(home, ".phoenix", "code-index-extra-extensions.json"),
      JSON.stringify({ extensions: [".kev"] }, null, 2),
      "utf8",
    );
    vi.resetModules();

    const { shellRoutes } = await import("./shell.js");
    const extraRes = await shellRoutes.request("/api/code/index/extra-extensions");
    expect(extraRes.status).toBe(200);
    const extra = await extraRes.json();
    expect(extra.extra_extensions).toEqual([]);
  });

  it("migrates matching legacy global code index storage into the workspace-scoped store", async () => {
    const home = makeTempRoot("shell-code-index-home-");
    const workspace = makeTempRoot("shell-code-index-ws-");
    writeFile(workspace, "legacy.kev", "legacy\n");
    const { shellRoutes } = await importShellRoutes(home, workspace);
    const prefsDir = path.join(home, ".phoenix");
    fs.writeFileSync(
      path.join(prefsDir, "code-index-extra-extensions.json"),
      JSON.stringify({ extensions: [".kev"] }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(prefsDir, "code-index.json"),
      JSON.stringify({
        version: 1,
        workspace_path: workspace,
        last_scan_at: "2026-07-10T00:00:00.000Z",
        extra_extensions: [".kev"],
        entries: [{
          repo_rel_path: "legacy.kev",
          filename: "legacy.kev",
          asset_kind: "resource",
          file_ext: ".kev",
          file_status: "present",
          size_bytes: 7,
          text_encoding: "ascii",
          last_seen_at: "2026-07-10T00:00:00.000Z",
        }],
      }, null, 2),
      "utf8",
    );

    const indexRes = await shellRoutes.request("/api/code/index");
    expect(indexRes.status).toBe(200);
    const index = await indexRes.json();
    expect(index.file_count).toBe(1);
    expect(index.extra_extensions).toEqual([".kev"]);

    const entriesRes = await shellRoutes.request("/api/code/index/entries?kind=resource&q=legacy");
    expect(entriesRes.status).toBe(200);
    const entries = await entriesRes.json();
    expect(entries.total).toBe(1);
    expect(entries.entries[0]?.repo_rel_path).toBe("legacy.kev");
  });
});
