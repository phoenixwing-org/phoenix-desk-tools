import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { scanDrawingCandidates } from "./scan.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drawing-scope-")); roots.push(root);
  for (const directory of ["models", "models/nested", "models/.cache", "models/__pycache__", "models/node_modules"]) fs.mkdirSync(path.join(root, directory), { recursive: true });
  for (const rel of ["models/Plain.FCStd", "models/Example.Drawing.FCStd", "models/nested/Inner.FCStd", "models/.cache/Backup.FCStd", "models/__pycache__/Cache.FCStd", "models/node_modules/Package.FCStd", "models/.hidden.FCStd"]) fs.writeFileSync(path.join(root, rel), "synthetic metadata");
  return root;
}
it("scans only explicit top-level or recursive scope and excludes hidden/cache folders", async () => {
  const root = fixture();
  expect((await scanDrawingCandidates(root, "models")).files).toEqual(["models/Example.Drawing.FCStd", "models/Plain.FCStd"]);
  expect((await scanDrawingCandidates(root, "models", true)).files).toEqual(["models/Example.Drawing.FCStd", "models/Plain.FCStd", "models/nested/Inner.FCStd"]);
  await expect(scanDrawingCandidates(root, "models/.cache", true)).rejects.toThrow(/隐藏/);
});
it("rejects traversal and never follows linked directories or files", async () => {
  const root = fixture();
  fs.symlinkSync(path.join(root, "models/nested"), path.join(root, "models/shortcut"));
  fs.symlinkSync(path.join(root, "models/Plain.FCStd"), path.join(root, "models/Alias.FCStd"));
  const scan = await scanDrawingCandidates(root, "models", true);
  expect(scan.warnings).toHaveLength(2);
  expect(scan.files).not.toContain("models/Alias.FCStd");
  await expect(scanDrawingCandidates(root, "..", true)).rejects.toThrow(/隐藏|工作空间/);
  await expect(scanDrawingCandidates(root, "models/shortcut", true)).rejects.toThrow(/符号链接/);
});
it("is read-only and requires a real directory", async () => {
  const root = fixture(), before = fs.readFileSync(path.join(root, "models/Plain.FCStd"));
  await scanDrawingCandidates(root, "models");
  expect(fs.readFileSync(path.join(root, "models/Plain.FCStd"))).toEqual(before);
  expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
  await expect(scanDrawingCandidates(root, "models/Plain.FCStd")).rejects.toThrow(/目录/);
});
