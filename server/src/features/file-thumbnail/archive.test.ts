import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { fcstdFingerprint } from "../../lib/fcstdBatchFiles.js";
import { extractFcstdThumbnail } from "../../lib/fcstdThumbnail.js";
import { writeFcstdThumbnail } from "./archive.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6mcAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
function fixture(existing = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "thumbnail-archive-test-")); roots.push(root);
  const files: Record<string, Uint8Array> = { "Document.xml": strToU8('<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties Count="0"/></Object></ObjectData></Document>'),
    "GuiDocument.xml": strToU8("independent synthetic GUI serialization"), "PartShape.brp": strToU8("opaque synthetic shape"), "extension/unknown.bin": new Uint8Array([0, 255, 7, 11]) };
  if (existing) files["thumbnails/Thumbnail.png"] = png;
  const before = Buffer.from(zipSync(files)), filename = path.join(root, "Synthetic.FCStd");
  fs.writeFileSync(filename, before);
  return { root, filename, before, files, hash: fcstdFingerprint(before) };
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it.each([false, true])("writes an embedded PNG and preserves every non-thumbnail entry (previous PNG=%s)", existing => {
  const data = fixture(existing), result = writeFcstdThumbnail(data.root, "Synthetic.FCStd", png, data.hash);
  const saved = fs.readFileSync(data.filename), archive = unzipSync(saved);
  expect(extractFcstdThumbnail(saved)?.bytes).toEqual(png);
  for (const [name, bytes] of Object.entries(data.files)) if (name !== "thumbnails/Thumbnail.png") expect(archive[name]).toEqual(bytes);
  expect(Object.keys(archive).sort()).toEqual([...new Set([...Object.keys(data.files), "thumbnails/Thumbnail.png"])].sort());
  expect(result.sourceHash).toBe(fcstdFingerprint(saved));
  expect(fs.readFileSync(path.join(data.root, result.backup))).toEqual(data.before);
});
it("rejects invalid PNG and stale source before creating a backup or changing the document", () => {
  const data = fixture(true);
  expect(() => writeFcstdThumbnail(data.root, "Synthetic.FCStd", Buffer.from("not png"), data.hash)).toThrow(/PNG/);
  expect(() => writeFcstdThumbnail(data.root, "Synthetic.FCStd", png, "stale")).toThrow(/已变化/);
  expect(fs.readFileSync(data.filename)).toEqual(data.before);
  expect(fs.existsSync(path.join(data.root, ".phoenix"))).toBe(false);
});
it("rejects a symlink rather than writing a thumbnail to its target", () => {
  const data = fixture(); fs.symlinkSync(data.filename, path.join(data.root, "Alias.FCStd"));
  expect(() => writeFcstdThumbnail(data.root, "Alias.FCStd", png, data.hash)).toThrow(/符号链接/);
  expect(fs.readFileSync(data.filename)).toEqual(data.before);
});
it("leaves the source and durable backup readable when atomic replacement cannot start", () => {
  const data = fixture(true);
  const rename = fs.renameSync;
  const realFilename = fs.realpathSync(data.filename);
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { if (to === realFilename) throw new Error("synthetic rename failure"); return rename(from, to); });
  expect(() => writeFcstdThumbnail(data.root, "Synthetic.FCStd", png, data.hash)).toThrow(/rename failure/);
  expect(fs.readFileSync(data.filename)).toEqual(data.before);
  const backupDir = path.join(data.root, ".phoenix/thumbnail-backups");
  expect(fs.readdirSync(backupDir)).toHaveLength(1);
  expect(fs.readFileSync(path.join(backupDir, fs.readdirSync(backupDir)[0]))).toEqual(data.before);
});
it("uses random exclusively-created temporary files and does not follow the legacy predictable symlink", () => {
  const data = fixture(), outside = fs.mkdtempSync(path.join(os.tmpdir(), "thumbnail-sentinel-")); roots.push(outside);
  const sentinel = path.join(outside, "sentinel.txt"); fs.writeFileSync(sentinel, "unchanged sentinel");
  vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  const legacy = path.join(data.root, `.Synthetic.FCStd.phoenix-${process.pid}-1700000000000.tmp`);
  fs.symlinkSync(sentinel, legacy);
  const write = vi.spyOn(fs, "writeFileSync");
  const result = writeFcstdThumbnail(data.root, "Synthetic.FCStd", png, data.hash);
  const temporaryCall = write.mock.calls.find(([name]) => String(name).includes(".thumbnail-") && String(name).endsWith(".tmp"));
  expect(temporaryCall?.[2]).toMatchObject({ flag: "wx" });
  expect(fs.readFileSync(sentinel, "utf8")).toBe("unchanged sentinel");
  expect(fs.lstatSync(legacy).isSymbolicLink()).toBe(true);
  expect(fs.readFileSync(path.join(data.root, result.backup))).toEqual(data.before);
  expect(extractFcstdThumbnail(fs.readFileSync(data.filename))?.bytes).toEqual(png);
});
it("reports success and retains the durable backup if temporary cleanup fails after commit", () => {
  const data = fixture(), remove = fs.rmSync;
  vi.spyOn(fs, "rmSync").mockImplementation((name, options) => { if (String(name).includes(".thumbnail-") && String(name).endsWith(".tmp")) throw new Error("synthetic cleanup failure"); return remove(name, options); });
  const result = writeFcstdThumbnail(data.root, "Synthetic.FCStd", png, data.hash);
  expect(extractFcstdThumbnail(fs.readFileSync(data.filename))?.bytes).toEqual(png);
  expect(fs.readFileSync(path.join(data.root, result.backup))).toEqual(data.before);
});
