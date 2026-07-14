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

describe("shell code uuid routes", () => {
  it("scans and applies selected UUID replacements through Hono routes", async () => {
    const home = makeTempRoot("shell-code-uuid-home-");
    const workspace = makeTempRoot("shell-code-uuid-ws-");
    const old = "12345678-1234-1234-1234-1234567890ab";
    writeFile(workspace, "src/a.cpp", `${old}\n${old}\n`);

    const { shellRoutes } = await importShellRoutes(home, workspace);
    const scanRes = await shellRoutes.request("/api/code/uuid/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kinds: ["uuid"] }),
    });
    expect(scanRes.status).toBe(200);
    const scan = await scanRes.json();
    expect(scan.implemented).toBe(true);
    expect(scan.summary.total_hits).toBe(2);
    expect(scan.ignore_file_display).toContain("code.ignore");
    expect(scan.ignore_file_exists).toBe(false);
    expect(scan.ignore_file_patterns).toEqual([]);
    expect(Array.isArray(scan.ignore_custom_patterns)).toBe(true);

    const dryRunRes = await shellRoutes.request("/api/code/uuid/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hit_ids: [scan.hits[0].hit_id], strategy: "fresh_per_hit", dry_run: true }),
    });
    expect(dryRunRes.status).toBe(200);
    const dryRun = await dryRunRes.json();
    expect(dryRun.dry_run).toBe(true);
    expect(dryRun.mappings).toHaveLength(1);
    expect(fs.readFileSync(path.join(workspace, "src/a.cpp"), "utf8").split(old)).toHaveLength(3);

    const applyRes = await shellRoutes.request("/api/code/uuid/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hit_ids: [scan.hits[0].hit_id], strategy: "fresh_per_hit", dry_run: false }),
    });
    expect(applyRes.status).toBe(200);
    const applied = await applyRes.json();
    expect(applied.dry_run).toBe(false);
    expect(applied.mappings).toHaveLength(1);
    const text = fs.readFileSync(path.join(workspace, "src/a.cpp"), "utf8");
    expect(text).toContain(old);
    expect(text).toContain(applied.mappings[0].new);
  });
});
