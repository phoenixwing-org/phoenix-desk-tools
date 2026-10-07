import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];

function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(relative: string) {
    const filename = path.join(root, relative);
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink()) files[relative] = `link:${fs.readlinkSync(filename)}`;
    else if (stat.isDirectory()) {
      files[`${relative}/`] = "directory";
      for (const entry of fs.readdirSync(filename).sort()) walk(path.join(relative, entry));
    } else files[relative] = fs.readFileSync(filename).toString("base64");
  }
  walk("");
  return files;
}

async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cad-batch-directories-"));
  roots.push(root);
  const workspace = path.join(root, "工作空间");
  const otherWorkspace = path.join(root, "other");
  const userData = path.join(root, "user-data");
  for (const dir of [workspace, otherWorkspace, userData]) fs.mkdirSync(dir);
  fs.mkdirSync(path.join(workspace, "Assemblies", "nested"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "零件 图"));
  fs.mkdirSync(path.join(workspace, ".hidden"));
  fs.writeFileSync(path.join(workspace, "part.FCStd"), "never read this file");
  fs.writeFileSync(path.join(workspace, "Assemblies", "nested", "deep.FCStd"), "never scan nested files");
  fs.symlinkSync(otherWorkspace, path.join(workspace, "outside-link"), "junction");
  fs.symlinkSync(path.join(workspace, "Assemblies"), path.join(workspace, "inside-link"), "junction");
  const prefs = path.join(userData, "launcher-prefs.json");
  const selectWorkspace = (value: string) => fs.writeFileSync(prefs, JSON.stringify({ workspace: value }));
  selectWorkspace(workspace);
  vi.stubEnv("PHOENIX_USER_DATA_DIR", userData);
  vi.resetModules();
  const { cadRoutes } = await import("./cad.js");
  const listUrl = `/batch-directories?workspace=${encodeURIComponent(workspace)}`;
  const validateUrl = (directory: string) => `/batch-directory?workspace=${encodeURIComponent(workspace)}&directory=${encodeURIComponent(directory)}`;
  return { root, workspace, otherWorkspace, prefs, selectWorkspace, cadRoutes, listUrl, validateUrl };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("CAD shared batch directory routes", () => {
  it("enumerates only first-level real directories, without reading source files or creating database/preferences", async () => {
    const { root, workspace, prefs, cadRoutes, listUrl } = await setup();
    const before = snapshot(root);
    const read = vi.spyOn(fs, "readFileSync");
    const readdir = vi.spyOn(fs, "readdirSync");
    const response = await cadRoutes.request(listUrl);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.workspace).toBe(workspace);
    expect(payload.directories).toEqual(
      ["Assemblies", "零件 图", ".hidden"].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, path: name })),
    );
    expect(readdir).toHaveBeenCalledTimes(1);
    expect(String(readdir.mock.calls[0][0])).toBe(fs.realpathSync(workspace));
    expect(read.mock.calls.map(([filename]) => String(filename))).toEqual([prefs]);
    read.mockRestore();
    readdir.mockRestore();
    expect(snapshot(root)).toEqual(before);
    expect(fs.existsSync(path.join(workspace, ".phoenix"))).toBe(false);
  });

  it("normalizes existing relative, nested, Chinese, absolute, and root directory input without writes", async () => {
    const { root, workspace, cadRoutes, validateUrl } = await setup();
    const before = snapshot(root);
    const cases = [
      ["零件 图", "零件 图"],
      [" ./Assemblies//nested/ ", "Assemblies/nested"],
      ["Assemblies\\nested", "Assemblies/nested"],
      [path.join(workspace, "零件 图"), "零件 图"],
      [path.join(fs.realpathSync(workspace), "Assemblies"), "Assemblies"],
      [workspace, "."],
      [".", "."],
    ];
    const readdir = vi.spyOn(fs, "readdirSync");
    for (const [input, expected] of cases) {
      const response = await cadRoutes.request(validateUrl(input));
      expect(response.status, input).toBe(200);
      await expect(response.json()).resolves.toEqual({ workspace, directory: expected });
    }
    expect(readdir).not.toHaveBeenCalled();
    readdir.mockRestore();
    expect(snapshot(root)).toEqual(before);
  });

  it("rejects empty, missing, file, traversal, outside and symlink directory selections", async () => {
    const { root, otherWorkspace, cadRoutes, validateUrl } = await setup();
    const before = snapshot(root);
    for (const input of [
      "", "   ", "missing", "part.FCStd", "..", "Assemblies/../零件 图", "..\\other",
      otherWorkspace, "outside-link", "inside-link", "inside-link/nested", "bad\0name",
    ]) {
      const response = await cadRoutes.request(validateUrl(input));
      expect(response.status, JSON.stringify(input)).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ detail: expect.any(String) });
    }
    expect(snapshot(root)).toEqual(before);
  });

  it("requires explicit current workspace and refuses requests after workspace switching or closure", async () => {
    const { root, otherWorkspace, selectWorkspace, cadRoutes, listUrl, validateUrl } = await setup();
    for (const route of ["/batch-directories", "/batch-directory?directory=.", "/batch-directories?workspace=%20%20"]) {
      expect((await cadRoutes.request(route)).status, route).toBe(400);
    }
    for (const selected of [otherWorkspace, "", path.join(root, "removed-workspace")]) {
      selectWorkspace(selected);
      const before = snapshot(root);
      expect((await cadRoutes.request(listUrl)).status).toBe(409);
      expect((await cadRoutes.request(validateUrl("."))).status).toBe(409);
      expect(snapshot(root)).toEqual(before);
    }
  });

  it("rejects a selected workspace that no longer exists and handles empty directories", async () => {
    const { root, otherWorkspace, selectWorkspace, cadRoutes } = await setup();
    selectWorkspace(otherWorkspace);
    const route = `/batch-directories?workspace=${encodeURIComponent(otherWorkspace)}`;
    const response = await cadRoutes.request(route);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ workspace: otherWorkspace, directories: [] });
    const missing = path.join(root, "does-not-exist");
    selectWorkspace(missing);
    expect((await cadRoutes.request(`/batch-directories?workspace=${encodeURIComponent(missing)}`)).status).toBe(409);
  });
});
