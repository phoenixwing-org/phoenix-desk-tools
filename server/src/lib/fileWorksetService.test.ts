import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadFileWorksets,
  normalizeWorksetEntries,
  normalizeWorksetPaths,
  pruneMissingFileWorksetPaths,
  resolveFileWorksetScope,
  saveFileWorksets,
} from "./fileWorksetService.js";

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-workset-service-"));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, rel: string, text = "") {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("fileWorksetService", () => {
  it("normalizes legacy paths and typed entries", () => {
    expect(normalizeWorksetPaths(["b/a.cpp", "./b/a.cpp", "../evil.cpp", "z.h"])).toEqual(["b/a.cpp", "z.h"]);
    expect(normalizeWorksetEntries([{ path: "src", type: "dir" }, { path: "src/a.cpp", type: "file" }])).toEqual([
      { path: "src", type: "dir" },
      { path: "src/a.cpp", type: "file" },
    ]);
  });

  it("saves and loads workspace-local worksets", () => {
    const workspace = makeTempRoot();
    const saved = saveFileWorksets(workspace, {
      worksets: [
        {
          id: "ws1",
          name: "A",
          paths: ["src/foo.cpp", "src/bar.h", "../bad.cpp"],
          source: "test",
        },
      ],
    });
    expect(saved.storage).toBe("sqlite");
    expect(saved.worksets[0].entries.map((entry) => entry.path)).toEqual(["src/bar.h", "src/foo.cpp"]);
    expect(fs.existsSync(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, ".phoenix", "file-worksets.json"))).toBe(false);

    const loaded = loadFileWorksets(workspace);
    expect(loaded.worksets[0].id).toBe("ws1");
    expect(loaded.workspace_path).toBe(workspace);
  });

  it("imports migration-era JSON once without resurrecting stale worksets", () => {
    const workspace = makeTempRoot();
    const legacy = path.join(workspace, ".phoenix", "file-worksets.json");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, JSON.stringify({
      version: 1,
      worksets: [{ id: "legacy", name: "Legacy", paths: ["src/a.cpp"] }],
    }), "utf8");

    expect(loadFileWorksets(workspace).worksets).toEqual([
      expect.objectContaining({
        id: "legacy",
        entries: [{ path: "src/a.cpp", type: "file" }],
      }),
    ]);
    saveFileWorksets(workspace, { worksets: [] });
    fs.writeFileSync(legacy, JSON.stringify({
      version: 1,
      worksets: [{ id: "stale", name: "Stale", paths: ["stale.cpp"] }],
    }), "utf8");
    expect(loadFileWorksets(workspace).worksets).toEqual([]);
  });

  it("prunes missing file and directory entries", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "keep.cpp");
    fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
    saveFileWorksets(workspace, {
      worksets: [
        {
          id: "ws1",
          name: "mix",
          entries: [
            { path: "keep.cpp", type: "file" },
            { path: "src", type: "dir" },
            { path: "gone.cpp", type: "file" },
            { path: "missing-dir", type: "dir" },
          ],
        },
      ],
    });

    const out = pruneMissingFileWorksetPaths(workspace);
    expect(out.prune_removed).toBe(2);
    expect(out.worksets[0].entries).toEqual([
      { path: "keep.cpp", type: "file" },
      { path: "src", type: "dir" },
    ]);
  });

  it("resolves a workset into deduplicated directory and explicit file scope", () => {
    const workspace = makeTempRoot();
    saveFileWorksets(workspace, {
      worksets: [{
        id: "scope-a",
        name: "Scoped CAD",
        entries: [
          { path: "parts", type: "dir" },
          { path: "parts/nested", type: "dir" },
          { path: "parts/model.FCStd", type: "file" },
          { path: "parts-extra/keep.FCStd", type: "file" },
        ],
      }],
    });

    expect(resolveFileWorksetScope(workspace, "scope-a")).toEqual({
      id: "scope-a",
      name: "Scoped CAD",
      dirs: ["parts"],
      files: ["parts-extra/keep.FCStd"],
    });
    expect(() => resolveFileWorksetScope(workspace, "missing")).toThrow(/not found/);
  });
});
