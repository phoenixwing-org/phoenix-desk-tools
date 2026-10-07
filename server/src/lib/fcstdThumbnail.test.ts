import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { afterEach, expect, it } from "vitest";
import { extractFcstdThumbnail, readFileThumbnail } from "./fcstdThumbnail.js";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6mcAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it("reads saved thumbnails without XML, an index, or writes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-thumbnail-")); roots.push(root);
  const archive = zipSync({ "thumbnails/Thumbnail.png": png, "Shape.brp": strToU8("unchanged") });
  fs.writeFileSync(path.join(root, "Demo.FCStd"), archive);
  expect(readFileThumbnail(root, "Demo.FCStd")).toEqual({ data_url: `data:image/png;base64,${png.toString("base64")}`, width: 1, height: 1 });
  expect(fs.readFileSync(path.join(root, "Demo.FCStd"))).toEqual(Buffer.from(archive));
  expect(fs.readdirSync(root)).toEqual(["Demo.FCStd"]);
  for (const rel of ["../Demo.FCStd", "/Demo.FCStd", "C:/Demo.FCStd", "Demo.txt"]) expect(() => readFileThumbnail(root, rel)).toThrow();
  fs.symlinkSync(path.join(root, "Demo.FCStd"), path.join(root, "Alias.FCStd"));
  expect(() => readFileThumbnail(root, "Alias.FCStd")).toThrow(/符号链接/);
});
it("handles absent images and bounds corrupt, oversized, or unsafe PNG images", () => {
  expect(extractFcstdThumbnail(zipSync({ "Document.xml": strToU8("<Document/>") }))).toBeNull();
  for (const content of [strToU8("not PNG"), new Uint8Array(4 * 1024 * 1024 + 1)]) expect(() => extractFcstdThumbnail(zipSync({ "thumbnails/Thumbnail.png": content }))).toThrow();
  const large = Buffer.from(png); large.writeUInt32BE(5000, 16);
  expect(() => extractFcstdThumbnail(zipSync({ "thumbnails/Thumbnail.png": large }))).toThrow(/尺寸/);
});
