import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { pickDirectoryNative } from "../lib/nativeDirectoryPicker.js";
vi.mock("../lib/nativeDirectoryPicker.js", () => ({ pickDirectoryNative: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs(); vi.resetAllMocks(); vi.resetModules();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it("passes path_hint and the current workspace to the native picker without changing workspace", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-picker-route-")); roots.push(root);
  const workspace = path.join(root, "workspace"); fs.mkdirSync(workspace);
  const prefs = path.join(root, "launcher-prefs.json"); fs.writeFileSync(prefs, JSON.stringify({ workspace }));
  const before = fs.readFileSync(prefs);
  vi.stubEnv("PHOENIX_USER_DATA_DIR", root); vi.resetModules();
  const { shellRoutes } = await import("./shell.js");
  vi.mocked(pickDirectoryNative).mockResolvedValueOnce(null).mockResolvedValueOnce(workspace);
  const request = () => shellRoutes.request("/api/config/pick-workspace-directory", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path_hint: path.join(workspace, "nested") }),
  });
  expect(await (await request()).json()).toEqual({ cancelled: true, path: "" });
  expect(pickDirectoryNative).toHaveBeenCalledWith(path.join(workspace, "nested"), workspace);
  expect(await (await request()).json()).toEqual({ cancelled: false, path: workspace });
  expect(fs.readFileSync(prefs)).toEqual(before);
});
