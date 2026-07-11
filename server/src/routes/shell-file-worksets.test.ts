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

function writeFile(root: string, rel: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "", "utf8");
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

describe("shell file workset routes", () => {
  it("persists worksets and prunes missing paths through Hono routes", async () => {
    const home = makeTempRoot("shell-file-worksets-home-");
    const workspace = makeTempRoot("shell-file-worksets-ws-");
    writeFile(workspace, "src/keep.cpp");

    const { shellRoutes } = await importShellRoutes(home, workspace);

    const saveRes = await shellRoutes.request("/api/file-worksets", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        worksets: [
          {
            id: "ws1",
            name: "A",
            entries: [
              { path: "src/keep.cpp", type: "file" },
              { path: "src/gone.cpp", type: "file" },
            ],
          },
        ],
      }),
    });
    expect(saveRes.status).toBe(200);
    const saved = await saveRes.json();
    expect(saved.storage).toBe("sqlite");
    expect(saved.worksets[0].entries).toHaveLength(2);
    expect(fs.existsSync(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, ".phoenix", "file-worksets.json"))).toBe(false);

    const getRes = await shellRoutes.request("/api/file-worksets");
    const loaded = await getRes.json();
    expect(loaded.worksets[0].id).toBe("ws1");

    const pruneRes = await shellRoutes.request("/api/file-worksets/prune-missing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workset_id: "ws1" }),
    });
    expect(pruneRes.status).toBe(200);
    const pruned = await pruneRes.json();
    expect(pruned.prune_removed).toBe(1);
    expect(pruned.worksets[0].entries).toEqual([{ path: "src/keep.cpp", type: "file" }]);
  });
});
