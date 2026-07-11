import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { loadWorkspacePrefs } from "../lib/workspacePrefsService.js";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("shell code rename routes", () => {
  it("persists prefs and previews/applies GBK text natively", async () => {
    const home = makeTempRoot("shell-code-rename-home-");
    const workspace = makeTempRoot("shell-code-rename-ws-");
    const filename = path.join(workspace, "sample.cpp");
    fs.writeFileSync(filename, iconv.encode("// 中文 OldName\r\n", "gbk"));
    const { shellRoutes } = await importShellRoutes(home, workspace);

    const defaults = await (await shellRoutes.request("/api/code/rename/prefs")).json();
    expect(defaults).toMatchObject({ levels: ["text"], target_encoding: "utf-8", implemented: true });

    const savedResponse = await shellRoutes.request("/api/code/rename/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ old: "OldName", new: "NewName", levels: ["text"], target_encoding: "gbk" }),
    });
    expect(savedResponse.status).toBe(200);
    expect(await savedResponse.json()).toMatchObject({ old: "OldName", new: "NewName", target_encoding: "gbk" });
    expect(await (await shellRoutes.request("/api/code/rename/prefs")).json()).toMatchObject({ old: "OldName", target_encoding: "gbk" });

    const preview = await (await shellRoutes.request("/api/code/rename/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ old: "OldName", new: "NewName", levels: ["text"], target_encoding: "utf-8" }),
    })).json();
    expect(preview.summary.total_hits).toBe(1);
    expect(preview.hits[0]).toMatchObject({ encoding_in: "gbk", encoding_out: "gbk", status: "preview" });

    const applied = await (await shellRoutes.request("/api/code/rename/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ old: "OldName", new: "NewName", levels: ["text"], target_encoding: "utf-8" }),
    })).json();
    expect(applied.hits[0].status).toBe("written");
    expect(iconv.decode(fs.readFileSync(filename), "gbk")).toBe("// 中文 NewName\r\n");

    const stored = loadWorkspacePrefs(workspace);
    expect(stored.code_rename).toMatchObject({ old: "OldName", new: "NewName", levels: ["text"], target_encoding: "utf-8" });
  });
});
