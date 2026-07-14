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

function writeFile(root: string, rel: string, text = "part\n") {
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

async function importCadRoutes(home: string, workspace: string) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  configurePrefs(home, workspace);
  vi.resetModules();
  return import("./cad.js");
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("cad Part Dedup routes", () => {
  it("serves prefs, scan, and CSV export natively", async () => {
    const home = makeTempRoot("cad-part-dedup-home-");
    const workspace = makeTempRoot("cad-part-dedup-ws-");
    writeFile(workspace, "models/100001.001-Frame.SLDPRT");
    writeFile(workspace, "copy/100001.001-Frame.SLDPRT");
    writeFile(workspace, "models/100001.002-Frame.SLDPRT");
    writeFile(workspace, "models/100002.001-Bracket.SLDPRT");

    const { cadRoutes } = await importCadRoutes(home, workspace);

    const prefsRes = await cadRoutes.request("/part-dedup/prefs");
    expect(prefsRes.status).toBe(200);
    await expect(prefsRes.json()).resolves.toMatchObject({
      extension: ".SLDPRT",
      scan_dir: ".",
    });

    const saveRes = await cadRoutes.request("/part-dedup/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ extension: "SLDPRT", code_len: 6, ver_len: 3, scan_dir: "." }),
    });
    expect(saveRes.status).toBe(200);
    await expect(saveRes.json()).resolves.toMatchObject({ extension: ".SLDPRT", scan_dir: "." });

    const scanRes = await cadRoutes.request("/part-dedup/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ extension: ".SLDPRT", scan_dir: "." }),
    });
    expect(scanRes.status).toBe(200);
    const scan = await scanRes.json();
    expect(scan).toMatchObject({
      file_count: 4,
      stats: { name_dup: 1, code_dup: 0, ver_dup: 1 },
      _native: "node",
    });
    expect(scan).not.toHaveProperty("_proxy");
    expect(scan).not.toHaveProperty("_stub");
    expect(scan.results.name_dup[0].paths_display).toContain("./copy/100001.001-Frame.SLDPRT");

    const exportRes = await cadRoutes.request("/part-dedup/export-csv", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ results: scan.results }),
    });
    expect(exportRes.status).toBe(200);
    const exported = await exportRes.json();
    expect(exported).toMatchObject({ path_display: "./.phoenix/exports/part_dedup.csv", _native: "node" });
    expect(fs.existsSync(path.join(workspace, ".phoenix", "exports", "part_dedup.csv"))).toBe(true);
  });

  it("returns a validation error for scan dirs outside the workspace", async () => {
    const home = makeTempRoot("cad-part-dedup-home-");
    const workspace = makeTempRoot("cad-part-dedup-ws-");
    const { cadRoutes } = await importCadRoutes(home, workspace);

    const res = await cadRoutes.request("/part-dedup/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scan_dir: ".." }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ detail: expect.stringMatching(/escapes workspace/i) });
  });
});
