import { describe, expect, it } from "vitest";
import { zipSync, strToU8, unzipSync } from "fflate";
import { verifyCadObjectArchive } from "./archive.js";

function sample() { return zipSync({ "Document.xml": strToU8("<Document/>"), "untouched.bin": new Uint8Array([1, 2]) }, { level: 0 }); }
function central(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(bytes.length - 22 + 16, true);
}
describe("bounded ZIP integrity guard", () => {
  it("accepts standard compressed/stored ZIPs and comments", () => {
    for (const level of [0, 6] as const) {
      const bytes = zipSync({ "Document.xml": strToU8("<Document/>") }, { level, comment: "synthetic" });
      expect(() => verifyCadObjectArchive(bytes, unzipSync(bytes)["Document.xml"])).not.toThrow();
    }
  });
  it("rejects stored XML bytes changed despite remaining valid XML", () => {
    const bytes = sample(); bytes[43] = 100;
    expect(() => verifyCadObjectArchive(bytes, unzipSync(bytes)["Document.xml"])).toThrow();
  });
  it("rejects inconsistent local/central headers and broken central signatures", () => {
    const bytes = sample(); bytes[14] ^= 1;
    expect(() => verifyCadObjectArchive(bytes, strToU8("<Document/>"))).toThrow();
    const broken = sample(); broken[central(broken)] = 0;
    expect(() => verifyCadObjectArchive(broken, strToU8("<Document/>"))).toThrow();
  });
  it("rejects a local filename different from the directory and unsupported multi-volume metadata", () => {
    const bytes = sample(); bytes[30] = 88;
    expect(() => verifyCadObjectArchive(bytes, strToU8("<Document/>"))).toThrow();
    const split = sample(); split[split.length - 22 + 4] = 1;
    expect(() => verifyCadObjectArchive(split, strToU8("<Document/>"))).toThrow();
  });
  it("rejects oversized ZIP entry counts", () => {
    const files: Record<string, Uint8Array> = { "Document.xml": strToU8("<Document/>") };
    for (let i = 0; i < 10000; i++) files[`empty${i}`] = new Uint8Array();
    const bytes = zipSync(files, { level: 0 });
    expect(() => verifyCadObjectArchive(bytes, files["Document.xml"])).toThrowError(expect.objectContaining({ code: "resource_limit" }));
  });
  it("rejects duplicate Document.xml entries, false sizes and trailing bytes", () => {
    const bytes = sample(); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const start = central(bytes), second = start + 46 + view.getUint16(start + 28, true);
    const fake = bytes.slice();
    // Make the second central entry impersonate the same local Document.xml.
    const fv = new DataView(fake.buffer); fv.setUint32(second + 42, 0, true);
    fake.set(bytes.subarray(start + 8, start + 28), second + 8);
    fv.setUint16(second + 28, 12, true); fake.set(strToU8("Document.xml"), second + 46);
    expect(() => verifyCadObjectArchive(fake, strToU8("<Document/>"))).toThrow();
    const size = sample(); new DataView(size.buffer).setUint32(central(size) + 24, 1, true);
    expect(() => verifyCadObjectArchive(size, strToU8("<Document/>"))).toThrow();
    const trailing = new Uint8Array(bytes.length + 1); trailing.set(bytes);
    expect(() => verifyCadObjectArchive(trailing, strToU8("<Document/>"))).toThrow();
  });
});
