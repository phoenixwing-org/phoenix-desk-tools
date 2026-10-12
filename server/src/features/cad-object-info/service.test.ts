import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { zipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCadObjectInfo } from "./service.js";
import { cadObjectInfoRoutes, createCadObjectInfoRoutes } from "./routes.js";
import { CadObjectInfoBudget } from "./budget.js";
import { CAD_OBJECT_REQUEST_BYTES } from "./request.js";

let root: string;
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-object-info-test-"))); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
const xml = '<Document><ObjectData><Object name="Sample" type="Part::Feature"><Properties><Property name="Label"><String value="Synthetic"/></Property></Properties></Object></ObjectData></Document>';
function archive(name = "sample.FCStd", content = xml) {
  const file = path.join(root, name);
  fs.writeFileSync(file, zipSync({ "Document.xml": strToU8(content), "shape.bin": new Uint8Array([1, 2, 3]) }));
  return file;
}
describe("read-only bounded CAD object IO and API", () => {
  it("reads relative/absolute paths without mutating archive or creating a database", async () => {
    const file = archive(); const before = fs.readFileSync(file); const stat = fs.statSync(file);
    const result = await readCadObjectInfo(root, "./sample.FCStd");
    expect(result.document.objects[0].label).toBe("Synthetic");
    expect(result.source).toEqual({ file_size: stat.size, mtime_ms: stat.mtimeMs, document_xml_bytes: Buffer.byteLength(xml, "utf8") });
    expect((await readCadObjectInfo(root, file)).document).toEqual(result.document);
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readdirSync(root)).toEqual(["sample.FCStd"]);
  });
  it.each([0, 6] as const)("reports original UTF-8 Document.xml bytes for ZIP level %s, including BOM and multibyte text", async level => {
    // Independent metadata-only UTF-8 sample, not copied from a model or inventory.
    const label = "独立字节测试🙂é";
    const content = `\uFEFF<?xml version="1.0" encoding="UTF-8"?><Document><ObjectData><Object name="ByteSample" type="Part::Feature"><Properties><Property name="Label"><String value="${label}"/></Property></Properties></Object></ObjectData></Document>`;
    const documentBytes = strToU8(content);
    const file = path.join(root, "utf8.FCStd");
    const bytes = zipSync({ "Document.xml": documentBytes, "opaque.bin": new Uint8Array([17, 0, 255]) }, { level });
    fs.writeFileSync(file, bytes);
    const result = await readCadObjectInfo(root, "utf8.FCStd");
    expect(result.source.document_xml_bytes).toBe(documentBytes.byteLength);
    expect(result.source.document_xml_bytes).toBe(Buffer.byteLength(content, "utf8"));
    expect(result.source.document_xml_bytes).toBeGreaterThan(content.length);
    expect(result.source.file_size).toBe(bytes.byteLength);
    expect(result.source.document_xml_bytes).not.toBe(result.source.file_size);
    expect(result.document.objects[0].label).toBe(label);
    expect(fs.readFileSync(file)).toEqual(Buffer.from(bytes));
    expect(fs.readdirSync(root)).toEqual(["utf8.FCStd"]);
  });
  it("rejects path escape and symlink paths", async () => {
    archive();
    await expect(readCadObjectInfo(root, "../outside.FCStd")).rejects.toMatchObject({ code: "path_escape" });
    fs.symlinkSync(path.join(root, "sample.FCStd"), path.join(root, "alias.FCStd"));
    await expect(readCadObjectInfo(root, "alias.FCStd")).rejects.toMatchObject({ code: "path_escape" });
  });
  it("revalidates the path after a queued read and accepts a workspace entry-point alias", async () => {
    archive();
    fs.symlinkSync(root, path.join(root, "entry"));
    expect((await readCadObjectInfo(path.join(root, "entry"), path.join(root, "entry", "sample.FCStd"))).document.objects).toHaveLength(1);
    const pending = readCadObjectInfo(root, "sample.FCStd");
    fs.renameSync(path.join(root, "sample.FCStd"), path.join(root, "original.FCStd"));
    fs.symlinkSync(path.join(root, "original.FCStd"), path.join(root, "sample.FCStd"));
    await expect(pending).rejects.toMatchObject({ code: "path_escape" });
  });
  it("exposes missing files, wrong extensions, directories, missing XML and malformed archives", async () => {
    await expect(readCadObjectInfo(root, "missing.FCStd")).rejects.toMatchObject({ code: "io_error" });
    fs.writeFileSync(path.join(root, "sample.txt"), "nothing");
    await expect(readCadObjectInfo(root, "sample.txt")).rejects.toMatchObject({ code: "invalid_arguments" });
    fs.mkdirSync(path.join(root, "directory.FCStd"));
    await expect(readCadObjectInfo(root, "directory.FCStd")).rejects.toMatchObject({ code: "invalid_arguments" });
    fs.writeFileSync(path.join(root, "empty.FCStd"), zipSync({ "Other.xml": strToU8("<Document/>") }));
    await expect(readCadObjectInfo(root, "empty.FCStd")).rejects.toMatchObject({ code: "missing_document_xml" });
    fs.writeFileSync(path.join(root, "bad.FCStd"), "not a ZIP");
    await expect(readCadObjectInfo(root, "bad.FCStd")).rejects.toMatchObject({ code: "invalid_fcstd_archive" });
    const file = archive(); const bytes = fs.readFileSync(file); fs.writeFileSync(file, bytes.subarray(0, bytes.length - 15));
    await expect(readCadObjectInfo(root, file)).rejects.toMatchObject({ code: "invalid_fcstd_archive" });
  });
  it("exposes bad XML and compressed/raw resource limits", async () => {
    archive("badXml.FCStd", "<Document><Bad></Document>");
    await expect(readCadObjectInfo(root, "badXml.FCStd")).rejects.toMatchObject({ code: "invalid_document_xml" });
    archive("largeXml.FCStd", `<Document>${" ".repeat(16 * 1024 * 1024)}</Document>`);
    await expect(readCadObjectInfo(root, "largeXml.FCStd")).rejects.toMatchObject({ code: "resource_limit" });
    const file = archive("large.FCStd"); fs.truncateSync(file, 64 * 1024 * 1024 + 1);
    await expect(readCadObjectInfo(root, file)).rejects.toMatchObject({ code: "resource_limit" });
  });
  it("rejects invalid XML UTF-8 and exposes archive CRC mismatch before projection", async () => {
    fs.writeFileSync(path.join(root, "badUtf8.FCStd"), zipSync({ "Document.xml": new Uint8Array([...strToU8("<Document>"), 255, ...strToU8("</Document>")]) }));
    await expect(readCadObjectInfo(root, "badUtf8.FCStd")).rejects.toMatchObject({ code: "invalid_document_xml" });
    const content = '<Document name="Synthetic"/>';
    const bytes = zipSync({ "Document.xml": strToU8(content) }, { level: 0 }); bytes[42 + content.indexOf("Synthetic")] = 88;
    fs.writeFileSync(path.join(root, "badCrc.FCStd"), bytes);
    await expect(readCadObjectInfo(root, "badCrc.FCStd")).rejects.toMatchObject({ code: "invalid_fcstd_archive" });
  });
  it("rejects a changed snapshot", async () => {
    const file = archive(); const originalStat = fs.statSync.bind(fs); let calls = 0;
    vi.spyOn(fs, "statSync").mockImplementation(((name: fs.PathLike, options?: fs.StatSyncOptions) => {
      const stat = originalStat(name, options as { bigint?: false });
      if (String(name) === file && ++calls === 3) return { ...stat, mtimeMs: stat.mtimeMs + 1 };
      return stat;
    }) as typeof fs.statSync);
    await expect(readCadObjectInfo(root, file)).rejects.toMatchObject({ code: "source_changed" });
  });
  it("honors cancellation without returning a document", async () => {
    archive(); const controller = new AbortController(); controller.abort();
    await expect(readCadObjectInfo(root, "sample.FCStd", controller.signal)).rejects.toMatchObject({ code: "cancelled" });
  });
  it("rejects inherited XLink label amplification beyond the production complete-response cap", async () => {
    const label = "L".repeat(70 * 1024);
    const content = `<Document><ObjectData><Object name="Host" type="App::Link"><Properties><Property name="Label"><String value="${label}"/></Property></Properties>${'<XLink file="part.FCStd"/>'.repeat(1000)}</Object></ObjectData></Document>`;
    const file = archive("amplified.FCStd", content); const before = fs.readFileSync(file);
    expect(Buffer.byteLength(content)).toBeLessThan(128 * 1024);
    await expect(readCadObjectInfo(root, file)).rejects.toMatchObject({ code: "resource_limit" });
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readdirSync(root)).toEqual(["amplified.FCStd"]);
  });
  it("counts the entire success envelope rather than just document under an injected lower output cap", async () => {
    archive(); const result = await readCadObjectInfo(root, "sample.FCStd");
    const documentBytes = Buffer.byteLength(JSON.stringify(result.document));
    await expect(readCadObjectInfo(root, "sample.FCStd", undefined, new CadObjectInfoBudget(undefined, { bytes: documentBytes })))
      .rejects.toMatchObject({ code: "resource_limit" });
  });
  it("shares the deadline across queued file reading and parsing", async () => {
    archive(); let now = 0;
    const pending = readCadObjectInfo(root, "sample.FCStd", undefined, new CadObjectInfoBudget(undefined, { durationMs: 5, now: () => now }));
    now = 5;
    await expect(pending).rejects.toMatchObject({ code: "timeout" });
    expect(fs.readdirSync(root)).toEqual(["sample.FCStd"]);
  });
  it("exposes output overflow and deadline failures in route responses without accepting request budget overrides", async () => {
    archive();
    const limited = createCadObjectInfoRoutes({ bytes: 100 });
    const request = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspacePath: root, filePath: "sample.FCStd", bytes: 1_000_000_000, durationMs: 1_000_000 }) };
    const overflow = await limited.request("/", request);
    expect(overflow.status).toBe(413); expect(await overflow.json()).toMatchObject({ success: false, code: "resource_limit" });
    let now = 0;
    const timed = createCadObjectInfoRoutes({ durationMs: 1, now: () => now++ });
    const timeout = await timed.request("/", request);
    expect(timeout.status).toBe(408); expect(await timeout.json()).toMatchObject({ success: false, code: "timeout" });
  });
  it("exposes a deadline for a request body that has not finished arriving", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(strToU8('{"workspacePath":')); }, cancel });
    const request = new Request("http://localhost/", { method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half" } as RequestInit);
    const response = await createCadObjectInfoRoutes({ durationMs: 5 }).fetch(request);
    expect(response.status).toBe(408);
    expect(await response.json()).toMatchObject({ success: false, code: "timeout" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("rejects oversized JSON request bytes with no length header and with an understated length header", async () => {
    archive();
    const body = JSON.stringify({ workspacePath: root, filePath: "sample.FCStd", ignored: "x".repeat(CAD_OBJECT_REQUEST_BYTES) });
    for (const length of [undefined, "1"]) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (length) headers["Content-Length"] = length;
      const response = await cadObjectInfoRoutes.request("/", { method: "POST", headers, body });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ success: false, code: "resource_limit", error: expect.stringContaining("64 KiB") });
    }
    expect(fs.readdirSync(root)).toEqual(["sample.FCStd"]);
  });
  it("rejects an oversized declared request before collecting body chunks", async () => {
    const response = await cadObjectInfoRoutes.request("/", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": String(CAD_OBJECT_REQUEST_BYTES + 1) }, body: "{}" });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ success: false, code: "resource_limit" });
  });
  it("serves the agreed mounted route, validates input and exposes resource errors", async () => {
    archive(); const app = new Hono(); app.route("/api/cad/object-info", cadObjectInfoRoutes);
    const post = (body: unknown) => app.request("/api/cad/object-info", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const response = await post({ workspacePath: root, filePath: "sample.FCStd" });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true, data: {
      document: { root_names: ["Sample"] }, source: { document_xml_bytes: Buffer.byteLength(xml, "utf8") },
    } });
    const bad = await post({ workspacePath: root, filePath: null }); expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ success: false, code: "invalid_arguments" });
    archive("large.FCStd", `<Document>${" ".repeat(16 * 1024 * 1024)}</Document>`);
    const large = await post({ workspacePath: root, filePath: "large.FCStd" }); expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({ success: false, code: "resource_limit" });
  });
});
