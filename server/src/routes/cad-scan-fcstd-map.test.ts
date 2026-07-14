import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveFileWorksets } from "../lib/fileWorksetService.js";

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

function configurePrefs(home: string, workspace: string) {
  const prefsDir = path.join(home, ".phoenix");
  fs.mkdirSync(prefsDir, { recursive: true });
  fs.writeFileSync(
    path.join(prefsDir, "launcher-prefs.json"),
    JSON.stringify({ recent_workspaces: [workspace], freecad_dir: "", workspace }, null, 2),
    "utf8",
  );
}

async function importCadScanRoutes(home: string, workspace: string) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  configurePrefs(home, workspace);
  vi.resetModules();
  return import("./cad-scan.js");
}

async function waitForProgress(cadScanRoutes: any, scanId: string, status: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await cadScanRoutes.request(`/fcstd-map/scan/progress?scan_id=${encodeURIComponent(scanId)}`);
    const progress = await response.json();
    if (progress.status === status) return progress;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`scan ${scanId} did not reach ${status}`);
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("cad scan fcstd-map routes", () => {
  it("routes prefs, scan, progress, entries, purge, export, history, and resume through the native service", async () => {
    const home = makeTempRoot("cad-scan-home-");
    const workspace = makeTempRoot("cad-scan-ws-");
    writeFile(workspace, "parts/800001.001-H.FCStd", "not a real fcstd zip\n");
    writeFile(workspace, "docs/readme.md", "# doc\n");
    writeFile(workspace, "outside/not-selected.FCStd", "outside\n");
    saveFileWorksets(workspace, {
      worksets: [{
        id: "cad-scope",
        name: "Selected CAD",
        entries: [
          { path: "parts", type: "dir" },
          { path: "docs/readme.md", type: "file" },
        ],
      }],
    });

    const { cadScanRoutes } = await importCadScanRoutes(home, workspace);

    const prefsRes = await cadScanRoutes.request("/fcstd-map/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force_update_part_name: true }),
    });
    expect(prefsRes.status).toBe(200);
    await expect(prefsRes.json()).resolves.toEqual({ force_update_part_name: true });

    const startRes = await cadScanRoutes.request("/fcstd-map/scan/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope_workset_id: "cad-scope" }),
    });
    expect(startRes.status).toBe(200);
    const start = await startRes.json();
    expect(start.scan_id).toMatch(/^fcstd-/);
    expect(start.phase).toBe("walk");
    expect(start.scan_scope).toMatchObject({ scope_workset_id: "cad-scope", scope_workset_name: "Selected CAD" });

    const progress = await waitForProgress(cadScanRoutes, start.scan_id, "done");
    expect(progress.status).toBe("done");
    expect(progress.total_cad_files).toBe(2);
    expect(progress.total_fcstd_files).toBe(1);

    const mapRes = await cadScanRoutes.request("/fcstd-map");
    expect(mapRes.status).toBe(200);
    const map = await mapRes.json();
    expect(map.stats.total_entries).toBe(2);
    expect(map.prefs.force_update_part_name).toBe(true);

    const entriesRes = await cadScanRoutes.request("/fcstd-map/entries?kind=fcstd&status=present");
    expect(entriesRes.status).toBe(200);
    const entries = await entriesRes.json();
    expect(entries.total).toBe(1);
    expect(entries.entries[0].repo_rel_path).toBe("./parts/800001.001-H.FCStd");
    expect((await (await cadScanRoutes.request("/fcstd-map/entries?search=not-selected")).json()).total).toBe(0);

    fs.rmSync(path.join(workspace, "docs/readme.md"));
    const missingRes = await cadScanRoutes.request("/fcstd-map/entries?status=missing");
    expect(missingRes.status).toBe(200);
    expect((await missingRes.json()).total).toBe(1);

    const purgeRes = await cadScanRoutes.request("/fcstd-map/purge-missing", { method: "POST" });
    expect(purgeRes.status).toBe(200);
    const purged = await purgeRes.json();
    expect(purged.purge_deleted).toBe(1);
    expect(purged.stats.total_entries).toBe(1);

    const exportRes = await cadScanRoutes.request("/fcstd-map/export-json", { method: "POST" });
    expect(exportRes.status).toBe(200);
    const exported = await exportRes.json();
    expect(fs.existsSync(exported.path)).toBe(true);

    const historyRes = await cadScanRoutes.request("/fcstd-map/scan/history?limit=5");
    expect(historyRes.status).toBe(200);
    const history = await historyRes.json();
    expect(history.scans).toHaveLength(1);
    expect(history.scans[0].status).toBe("done");
    expect(history.scans[0].stats).toMatchObject({ scope_workset_id: "cad-scope", scope_workset_name: "Selected CAD" });

    const invalidScope = await cadScanRoutes.request("/fcstd-map/scan/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope_workset_id: "missing" }),
    });
    expect(invalidScope.status).toBe(400);

    const resumeRes = await cadScanRoutes.request("/fcstd-map/scan/resume");
    expect(resumeRes.status).toBe(200);
    await expect(resumeRes.json()).resolves.toMatchObject({ active: false, progress: null });
  });

  it("returns from start before completion and persists cancellation", async () => {
    const home = makeTempRoot("cad-scan-cancel-home-");
    const workspace = makeTempRoot("cad-scan-cancel-ws-");
    for (let index = 0; index < 20; index += 1) {
      writeFile(workspace, `parts-${index}/model-${index}.FCStd`, "not a zip\n");
    }
    const { cadScanRoutes } = await importCadScanRoutes(home, workspace);

    const start = await (await cadScanRoutes.request("/fcstd-map/scan/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })).json();
    expect(start.phase).toBe("walk");

    const cancelled = await (await cadScanRoutes.request(
      `/fcstd-map/scan/cancel?scan_id=${encodeURIComponent(start.scan_id)}`,
      { method: "POST" },
    )).json();
    expect(cancelled.cancelled).toBe(true);
    expect((await waitForProgress(cadScanRoutes, start.scan_id, "cancelled")).status).toBe("cancelled");

    let history: any[] = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      history = (await (await cadScanRoutes.request("/fcstd-map/scan/history?limit=5")).json()).scans;
      if (history.some((item: any) => item.scan_uuid && item.status === "cancelled")) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(history.some((item: any) => item.status === "cancelled")).toBe(true);
    const secondCancel = await (await cadScanRoutes.request(
      `/fcstd-map/scan/cancel?scan_id=${encodeURIComponent(start.scan_id)}`,
      { method: "POST" },
    )).json();
    expect(secondCancel.cancelled).toBe(false);
  });
});
