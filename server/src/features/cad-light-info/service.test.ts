import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CadObjectInfoBudget } from "../cad-object-info/budget.js";
import { readCadObjectInfo } from "../cad-object-info/service.js";
import { buildCadLightDiagnostics, cadLightInfoFailure, readCadLightInfo } from "./service.js";
import { CadObjectInfoError } from "../cad-object-info/error.js";
import { FCSTD_LIGHT_XML_BYTES, readFcstdBatchArchive } from "../../lib/fcstdBatchFiles.js";

let root: string;
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-independent-light-"))); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
function save(rel: string, xml: string, options: { name?: string; level?: 0 | 6 } = {}) {
  const filename = path.join(root, rel); fs.mkdirSync(path.dirname(filename), { recursive: true });
  const bytes = zipSync({ [options.name || "Document.xml"]: strToU8(xml), "opaque.bin": new Uint8Array([7, 19, 0, 255]) }, { level: options.level ?? 6 });
  fs.writeFileSync(filename, bytes); return { filename, bytes };
}
const body = `<Document><Objects><Object name="Primary" type="PartDesign::Body"/></Objects><ObjectData><Object name="Primary"><Properties>
  <Property name="Label"><String value="Independent &amp; label"/></Property>
  <Property name="PartNumber"><String value="SYNTHETIC"/></Property><Property name="PartVersion"><String value="A"/></Property>
  <Property name="TypeCode"><String value="h"/></Property><Property name="ModelSeries"><String value="test"/></Property>
  <Property name="PartName"><String value="Metadata example"/></Property>
  </Properties></Object></ObjectData></Document>`;
describe("standalone light summary and ephemeral workspace diagnostics", () => {
  it("rejects raw quoted greater-than attributes instead of returning a false zero-link summary", async () => {
    save("Host.FCStd", `<Document><Objects><Object name="RawLink" type="App::Link"/></Objects><ObjectData>
      <Object name="RawLink"><Properties><Property name="LinkedObject"><XLink file='a>b.FCStd' label="Quoted edge"/></Property></Properties></Object>
      </ObjectData><XLink file="Ordinary.FCStd"/></Document>`);
    await expect(readCadLightInfo(root, "Host.FCStd")).rejects.toMatchObject({ code: "invalid_document_xml", message: expect.stringContaining("完整对象") });
    expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
    expect((await readCadObjectInfo(root, "Host.FCStd")).document.xlinks).toHaveLength(1);
  });
  it("does not interpret comment/CDATA greater-than examples and still supports encoded attribute values", async () => {
    save("Host.FCStd", `<Document><!-- <XLink file='comment>example.FCStd'/> -->
      <Note><![CDATA[<XLink file="cdata>example.FCStd"/>]]></Note><XLink file="a&gt;b.FCStd"/></Document>`);
    save("a>b.FCStd", "<Document/>");
    const result = await readCadLightInfo(root, "Host.FCStd");
    expect(result.analysis.xlinks).toEqual([{ file: "a>b.FCStd", label: "" }]);
    expect(result.diagnostics.items).toMatchObject([{ status: "resolved", targetRelativePath: "a>b.FCStd" }]);
  });
  it("prefers exact paths, allows one folded match, and never picks arbitrarily among case collisions", async () => {
    const files = ["Host.FCStd", "parts/PROBE.FCStd", "parts/probe.fcstd"];
    const result = await buildCadLightDiagnostics("Host.FCStd", [
      { file: "parts/PROBE.FCStd", label: "" }, { file: "parts/probe.fcstd", label: "" }, { file: "parts/Probe.FCStd", label: "" },
    ], files, new CadObjectInfoBudget(), 0);
    expect(result.items[0]).toMatchObject({ status: "resolved", targetRelativePath: "parts/PROBE.FCStd", candidates: [] });
    expect(result.items[1]).toMatchObject({ status: "resolved", targetRelativePath: "parts/probe.fcstd", candidates: [] });
    expect(result.items[2]).toMatchObject({ status: "ambiguous", candidates: ["parts/PROBE.FCStd", "parts/probe.fcstd"] });
    const unique = await buildCadLightDiagnostics("Host.FCStd", [{ file: "parts/Probe.FCStd", label: "" }], files.slice(0, 2), new CadObjectInfoBudget(), 0);
    expect(unique.items[0]).toMatchObject({ status: "resolved", targetRelativePath: "parts/PROBE.FCStd" });
  });
  it("bounds expanded diagnostics cumulatively rather than only individual items", async () => {
    const links = Array.from({ length: 12 }, (_, i) => ({ file: `missing-${i}.FCStd`, label: "" }));
    const one = await buildCadLightDiagnostics("Host.FCStd", links.slice(0, 1), [], new CadObjectInfoBudget(undefined, { bytes: 400 }), 0);
    expect(one.items).toHaveLength(1);
    await expect(buildCadLightDiagnostics("Host.FCStd", links, [], new CadObjectInfoBudget(undefined, { bytes: 400 }), 0))
      .rejects.toMatchObject({ code: "resource_limit" });
  });
  it("retains directory cancellation and close failure without losing the primary code", async () => {
    save("Host.FCStd", "<Document/>");
    const cancelled = new CadObjectInfoError("cancelled", "读取已取消"), cleanup = new Error("synthetic directory close failure"), open = fs.opendirSync.bind(fs);
    vi.spyOn(fs, "opendirSync").mockImplementation(((...args: Parameters<typeof fs.opendirSync>) => {
      const directory = open(...args), close = directory.closeSync.bind(directory);
      vi.spyOn(directory, "readSync").mockImplementation(() => { throw cancelled; });
      vi.spyOn(directory, "closeSync").mockImplementation(() => { close(); throw cleanup; });
      return directory;
    }) as typeof fs.opendirSync);
    try { await readCadLightInfo(root, "Host.FCStd"); throw new Error("unexpected success"); }
    catch (error) {
      expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors).toEqual([cancelled, cleanup]);
      expect(cadLightInfoFailure(error)?.code).toBe("cancelled");
    }
  });
  it.each([0, 6] as const)("carries the complete legacy analysis without CAD/DB writes, ZIP level %s", async level => {
    const content = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>${body.replace("Metadata example", "独立摘要🙂")}`;
    const file = save("Specimen.FCStd", content, { level }); const before = fs.statSync(file.filename);
    const result = await readCadLightInfo(root, "./Specimen.FCStd");
    expect(result.analysis).toEqual({ documentXmlBytes: Buffer.byteLength(content), objectCount: 1, xlinks: [],
      embeddedFields: { PartNumber: "SYNTHETIC", PartVersion: "A", TypeCode: "H", ModelSeries: "TEST", PartName: "独立摘要🙂", label: "Independent & label" } });
    expect(result.source).toEqual({ file_size: before.size, mtime_ms: before.mtimeMs });
    expect(result.diagnostics.counts).toEqual({ resolved: 0, ambiguous: 0, missing: 0, self: 0, non_fcstd: 0 });
    expect(result.warnings).toEqual([]); expect(fs.readFileSync(file.filename)).toEqual(Buffer.from(file.bytes));
    expect(fs.statSync(file.filename).mtimeMs).toBe(before.mtimeMs); expect(fs.readdirSync(root)).toEqual(["Specimen.FCStd"]);
    expect((await readCadLightInfo(root, file.filename)).analysis).toEqual(result.analysis);
  });
  it("keeps file-deduplication, object Label priority and direct links separate from full instance projection", async () => {
    const xml = `<Document><Objects><Object name="First" type="App::Link"/><Object name="Second" type="App::Link"/></Objects><ObjectData>
      <Object name="First"><Properties><Property name="Label"><String value="Saved object label"/></Property>
      <Property name="LinkedObject"><XLink file="Target.FCStd" label="Serialized link label"/></Property></Properties></Object>
      <Object name="Second"><Properties><Property name="LinkedObject"><XLink file="Target.FCStd"/></Property></Properties></Object>
      </ObjectData><XLink file="Other.FCStd" label="Direct reference"/><XLink file="notes.md"/></Document>`;
    save("Host.FCStd", xml); save("Target.FCStd", "<Document/>");
    const result = await readCadLightInfo(root, "Host.FCStd");
    expect(result.analysis.objectCount).toBe(2);
    expect(result.analysis.xlinks).toEqual([{ file: "Target.FCStd", label: "Saved object label" }, { file: "Other.FCStd", label: "Direct reference" }]);
    expect(result.diagnostics.counts).toMatchObject({ resolved: 1, missing: 1 });
    const full = await readCadObjectInfo(root, "Host.FCStd");
    expect(full.document.xlinks).toHaveLength(2); expect(full.document.xlinks[0].label).toBe("Serialized link label");
  });
  it("resolves from disk with no index: direct, Windows separators, ambiguous suggestion, missing and self", async () => {
    save("parts/Leaf.FCStd", "<Document/>"); save("left/Repeated.FCStd", "<Document/>"); save("right/Repeated.FCStd", "<Document/>");
    save("assy/Host.FCStd", `<Document><XLink file="..\\parts\\Leaf.FCStd"/><XLink file="Repeated.FCStd"/>
      <XLink file="Absent.FCStd"/><XLink file="Host.FCStd"/></Document>`);
    const result = await readCadLightInfo(root, "assy/Host.FCStd");
    expect(result.diagnostics.counts).toEqual({ resolved: 1, ambiguous: 1, missing: 1, self: 1, non_fcstd: 0 });
    expect(result.diagnostics.items[0]).toMatchObject({ file: "../parts/Leaf.FCStd", status: "resolved", targetRelativePath: "parts/Leaf.FCStd", candidates: [] });
    expect(result.diagnostics.items[1]).toMatchObject({ status: "ambiguous", targetRelativePath: "left/Repeated.FCStd", candidates: ["left/Repeated.FCStd", "right/Repeated.FCStd"] });
    expect(result.diagnostics.items[2]).toMatchObject({ status: "missing", targetRelativePath: null });
    expect(result.diagnostics.items[3]).toMatchObject({ status: "self", targetRelativePath: "assy/Host.FCStd" });
    expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
  });
  it("uses the approved discovery exclusions without opening dependency contents", async () => {
    for (const rel of [".cache/Target.FCStd", "node_modules/Target.FCStd", "__pycache__/Target.FCStd", "Target.FCStd"]) save(rel, "not parsed by diagnostics");
    save("Host.FCStd", '<Document><XLink file="Target.FCStd"/></Document>');
    const result = await readCadLightInfo(root, "Host.FCStd");
    expect(result.diagnostics.items[0]).toMatchObject({ status: "resolved", targetRelativePath: "Target.FCStd", candidates: [] });
  });
  it("supports case-insensitive member names but rejects every duplicate alias", async () => {
    save("Case.FCStd", "<Document/>", { name: "dOcUmEnT.xMl" });
    expect((await readCadLightInfo(root, "Case.FCStd")).analysis).toMatchObject({ objectCount: 0, documentXmlBytes: 11 });
    expect(() => readFcstdBatchArchive(path.join(root, "Case.FCStd"))).toThrow(/缺少 Document/);
    fs.writeFileSync(path.join(root, "Case.FCStd"), zipSync({ "Document.xml": strToU8("<Document/>"), "document.XML": strToU8("<Document/>") }));
    await expect(readCadLightInfo(root, "Case.FCStd")).rejects.toMatchObject({ code: "invalid_fcstd_archive" });
  });
  it("accepts the actual 32 MiB boundary, rejects +1, and leaves full/write at 16 MiB", async () => {
    const prefix = "<Document>", suffix = "</Document>";
    const xml = prefix + " ".repeat(FCSTD_LIGHT_XML_BYTES - prefix.length - suffix.length) + suffix;
    const file = save("Boundary.FCStd", xml);
    expect((await readCadLightInfo(root, "Boundary.FCStd")).analysis.documentXmlBytes).toBe(FCSTD_LIGHT_XML_BYTES);
    expect(() => readFcstdBatchArchive(file.filename)).toThrow(/安全上限/);
    await expect(readCadObjectInfo(root, "Boundary.FCStd")).rejects.toMatchObject({ code: "resource_limit" });
    save("Boundary.FCStd", `${xml} `);
    await expect(readCadLightInfo(root, "Boundary.FCStd")).rejects.toMatchObject({ code: "resource_limit" });
  });
  it.each(["add", "remove", "rename", "replace-directory"])("rejects an inventory %s at the deterministic final gate", async kind => {
    save("Host.FCStd", "<Document/>"); save("parts/Target.FCStd", "<Document/>");
    await expect(readCadLightInfo(root, "Host.FCStd", undefined, undefined, { beforeFinalCheck() {
      if (kind === "add") save("New.FCStd", "<Document/>");
      if (kind === "remove") fs.unlinkSync(path.join(root, "parts/Target.FCStd"));
      if (kind === "rename") fs.renameSync(path.join(root, "parts/Target.FCStd"), path.join(root, "parts/Renamed.FCStd"));
      if (kind === "replace-directory") { fs.renameSync(path.join(root, "parts"), path.join(root, ".previous")); save("parts/Target.FCStd", "<Document/>"); }
    } })).rejects.toMatchObject({ code: "source_changed" });
  });
  it("rejects changed source bytes even if observable source stats are held constant", async () => {
    const file = save("Host.FCStd", body, { level: 0 }), captured = fs.statSync(file.filename), stat = fs.statSync.bind(fs);
    vi.spyOn(fs, "statSync").mockImplementation(((name: fs.PathLike, options?: fs.StatSyncOptions) => String(name) === file.filename ? captured : stat(name, options as { bigint?: false })) as typeof fs.statSync);
    await expect(readCadLightInfo(root, "Host.FCStd", undefined, undefined, { beforeFinalCheck() {
      save("Host.FCStd", body.replace("Metadata example", "Metadata changed"), { level: 0 });
    } })).rejects.toMatchObject({ code: "source_changed" });
  });
  it("rejects source replacement and late symlink rather than returning a partial snapshot", async () => {
    save("Host.FCStd", "<Document/>");
    await expect(readCadLightInfo(root, "Host.FCStd", undefined, undefined, { beforeFinalCheck() {
      fs.renameSync(path.join(root, "Host.FCStd"), path.join(root, "Saved.FCStd")); fs.symlinkSync("Saved.FCStd", path.join(root, "Host.FCStd"));
    } })).rejects.toMatchObject({ code: "path_escape" });
  });
  it("rejects workspace escape, child symlinks, unsafe inventory and control characters", async () => {
    save("Host.FCStd", "<Document/>");
    await expect(readCadLightInfo(root, "../Outside.FCStd")).rejects.toMatchObject({ code: "path_escape" });
    await expect(readCadLightInfo(root, "/Independent/Outside.FCStd")).rejects.toMatchObject({ code: "path_escape" });
    await expect(readCadLightInfo(root, "Invalid\n.FCStd")).rejects.toMatchObject({ code: "invalid_arguments" });
    fs.symlinkSync("Host.FCStd", path.join(root, "Alias.FCStd"));
    await expect(readCadLightInfo(root, "Alias.FCStd")).rejects.toMatchObject({ code: "path_escape" });
    await expect(readCadLightInfo(root, "Host.FCStd")).rejects.toMatchObject({ code: "path_escape" });
  });
  it("exposes missing XML, malformed XML/ZIP, UTF-8 and CRC failures with safe typed errors", async () => {
    const file = path.join(root, "Broken.FCStd");
    fs.writeFileSync(file, zipSync({ "Other.xml": strToU8("<Document/>") }));
    await expect(readCadLightInfo(root, "Broken.FCStd")).rejects.toMatchObject({ code: "missing_document_xml" });
    save("Broken.FCStd", "<Document><Bad></Document>");
    await expect(readCadLightInfo(root, "Broken.FCStd")).rejects.toMatchObject({ code: "invalid_document_xml" });
    fs.writeFileSync(file, zipSync({ "Document.xml": new Uint8Array([...strToU8("<Document>"), 255, ...strToU8("</Document>")]) }));
    await expect(readCadLightInfo(root, "Broken.FCStd")).rejects.toMatchObject({ code: "invalid_document_xml" });
    const content = '<Document name="Synthetic"/>', bytes = zipSync({ "Document.xml": strToU8(content) }, { level: 0 });
    bytes[42 + content.indexOf("Synthetic")] = 88; fs.writeFileSync(file, bytes);
    await expect(readCadLightInfo(root, "Broken.FCStd")).rejects.toMatchObject({ code: "invalid_fcstd_archive" });
    fs.writeFileSync(file, "not a ZIP");
    await expect(readCadLightInfo(root, "Broken.FCStd")).rejects.toMatchObject({ code: "invalid_fcstd_archive" });
    await expect(readCadLightInfo(root, "Missing.FCStd")).rejects.toMatchObject({ code: "io_error", message: expect.not.stringContaining(root) });
  });
  it("enforces lowered inventory and response budgets without accepting higher production limits", async () => {
    save("Host.FCStd", "<Document/>"); save("Other.FCStd", "<Document/>");
    await expect(readCadLightInfo(root, "Host.FCStd", undefined, undefined, { limits: { files: 1 } })).rejects.toMatchObject({ code: "resource_limit" });
    await expect(readCadLightInfo(root, "Host.FCStd", undefined, undefined, { limits: { entries: 1 } })).rejects.toMatchObject({ code: "resource_limit" });
    await expect(readCadLightInfo(root, "Host.FCStd", undefined, undefined, { limits: { files: 5001 } })).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(readCadLightInfo(root, "Host.FCStd", undefined, new CadObjectInfoBudget(undefined, { bytes: 100 }))).rejects.toMatchObject({ code: "resource_limit" });
  });
  it("counts directory entries across the entire traversal, not once per directory", async () => {
    save("Host.FCStd", "<Document/>"); save("first/One.FCStd", "<Document/>"); save("second/Two.FCStd", "<Document/>");
    await expect(readCadLightInfo(root, "Host.FCStd", undefined, undefined, { limits: { entries: 4 } })).rejects.toMatchObject({ code: "resource_limit" });
    expect((await readCadLightInfo(root, "Host.FCStd", undefined, undefined, { limits: { entries: 5 } })).analysis.objectCount).toBe(0);
  });
  it("honors initial/late cancellation and the shared deadline without writing files", async () => {
    save("Host.FCStd", "<Document/>"); const controller = new AbortController(); controller.abort();
    await expect(readCadLightInfo(root, "Host.FCStd", controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    const late = new AbortController();
    await expect(readCadLightInfo(root, "Host.FCStd", late.signal, undefined, { beforeFinalCheck() { late.abort(); } })).rejects.toMatchObject({ code: "cancelled" });
    let now = 0;
    await expect(readCadLightInfo(root, "Host.FCStd", undefined, new CadObjectInfoBudget(undefined, { durationMs: 5, now: () => now }),
      { beforeFinalCheck() { now = 5; } })).rejects.toMatchObject({ code: "timeout" });
    expect(fs.readdirSync(root)).toEqual(["Host.FCStd"]);
  });
});
