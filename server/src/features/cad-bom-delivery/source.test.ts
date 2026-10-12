import { describe, expect, it } from "vitest";
import { CadBomTransferValidationError, canonicalCadBomTransferJson } from "./envelope.js";
import { buildCadBomTransferFromSource, type CadBomSourceAsset, type CadBomSourceReference } from "./source.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const options = { producerVersion: "0.9.0-test" };
const protocol = "phoenix-cad-index-v1";
const scannedAt = "2025-01-02T03:04:05.000Z";

// Independent metadata-only snapshots, not a copied inventory or assembly geometry.
function asset(id: number, name: string): Mutable<CadBomSourceAsset> {
  return { id, relativePath: `metadata/${name}.FCStd`, assetKind: "part", partNo: `META-${name}`, revision: "A", typeCode: "TEST", modelSeries: "", partName: "Independent metadata", label: "Independent label", fileStatus: "present", lastSeenAt: scannedAt,
    bomJson: { protocol, version: 1, size_bytes: 100, mtime_ms: 1, document_xml_objects: 1,
      source_sha256: `sha256:${"a".repeat(64)}`, document_role: "model", xlinks: [] },
  };
}
function reference(id: number, host: CadBomSourceAsset, target: CadBomSourceAsset, quantity = 1): Mutable<CadBomSourceReference> {
  return { id, scanId: 1, hostAssetId: host.id, hostRelativePath: host.relativePath, xlinkFile: `link-${id}.FCStd`, targetAssetId: target.id, targetRelativePath: target.relativePath, targetPartNo: target.partNo, targetRevision: target.revision, resolveStatus: "resolved", detailJson: { source: protocol, basic_bom: true, quantity } };
}
function fixture() {
  const assets = [asset(1, "Host"), asset(2, "Child"), asset(3, "Leaf")];
  return { schemaVersion: 13, scan: { id: 1, scanUuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", scannedAt, status: "done", phase: "ts-light-index", statsJson: { source: protocol, files: 3, parsed_files: 3, parse_failures: 0, references: 2, bom_lines: 3 } as unknown },
    assets, references: [reference(1, assets[0], assets[1], 2), reference(2, assets[1], assets[2], 3)], bomLineCount: 3,
  };
}
type Fixture = ReturnType<typeof fixture>;
function stats(value: Fixture): Record<string, unknown> { return value.scan.statsJson as Record<string, unknown>; }
function metadata(value: CadBomSourceAsset): Record<string, unknown> { return value.bomJson as Record<string, unknown>; }
function detail(value: CadBomSourceReference): Record<string, unknown> { return value.detailJson as Record<string, unknown>; }
function refreshStats(value: Fixture): void {
  const files = value.assets.filter(row => row.fileStatus === "present" && /\.fcstd$/iu.test(row.relativePath)).length;
  Object.assign(stats(value), { files, parsed_files: files, references: value.references.length, bom_lines: value.bomLineCount });
}
function drawingDependency(ref: Mutable<CadBomSourceReference>): void { ref.detailJson = { source: protocol, basic_bom: false, reference_role: "drawing_source" }; }
function retarget(ref: Mutable<CadBomSourceReference>, target: CadBomSourceAsset): void {
  Object.assign(ref, { targetAssetId: target.id, targetRelativePath: target.relativePath, targetPartNo: target.partNo, targetRevision: target.revision });
}

describe("CAD BOM pure completed source builder", () => {
  it("uses direct quantities 2 and 3, never recursive root-to-leaf quantity 6 or each-xref +1", () => {
    const input = fixture(); const result = buildCadBomTransferFromSource(input, options);
    const root = result.boms.find(value => value.partNo === "META-Host")!;
    const child = result.boms.find(value => value.partNo === "META-Child")!;
    expect(root.items).toEqual([{ partNo: "META-Child", revision: "A", qty: 2, attributes: {} }]);
    expect(child.items).toEqual([{ partNo: "META-Leaf", revision: "A", qty: 3, attributes: {} }]);
    expect(result.transferId).toBe(input.scan.scanUuid);
    expect(result.workspace.scanId).toBe(input.scan.scanUuid);
    expect(result.createdAt).toBe(scannedAt);
    expect(result.producer).toEqual({ id: "phoenix-desk-tools", version: options.producerVersion });
  });
  it("is deterministic under row order/id changes, retains inputs and produces frozen v1 output", () => {
    const input = fixture(); const before = JSON.stringify(input);
    const result = buildCadBomTransferFromSource(input, options);
    expect(JSON.stringify(input)).toBe(before);
    const reordered = fixture(); reordered.assets.reverse(); reordered.references.reverse();
    expect(canonicalCadBomTransferJson(buildCadBomTransferFromSource(reordered, options))).toBe(canonicalCadBomTransferJson(result));
    reordered.references[0].id = 10;
    expect(buildCadBomTransferFromSource(reordered, options).workspace.fingerprint).toBe(result.workspace.fingerprint);
    const otherVersion = buildCadBomTransferFromSource(input, { producerVersion: "next" });
    expect(otherVersion.payloadHash).toBe(result.payloadHash);
    expect(otherVersion.workspace.fingerprint).toBe(result.workspace.fingerprint);
    expect(Object.isFrozen(result.boms[0].items)).toBe(true);
  });
  it("binds the fingerprint to archive bytes while payload remains semantic metadata", () => {
    const input = fixture(); const first = buildCadBomTransferFromSource(input, options);
    metadata(input.assets[0]).source_sha256 = `sha256:${"b".repeat(64)}`;
    const second = buildCadBomTransferFromSource(input, options);
    expect(second.payloadHash).toBe(first.payloadHash);
    expect(second.workspace.fingerprint).not.toBe(first.workspace.fingerprint);
  });
  it("supports JSON text metadata and extra row/metadata/stat columns without changing the contract", () => {
    const input = fixture();
    Object.assign(stats(input), { extra_read_only_column: "ignored" });
    Object.assign(metadata(input.assets[0]), { additional_metadata: { retained: true } });
    input.scan.statsJson = JSON.stringify(input.scan.statsJson);
    input.assets[0].bomJson = JSON.stringify(input.assets[0].bomJson);
    input.references[0].detailJson = JSON.stringify(input.references[0].detailJson);
    expect(buildCadBomTransferFromSource(input, options).parts).toHaveLength(3);
  });
  it.each(["label-fallback", "part-number-fallback", "single-letter-name", "kind-fallback", "cad-type-fallback"])("retains old producer field semantics: %s", name => {
    const input = fixture(); const row = input.assets[0];
    if (name === "label-fallback") { row.partName = null; row.label = "Generic label"; }
    if (name === "part-number-fallback") { row.partName = null; row.label = null; }
    if (name === "single-letter-name") row.partName = "S";
    if (name === "kind-fallback") { row.typeCode = null; row.assetKind = "GenericKind"; }
    if (name === "cad-type-fallback") { row.typeCode = null; row.assetKind = null; }
    const result = buildCadBomTransferFromSource(input, options).parts.find(value => value.partNo === row.partNo)!;
    if (name === "label-fallback") expect(result.name).toBe("Generic label");
    if (name === "part-number-fallback") expect(result.name).toBe(row.partNo);
    if (name === "single-letter-name") expect(result.name).toBe("S");
    if (name === "kind-fallback") expect(result.type).toBe("GenericKind");
    if (name === "cad-type-fallback") expect(result.type).toBe("CAD");
  });
  it("does not create drawing parts/BOMs even when filename and assetKind resemble models", () => {
    const input = fixture(); const drawing = asset(4, "NotASuffixHint.ASSY"); drawing.assetKind = "part";
    drawing.partNo = null; drawing.revision = null; drawing.partName = null; drawing.label = null;
    metadata(drawing).document_role = "drawing"; input.assets.push(drawing);
    const dependency = reference(3, drawing, input.assets[0]); drawingDependency(dependency); input.references.push(dependency); refreshStats(input);
    const result = buildCadBomTransferFromSource(input, options);
    expect(result.parts).toHaveLength(3); expect(result.boms).toHaveLength(2);
  });
  it("does not classify a real model as drawing from its Drawing filename suffix", () => {
    const input = fixture(); input.assets[0].relativePath = "metadata/Host.Drawing.FCStd";
    input.references[0].hostRelativePath = input.assets[0].relativePath;
    expect(buildCadBomTransferFromSource(input, options).parts).toHaveLength(3);
  });
  it("allows resolved embedded drawing-source dependencies without adding physical quantities", () => {
    const input = fixture(); const dependency = reference(3, input.assets[0], input.assets[2]); drawingDependency(dependency); input.references.push(dependency); refreshStats(input);
    const result = buildCadBomTransferFromSource(input, options);
    expect(result.boms.find(value => value.partNo === "META-Host")!.items).toHaveLength(1);
  });
  it("does not mistake nonphysical dependency cycles for BOM cycles", () => {
    const input = fixture(); const drawing = asset(4, "Dependency"); metadata(drawing).document_role = "drawing"; input.assets.push(drawing);
    const forward = reference(3, drawing, input.assets[0]), reverse = reference(4, input.assets[0], drawing);
    drawingDependency(forward); drawingDependency(reverse); input.references.push(forward, reverse); refreshStats(input);
    expect(buildCadBomTransferFromSource(input, options).boms).toHaveLength(2);
  });
  it("ignores historical missing/ignored rows and non-FCStd assets, not current errors", () => {
    const input = fixture();
    for (const [id, state] of [[4, "missing"], [5, "ignored"]] as const) {
      const row = asset(id, `Old${id}`); row.fileStatus = state; row.bomJson = null; row.lastSeenAt = null; input.assets.push(row);
    }
    const step = asset(6, "OutOfScope"); step.relativePath = "metadata/OutOfScope.stp"; step.bomJson = null; input.assets.push(step); refreshStats(input);
    expect(buildCadBomTransferFromSource(input, options).parts).toHaveLength(3);
    input.assets[3].fileStatus = "error";
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow("错误状态");
  });
  it("uses shared default coverage and never promotes old present cache/hidden-directory rows", () => {
    const input = fixture();
    for (const [index, path] of [".git/Old.FCStd", "node_modules/Old.FCStd", "__pycache__/Old.FCStd", ".old/Old.FCStd"].entries()) {
      const row = asset(index + 4, "Old"); row.relativePath = path; row.lastSeenAt = null; row.bomJson = null; input.assets.push(row);
    }
    // Fullscan stats still describe only its three in-scope files.
    expect(buildCadBomTransferFromSource(input, options).parts).toHaveLength(3);
    const leaked = reference(3, input.assets[0], input.assets[3]); input.references.push(leaked);
    stats(input).references = input.references.length;
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow("资产 ID 与路径");
  });
  it("deduplicates identical PartKeys but rejects inconsistent field mappings", () => {
    const input = fixture(); const duplicate = { ...input.assets[0], id: 4, relativePath: "metadata/Equivalent.FCStd" }; input.assets.push(duplicate); refreshStats(input);
    expect(buildCadBomTransferFromSource(input, options).parts).toHaveLength(3);
    duplicate.partName = "Different metadata";
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow("PartKey");
  });
  it("adds explicit direct quantities across different links to the same PartKey", () => {
    const input = fixture(); input.references.push(reference(3, input.assets[0], input.assets[1], 4)); refreshStats(input);
    expect(buildCadBomTransferFromSource(input, options).boms.find(value => value.partNo === "META-Host")!.items[0].qty).toBe(6);
  });
  it("safely aggregates explicit quantities from different model paths with an identical PartKey", () => {
    const input = fixture(); const equivalent = { ...input.assets[1], id: 4, relativePath: "metadata/EquivalentChild.FCStd" };
    input.assets.push(equivalent); input.references.push(reference(3, input.assets[0], equivalent, 3)); refreshStats(input);
    const result = buildCadBomTransferFromSource(input, options);
    expect(result.parts).toHaveLength(3);
    expect(result.boms.find(value => value.partNo === "META-Host")!.items).toEqual([{ partNo: "META-Child", revision: "A", qty: 5, attributes: {} }]);
  });
  it("accepts safe legacy ./ and backslash path aliases without inventing absolute targets", () => {
    const input = fixture(); input.assets[0].relativePath = "./metadata/Host.FCStd";
    input.references[0].hostRelativePath = "metadata\\Host.FCStd";
    expect(buildCadBomTransferFromSource(input, options).parts).toHaveLength(3);
  });
  it.each([
    ["schema", (s: Fixture) => { s.schemaVersion = 12; }],
    ["scan-id", (s: Fixture) => { s.scan.id = 0; }],
    ["partial-status", (s: Fixture) => { s.scan.status = "partial"; }],
    ["partial-phase", (s: Fixture) => { s.scan.phase = "ts-light-index-partial"; }],
    ["xref-only-phase", (s: Fixture) => { s.scan.phase = "xref-refresh"; }],
    ["invalid-uuid", (s: Fixture) => { s.scan.scanUuid = "not-uuid"; }],
    ["uppercase-uuid", (s: Fixture) => { s.scan.scanUuid = s.scan.scanUuid.toUpperCase(); }],
    ["noncanonical-utc", (s: Fixture) => { s.scan.scannedAt = "2025-01-02T03:04:05Z"; }],
    ["wrong-protocol", (s: Fixture) => { stats(s).source = "legacy-index"; }],
    ["file-count", (s: Fixture) => { stats(s).files = 4; stats(s).parsed_files = 4; }],
    ["parsed-count", (s: Fixture) => { stats(s).parsed_files = 2; }],
    ["parse-failures", (s: Fixture) => { stats(s).parse_failures = 1; }],
    ["failed-count", (s: Fixture) => { stats(s).failed_count = 1; }],
    ["reference-count", (s: Fixture) => { stats(s).references = 1; }],
    ["bom-count", (s: Fixture) => { stats(s).bom_lines = 2; }],
    ["unsafe-count", (s: Fixture) => { s.bomLineCount = Number.MAX_SAFE_INTEGER + 1; }],
    ["negative-count", (s: Fixture) => { s.bomLineCount = -1; }],
    ["string-count", (s: Fixture) => { stats(s).references = "2"; }],
    ["complete-false", (s: Fixture) => { stats(s).complete = false; }],
    ["inventory-false", (s: Fixture) => { stats(s).inventory_complete = false; }],
    ["bom-incomplete", (s: Fixture) => { stats(s).bom_complete = false; }],
  ] as const)("rejects incomplete or invalid scan: %s", (_label, change) => {
    const input = fixture(); change(input);
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow(CadBomTransferValidationError);
  });
  it.each(["source", "files", "parsed_files", "parse_failures", "references", "bom_lines"])("requires full scan statistic %s", key => {
    const input = fixture(); delete stats(input)[key];
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow(CadBomTransferValidationError);
  });
  it.each([
    ["invalid-bom-json", (s: Fixture) => { s.assets[0].bomJson = "{"; }],
    ["empty-bom-json", (s: Fixture) => { s.assets[0].bomJson = null; }],
    ["wrong-protocol", (s: Fixture) => { metadata(s.assets[0]).protocol = "legacy"; }],
    ["wrong-version", (s: Fixture) => { metadata(s.assets[0]).version = 2; }],
    ["missing-hash", (s: Fixture) => { delete metadata(s.assets[0]).source_sha256; }],
    ["bare-hash", (s: Fixture) => { metadata(s.assets[0]).source_sha256 = "a".repeat(64); }],
    ["uppercase-hash", (s: Fixture) => { metadata(s.assets[0]).source_sha256 = `sha256:${"A".repeat(64)}`; }],
    ["missing-role", (s: Fixture) => { delete metadata(s.assets[0]).document_role; }],
    ["unknown-role", (s: Fixture) => { metadata(s.assets[0]).document_role = "unknown"; }],
    ["parse-error", (s: Fixture) => { metadata(s.assets[0]).parse_error = "Independent failure"; }],
    ["incomplete", (s: Fixture) => { metadata(s.assets[0]).complete = false; }],
    ["invalid-complete", (s: Fixture) => { metadata(s.assets[0]).complete = "true"; }],
    ["size-missing", (s: Fixture) => { delete metadata(s.assets[0]).size_bytes; }],
    ["zero-size", (s: Fixture) => { metadata(s.assets[0]).size_bytes = 0; }],
    ["fractional-mtime", (s: Fixture) => { metadata(s.assets[0]).mtime_ms = 1.5; }],
    ["negative-object-count", (s: Fixture) => { metadata(s.assets[0]).document_xml_objects = -1; }],
    ["stale-seen-at", (s: Fixture) => { s.assets[0].lastSeenAt = "2025-01-01T00:00:00.000Z"; }],
    ["empty-part-no", (s: Fixture) => { s.assets[0].partNo = null; }],
    ["empty-revision", (s: Fixture) => { s.assets[0].revision = " "; }],
    ["duplicate-asset-id", (s: Fixture) => { s.assets[1].id = 1; }],
    ["case-path-collision", (s: Fixture) => { s.assets[1].relativePath = s.assets[0].relativePath.toUpperCase(); }],
    ["dot-alias-collision", (s: Fixture) => { s.assets[1].relativePath = `./${s.assets[0].relativePath}`; }],
  ] as const)("rejects incomplete/ambiguous model snapshot: %s", (_label, change) => {
    const input = fixture(); change(input);
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow(CadBomTransferValidationError);
  });
  it.each(["../escape.FCStd", "/absolute.FCStd", "C:\\absolute.FCStd", "metadata//invalid.FCStd", "metadata/./invalid.FCStd"])("rejects unsafe asset path %s", path => {
    const input = fixture(); input.assets[0].relativePath = path;
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow("路径");
  });
  it.each([["unit-separator", "metadata/Bad\u001f.FCStd"], ["newline", "metadata/New\nLine.FCStd"], ["tab", "meta\tdata/Bad.FCStd"]])("rejects control character path: %s", (_label, path) => {
    const input = fixture(); input.assets[0].relativePath = path;
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow("安全相对路径");
  });
  it.each([
    ["wrong-scan", (s: Fixture) => { s.references[0].scanId = 2; }],
    ["missing", (s: Fixture) => { s.references[0].resolveStatus = "missing"; }],
    ["ambiguous", (s: Fixture) => { s.references[0].resolveStatus = "ambiguous"; }],
    ["candidate-only", (s: Fixture) => { s.references[0].resolveStatus = "basename"; }],
    ["null-target", (s: Fixture) => { s.references[0].targetAssetId = null; }],
    ["unknown-host-id", (s: Fixture) => { s.references[0].hostAssetId = 99; }],
    ["wrong-host-path", (s: Fixture) => { s.references[0].hostRelativePath = s.assets[1].relativePath; }],
    ["wrong-target-id", (s: Fixture) => { s.references[0].targetAssetId = 3; }],
    ["wrong-target-path", (s: Fixture) => { s.references[0].targetRelativePath = s.assets[2].relativePath; }],
    ["wrong-part-key", (s: Fixture) => { s.references[0].targetPartNo = "OTHER-METADATA"; }],
    ["wrong-revision", (s: Fixture) => { s.references[0].targetRevision = "B"; }],
    ["empty-link", (s: Fixture) => { s.references[0].xlinkFile = " "; }],
    ["duplicate-id", (s: Fixture) => { s.references[1].id = 1; }],
    ["duplicate-link", (s: Fixture) => { const duplicate = { ...s.references[0], id: 3 }; s.references.push(duplicate); refreshStats(s); }],
    ["partial-refresh", (s: Fixture) => { detail(s.references[0]).source = "phoenix-desk-tools-xref-partial-refresh"; }],
    ["incomplete-detail", (s: Fixture) => { detail(s.references[0]).complete = false; }],
    ["missing-basic-marker", (s: Fixture) => { delete detail(s.references[0]).basic_bom; }],
    ["mixed-role", (s: Fixture) => { detail(s.references[0]).reference_role = "drawing_source"; }],
    ["missing-qty", (s: Fixture) => { delete detail(s.references[0]).quantity; }],
  ] as const)("rejects unsafe or stale reference: %s", (_label, change) => {
    const input = fixture(); change(input);
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow(CadBomTransferValidationError);
  });
  it.each([["zero", 0], ["negative", -1], ["fractional", 1.5], ["not-finite", NaN], ["infinite", Infinity], ["string", "2"], ["int32-overflow", 2_147_483_648], ["unsafe-integer", Number.MAX_SAFE_INTEGER + 1]])("rejects invalid direct physical quantity: %s", (_label, quantity) => {
    const input = fixture(); detail(input.references[0]).quantity = quantity;
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow(/quantity|数量/u);
  });
  it("refuses summed direct quantity overflow rather than clipping or defaulting", () => {
    const input = fixture(); detail(input.references[0]).quantity = 2_147_483_647;
    input.references.push(reference(3, input.assets[0], input.assets[1], 1)); refreshStats(input);
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow("合并直接数量");
  });
  it("accepts the maximum direct INT32 quantity without applying recursive multiplication", () => {
    const input = fixture(); detail(input.references[0]).quantity = 2_147_483_647;
    const result = buildCadBomTransferFromSource(input, options);
    expect(result.boms.find(value => value.partNo === "META-Host")!.items[0].qty).toBe(2_147_483_647);
    expect(result.boms.find(value => value.partNo === "META-Child")!.items[0].qty).toBe(3);
  });
  it.each(["unresolved", "basic-true", "quantity-present", "missing-role"])("rejects invalid drawing dependency metadata: %s", name => {
    const input = fixture(); const drawing = asset(4, "Document"); metadata(drawing).document_role = "drawing"; input.assets.push(drawing);
    const ref = reference(3, drawing, input.assets[0]); drawingDependency(ref); input.references.push(ref); refreshStats(input);
    if (name === "unresolved") ref.resolveStatus = "missing";
    if (name === "basic-true") ref.detailJson = { source: protocol, basic_bom: true, quantity: 1 };
    if (name === "quantity-present") detail(ref).quantity = 1;
    if (name === "missing-role") delete detail(ref).reference_role;
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow(CadBomTransferValidationError);
  });
  it("rejects a drawing as a physical target and all self references", () => {
    const input = fixture(); metadata(input.assets[2]).document_role = "drawing";
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow("图纸不能");
    const self = fixture(); retarget(self.references[0], self.assets[0]);
    expect(() => buildCadBomTransferFromSource(self, options)).toThrow("自引用");
    drawingDependency(self.references[0]); expect(() => buildCadBomTransferFromSource(self, options)).toThrow("自引用");
  });
  it("rejects path cycles and identity cycles even when file-path graph is acyclic", () => {
    const paths = fixture(); retarget(paths.references[1], paths.assets[0]);
    expect(() => buildCadBomTransferFromSource(paths, options)).toThrow("路径引用");
    const keys = fixture(); const equivalent = { ...keys.assets[0], id: 4, relativePath: "metadata/Equivalent.FCStd" }; keys.assets.push(equivalent);
    retarget(keys.references[1], equivalent); refreshStats(keys);
    expect(() => buildCadBomTransferFromSource(keys, options)).toThrow("PartKey 引用");
  });
  it("rejects multiple model hosts mapping to one BOM even with identical part fields", () => {
    const input = fixture(); const host = { ...input.assets[0], id: 4, relativePath: "metadata/Equivalent.FCStd" }; input.assets.push(host);
    input.references.push(reference(3, host, input.assets[2])); refreshStats(input);
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow("多个模型宿主");
  });
  it("rejects long physical cycles with iterative graph checks rather than overflowing the stack", () => {
    const input = fixture(); input.assets = Array.from({ length: 5000 }, (_, index) => asset(index + 1, `Node${index}`));
    input.references = input.assets.map((host, index) => reference(index + 1, host, input.assets[(index + 1) % input.assets.length])); refreshStats(input);
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow("形成循环");
  });
  it("bounds individual JSON metadata text without increasing the 8 MiB payload boundary", () => {
    const input = fixture(); input.assets[0].bomJson = " ".repeat(8 * 1024 * 1024 + 1);
    expect(() => buildCadBomTransferFromSource(input, options)).toThrow("bom_json 超过 8 MiB");
  });
  it.each([["blank", " "], ["oversize", "v".repeat(33)]])("requires valid current producer version: %s", (_label, producerVersion) => {
    expect(() => buildCadBomTransferFromSource(fixture(), { producerVersion })).toThrow("producer.version");
  });
});

describe("streamed CAD BOM semantic fingerprint budget", () => {
  function volume(count: number, directoryCharacters: number) {
    const input = fixture(); const prefix = `metadata/${"p".repeat(directoryCharacters)}`;
    input.assets[0].relativePath = `${prefix}/Host.FCStd`; input.assets[1].relativePath = `${prefix}/Child.FCStd`;
    input.references = Array.from({ length: count }, (_, index) => reference(index + 1, input.assets[0], input.assets[1])); refreshStats(input);
    return input;
  }
  it("accepts semantic source summary beyond 8 MiB while aggregated v1 payload is small", () => {
    const input = volume(50_000, 120);
    const rawBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
    expect(rawBytes).toBeGreaterThan(8 * 1024 * 1024); expect(rawBytes).toBeLessThan(64 * 1024 * 1024);
    const result = buildCadBomTransferFromSource(input, options);
    expect(Buffer.byteLength(canonicalCadBomTransferJson(result), "utf8")).toBeLessThan(8 * 1024 * 1024);
    expect(result.boms).toHaveLength(1); expect(result.boms[0].items[0].qty).toBe(50_000);
  });
  it("refuses cumulative canonical semantic summary beyond 64 MiB", () => {
    expect(() => buildCadBomTransferFromSource(volume(100_000, 400), options)).toThrow("fingerprint 超过 64 MiB");
  });
});
