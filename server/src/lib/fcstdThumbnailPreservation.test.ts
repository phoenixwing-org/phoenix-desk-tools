import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { previewNames, writeNames } from "../features/cad-name-normalize/service.js";
import { applyBatchAttributes, previewBatchAttributes } from "./fcstdBatchAttributes.js";
import { writeFcstdEmbeddedBomFields } from "./fcstdDocumentXmlService.js";
import { analyzeFcstdProperties, applyFcstdPropertyRepairs } from "./fcstdPropertyRepairService.js";
import { patchFcstdReferenceLabels, patchFcstdXlinkAttributes } from "./fcstdReferenceLabelService.js";
import { extractFcstdThumbnail } from "./fcstdThumbnail.js";

// Independently constructed metadata and opaque bytes, not a copied CAD model.
// These I/O tests do not start FreeCAD or read any application preferences.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6mcAAAAASUVORK5CYII=", "base64");
const REL = "100001.001-H-SYNTH-Originalpart.FCStd";
const roots: string[] = [];
const encode = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function fixture(options: { fields?: Record<string, string>; count?: number } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-thumbnail-preservation-"));
  roots.push(root);
  const fields = { PartNumber: "100001", PartVersion: "001", TypeCode: "H", ModelSeries: "SYNTH", PartName: "Originalpart", Label: "Original node", ...options.fields };
  const properties = Object.entries(fields).map(([name, value]) =>
    `<Property name="${name}" type="App::PropertyString"><String value="${encode(value)}"/></Property>`).join("");
  const xml = `<Document><Objects Count="2"><Object name="Body" type="PartDesign::Body"/><Object name="Link" type="App::Link"/></Objects><ObjectData Count="2"><Object name="Body"><Properties Count="${options.count ?? Object.keys(fields).length}">${properties}</Properties></Object><Object name="Link"><Properties Count="2"><Property name="Label" type="App::PropertyString"><String value="Original link label"/></Property><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="old.FCStd" name="ExternalPart"/></Property></Properties></Object></ObjectData></Document>`;
  const entries: Record<string, Uint8Array> = {
    "Document.xml": strToU8(xml),
    "GuiDocument.xml": strToU8('<GuiDocument><Synthetic view="unchanged"/></GuiDocument>'),
    "GuiDocument.bin": new Uint8Array([0, 255, 17, 0, 128, 42]),
    "Shape.brp": new Uint8Array([83, 89, 78, 84, 72, 0, 255, 1]),
    "thumbnails/Thumbnail.png": PNG,
    "extension/opaque.payload": new Uint8Array([255, 0, 3, 127, 128, 0, 254]),
  };
  const bytes = zipSync(entries, { level: 6 });
  const filename = path.join(root, REL);
  fs.writeFileSync(filename, bytes);
  return { root, rel: REL, filename, bytes, entries };
}

type Fixture = ReturnType<typeof fixture>;

function expectOnlyDocumentXmlChanged(file: Fixture) {
  const bytes = fs.readFileSync(file.filename);
  const after = unzipSync(bytes);
  expect(Object.keys(after).sort()).toEqual(Object.keys(file.entries).sort());
  expect(after["Document.xml"]).not.toEqual(file.entries["Document.xml"]);
  for (const [name, original] of Object.entries(file.entries)) {
    if (name !== "Document.xml") expect(Buffer.from(after[name]), `ZIP entry ${name} must retain its decoded bytes`).toEqual(Buffer.from(original));
  }
  expect(extractFcstdThumbnail(bytes)?.bytes).toEqual(PNG);
  return strFromU8(after["Document.xml"]);
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("embedded FCStd thumbnails survive existing XML-only ZIP writes", () => {
  it("preserves the PNG and every unrelated entry during a single-file BOM write", () => {
    const file = fixture();
    expect(writeFcstdEmbeddedBomFields(file.filename, { PartName: "Updated root name" }))
      .toEqual({ changed: true, objectName: "Body" });
    expect(expectOnlyDocumentXmlChanged(file)).toContain('value="Updated root name"');
  });

  it("preserves the PNG and every unrelated entry during an explicitly selected batch attribute write", async () => {
    const file = fixture({ fields: { PartNumber: "" } });
    const plan = await previewBatchAttributes(file.root);
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].changes.find(change => change.field === "PartNumber"))
      .toMatchObject({ proposed: "100001", eligible: true });
    expect(fs.readFileSync(file.filename)).toEqual(Buffer.from(file.bytes));
    const result = applyBatchAttributes(file.root, {
      plan_id: plan.plan_id, selections: [{ rel: file.rel, fields: ["PartNumber"] }],
    });
    expect(result.results[0]).toMatchObject({ rel: file.rel, status: "written" });
    expect(expectOnlyDocumentXmlChanged(file)).toContain('value="100001"');
  });

  it("preserves the PNG and every unrelated entry while writing reviewed name-normalization attributes", async () => {
    const file = fixture({ fields: { PartName: "Renamedpart" } });
    const plan = await previewNames(file.root, { batch_dir: "." });
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(1);
    // A pending rename keeps this test in the write-attributes step; it does
    // not start an index scan, rename the file or require a workspace database.
    expect(plan.rows[0]).toMatchObject({ eligible: true, attributes_changed: true, rename_changed: true });
    expect(fs.readFileSync(file.filename)).toEqual(Buffer.from(file.bytes));
    const result = writeNames(file.root, { plan_id: plan.plan_id, rels: [file.rel], confirmed: true });
    expect(result.results[0]).toMatchObject({ rel: file.rel, status: "written" });
    expect(result.index_update).toBeUndefined();
    expect(expectOnlyDocumentXmlChanged(file)).toContain('value="100001.001-Renamedpart"');
    expect(fs.existsSync(path.join(file.root, plan.rows[0].target_rel))).toBe(false);
  });

  it("preserves the PNG and every unrelated entry during a reference-instance Label write", () => {
    const file = fixture();
    expect(patchFcstdReferenceLabels(file.filename, { "old.FCStd": "Updated link label" }))
      .toMatchObject({ count: 1, engine: "typescript" });
    expect(expectOnlyDocumentXmlChanged(file)).toContain('value="Updated link label"');
  });

  it("preserves the PNG and every unrelated entry during an XLink path write", () => {
    const file = fixture();
    expect(patchFcstdXlinkAttributes(file.filename, { "old.FCStd": "new.FCStd" }))
      .toEqual({ count: 1, engine: "typescript" });
    expect(expectOnlyDocumentXmlChanged(file)).toContain('<XLink file="new.FCStd" name="ExternalPart"/>');
  });

  it("preserves the PNG and every unrelated entry during a reviewed Properties Count repair", async () => {
    const file = fixture({ count: 99 });
    const plan = await analyzeFcstdProperties(file.root);
    expect(plan.errors).toEqual([]);
    expect(plan.files).toHaveLength(1);
    expect(fs.readFileSync(file.filename)).toEqual(Buffer.from(file.bytes));
    const result = applyFcstdPropertyRepairs(file.root, { plan_id: plan.plan_id, files: [file.rel] });
    expect(result.results[0]).toMatchObject({ rel: file.rel, status: "fixed" });
    expect(expectOnlyDocumentXmlChanged(file)).toContain('<Properties Count="6">');
  });
});
