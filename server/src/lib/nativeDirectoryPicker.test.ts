import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { directoryPickerCommand, resolveDirectoryPickerStart } from "./nativeDirectoryPicker.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe("native directory picker starting location", () => {
  it("uses the input directory and falls back to the workspace for missing/invalid paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-picker-test-")); roots.push(root);
    const nested = path.join(root, "零件 001"); fs.mkdirSync(nested);
    expect(resolveDirectoryPickerStart("零件 001", root)).toBe(nested);
    expect(resolveDirectoryPickerStart(nested, root)).toBe(nested);
    for (const hint of [null, {}, "", ".", "not-found", "bad\0path"]) expect(resolveDirectoryPickerStart(hint, root)).toBe(root);
    expect(resolveDirectoryPickerStart(null, "")).toBe("");
  });
  it("keeps quotes and shell characters out of scripts on every platform", () => {
    const start = '/tmp/零件 "$value`test`;name';
    const mac = directoryPickerCommand("darwin", start);
    expect(mac.args.at(-1)).toBe(start);
    expect(mac.args[1]).not.toContain(start);
    expect(mac.args[1]).toContain("default location");
    const windows = directoryPickerCommand("win32", start);
    expect(windows.env.PHOENIX_DIRECTORY_HINT).toBe(start);
    expect(windows.args.join(" ")).not.toContain(start);
    expect(windows.args.at(-1)).toContain("DialogResult]::OK");
    expect(directoryPickerCommand("linux", start).args.at(-1)).toBe(`--filename=${start}/`);
  });
});
