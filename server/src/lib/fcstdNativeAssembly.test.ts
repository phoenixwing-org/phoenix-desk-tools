import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractFcstdEmbeddedBomSnapshot,
  inspectFcstdBatchTarget,
  patchFcstdEmbeddedBomDocumentXml,
  readFcstdEmbeddedBomFields,
  readFcstdEmbeddedBomFieldsAsync,
  writeFcstdEmbeddedBomFields,
} from "./fcstdDocumentXmlService.js";
import { analyzeCadIndexDocumentXmlWithInstances } from "./cadIndexLinkInstances.js";

// Independently constructed metadata-only conditions. No project inventory,
// geometry, screenshot identifiers or real machine/user configuration is copied.
const ASSEMBLY_FIELDS = {
  PartNumber: "ASSEMBLY-META", PartVersion: "V1", TypeCode: "H", ModelSeries: "SYNTHETIC",
  PartName: "Synthetic assembly", label: "Synthetic assembly root",
};
const BODY_FIELDS = {
  PartNumber: "BODY-SOURCE", PartVersion: "V0", TypeCode: "S", ModelSeries: "",
  PartName: "Synthetic source body", label: "Synthetic source definition",
};
const roots: string[] = [];
const encode = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
type SerializedObject = { name: string; type: string; declaration: string; data: string };
function object(name: string, type: string, fields: Record<string, string> = {}, children?: string[], extra = ""): SerializedObject {
  const values = Object.entries(fields).map(([key, value]) => `<Property name="${key === "label" ? "Label" : key}" type="App::PropertyString"><String value="${encode(value)}"/></Property>`);
  const group = children === undefined ? "" : `<Property name="Group" type="App::PropertyLinkList"><LinkList count="${children.length}">${children.map(child => `<Link value="${child}"/>`).join("")}</LinkList></Property>`;
  return { name, type, declaration: `<Object name="${name}" type="${type}"/>`,
    data: `<Object name="${name}"><Properties Count="${values.length + (group ? 1 : 0) + (extra ? 1 : 0)}">${values.join("")}${group}${extra}</Properties></Object>` };
}
function document(objects: SerializedObject[], inlineTypes = false) {
  const declarations = inlineTypes ? "" : `<Objects Count="${objects.length}">${objects.map(item => item.declaration).join("")}</Objects>`;
  const data = objects.map(item => inlineTypes ? item.data.replace(`<Object name="${item.name}">`, `<Object name="${item.name}" type="${item.type}">`) : item.data).join("");
  return `<Document>${declarations}<ObjectData Count="${objects.length}">${data}</ObjectData></Document>`;
}
function scene(children = ["Origin", "Joints"]) {
  const body = object("SourceBody", "PartDesign::Body", BODY_FIELDS, [], '<Property name="SourceMarker" type="App::PropertyString" group="Synthetic"><String value="leave body unchanged"/></Property>');
  const assembly = object("AssemblyRoot", "Assembly::AssemblyObject", ASSEMBLY_FIELDS, children, '<Property name="AssemblyMarker" type="App::PropertyString" group="Synthetic"><String value="keep assembly metadata"/></Property>');
  const origin = object("Origin", "App::Origin", { label: "Synthetic origin" });
  const joints = object("Joints", "Assembly::JointGroup", { label: "Synthetic joints" }, []);
  return { body, assembly, origin, joints, objects: [body, assembly, origin, joints] };
}
function dataBlock(xml: string, name: string) {
  const data = /<ObjectData\b[^>]*>([\s\S]*?)<\/ObjectData>/.exec(xml)?.[1] || "";
  const found = [...data.matchAll(/<Object\b([^>]*)>[\s\S]*?<\/Object>/g)].filter(match => new RegExp(`\\bname="${name}"`).test(match[1]));
  expect(found, "The test document must contain exactly one target ObjectData block").toHaveLength(1);
  return found[0][0];
}
function assertOnlyTargetChanged(before: string, after: string, target = "AssemblyRoot") {
  expect(after.replace(dataBlock(after, target), "<TARGET/>"))
    .toBe(before.replace(dataBlock(before, target), "<TARGET/>"));
  const declarations = (xml: string) => /<Objects\b[^>]*>([\s\S]*?)<\/Objects>/.exec(xml)?.[0] || "";
  expect(declarations(after)).toBe(declarations(before));
}
function archive(xml: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-native-assembly-")); roots.push(root);
  const filename = path.join(root, "Synthetic.FCStd");
  const entries = { "Document.xml": strToU8(xml), "GuiDocument.xml": strToU8("<GuiDocument><Synthetic/></GuiDocument>"),
    "opaque.payload": new Uint8Array([0, 1, 2, 255, 0, 17]) };
  const bytes = zipSync(entries);
  fs.writeFileSync(filename, bytes);
  return { filename, entries, bytes };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("existing native Assembly is the shared read/write BOM target", () => {
  it.each([false, true])("reads Assembly metadata rather than the already-attributed Body in both type schemas [case %#]", async inlineTypes => {
    const xml = document(scene().objects, inlineTypes), file = archive(xml);
    expect(readFcstdEmbeddedBomFields(file.filename)).toEqual(ASSEMBLY_FIELDS);
    expect(await readFcstdEmbeddedBomFieldsAsync(file.filename)).toEqual(ASSEMBLY_FIELDS);
    const snapshot = extractFcstdEmbeddedBomSnapshot(xml);
    expect(snapshot.fields).toEqual(ASSEMBLY_FIELDS);
    expect(snapshot.present).toEqual(new Set(Object.keys(ASSEMBLY_FIELDS)));
    expect(analyzeCadIndexDocumentXmlWithInstances(xml).embeddedFields).toEqual(ASSEMBLY_FIELDS);
    expect(fs.readFileSync(file.filename)).toEqual(Buffer.from(file.bytes));
  });

  it.each([false, true])("chooses the same existing Assembly independently of Body/declaration order [case %#]", reverse => {
    const objects = scene().objects;
    const xml = document(reverse ? objects.reverse() : objects);
    expect(inspectFcstdBatchTarget(xml)).toMatchObject({ objectName: "AssemblyRoot", current: ASSEMBLY_FIELDS });
    const patched = patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "Updated & safe" });
    expect(patched).toMatchObject({ objectName: "AssemblyRoot", changed: true });
    expect(extractFcstdEmbeddedBomSnapshot(patched.xml).fields).toEqual({ ...ASSEMBLY_FIELDS, PartName: "Updated & safe" });
    assertOnlyTargetChanged(xml, patched.xml);
  });

  it("patches only the original Assembly block and preserves Body, Origin, Joints and non-Document ZIP payloads", () => {
    const source = scene(), xml = document(source.objects), file = archive(xml);
    const result = writeFcstdEmbeddedBomFields(file.filename, { PartNumber: "UPDATED-META", PartName: "Updated assembly", label: "Updated root label" });
    expect(result).toEqual({ changed: true, objectName: "AssemblyRoot" });
    const entries = unzipSync(fs.readFileSync(file.filename));
    expect(Object.keys(entries).sort()).toEqual(Object.keys(file.entries).sort());
    expect(entries["GuiDocument.xml"]).toEqual(file.entries["GuiDocument.xml"]);
    expect(entries["opaque.payload"]).toEqual(file.entries["opaque.payload"]);
    const next = strFromU8(entries["Document.xml"]);
    assertOnlyTargetChanged(xml, next);
    for (const untouched of [source.body, source.origin, source.joints]) expect(next).toContain(untouched.data);
    expect(next).toContain('<Objects Count="4">');
    expect(dataBlock(next, "AssemblyRoot")).toContain('value="keep assembly metadata"');
    expect(readFcstdEmbeddedBomFields(file.filename)).toEqual({ ...ASSEMBLY_FIELDS,
      PartNumber: "UPDATED-META", PartName: "Updated assembly", label: "Updated root label" });
    expect(analyzeCadIndexDocumentXmlWithInstances(next).embeddedFields).toEqual(readFcstdEmbeddedBomFields(file.filename));
  });

  it("allows batch selection of a unique native Assembly while preserving an independent Body's existing BOM", () => {
    const source = scene(), xml = document(source.objects);
    expect(inspectFcstdBatchTarget(xml)).toMatchObject({ objectName: "AssemblyRoot", current: ASSEMBLY_FIELDS });
    const patched = patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "Batch proposal" });
    expect(patched.xml).toContain(source.body.data);
    expect(inspectFcstdBatchTarget(patched.xml).current.PartName).toBe("Batch proposal");
  });

  it("writes only a parent native Assembly when another native Assembly is nested in its Group", () => {
    const source = scene(["Origin", "Joints", "NestedAssembly"]);
    const child = object("NestedAssembly", "Assembly::AssemblyObject", { ...ASSEMBLY_FIELDS, PartNumber: "NESTED-META", PartName: "Nested metadata" }, []);
    const xml = document([...source.objects, child]);
    expect(inspectFcstdBatchTarget(xml)).toMatchObject({ objectName: "AssemblyRoot", current: ASSEMBLY_FIELDS });
    const patched = patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "Parent only" });
    expect(patched.objectName).toBe("AssemblyRoot");
    expect(patched.xml).toContain(child.data); assertOnlyTargetChanged(xml, patched.xml);
  });

  it("writes an existing native Assembly whose Group and BOM fields are empty without falling back to Body", () => {
    const source = scene(), empty = object("AssemblyRoot", "Assembly::AssemblyObject", {}, []);
    const xml = document([source.body, empty]);
    expect(extractFcstdEmbeddedBomSnapshot(xml).fields).toMatchObject({ PartNumber: "", PartName: "", label: "" });
    expect(inspectFcstdBatchTarget(xml).objectName).toBe("AssemblyRoot");
    const patched = patchFcstdEmbeddedBomDocumentXml(xml, ASSEMBLY_FIELDS);
    expect(patched.objectName).toBe("AssemblyRoot");
    expect(extractFcstdEmbeddedBomSnapshot(patched.xml).fields).toEqual(ASSEMBLY_FIELDS);
    assertOnlyTargetChanged(xml, patched.xml);
  });

  it("keeps legacy Body-first behavior when another Body is only named and labelled Assembly", () => {
    const source = scene().body;
    const namedOnly = object("Assembly", "PartDesign::Body", { ...ASSEMBLY_FIELDS, label: "Assembly" }, []);
    const xml = document([source, namedOnly]);
    expect(extractFcstdEmbeddedBomSnapshot(xml).fields).toEqual(BODY_FIELDS);
    const patched = patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "First body only" });
    expect(patched.objectName).toBe("SourceBody"); expect(patched.xml).toContain(namedOnly.data);
    assertOnlyTargetChanged(xml, patched.xml, "SourceBody");
  });

  it("does not promote a commented-out Assembly or let its fake Group hide the real Body", () => {
    const source = scene().body, phantom = object("PhantomAssembly", "Assembly::AssemblyObject", ASSEMBLY_FIELDS, [source.name]);
    const xml = document([source]).replace("</Objects>", `<!--${phantom.declaration}--></Objects>`)
      .replace("</ObjectData>", `<!--${phantom.data}--></ObjectData>`);
    expect(extractFcstdEmbeddedBomSnapshot(xml).fields).toEqual(BODY_FIELDS);
    const patched = patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "Real body only" });
    expect(patched.objectName).toBe("SourceBody");
    expect(patched.xml).toContain(`<!--${phantom.declaration}-->`);
    expect(patched.xml).toContain(`<!--${phantom.data}-->`);
    assertOnlyTargetChanged(xml, patched.xml, "SourceBody");
  });

  it("ignores fake target properties inside comments and CDATA and preserves both opaque fragments when writing", async () => {
    const source = scene();
    const comment = '<!--opaque before: <Property name="PartName" type="App::PropertyString"><String value="fake comment name"/></Property><Property name="Label" type="App::PropertyString"><String value="fake comment label"/></Property>-->';
    const cdata = '<![CDATA[opaque after: <Property name="PartName" type="App::PropertyString"><String value="fake CDATA name"/></Property><Property name="Label" type="App::PropertyString"><String value="fake CDATA label"/></Property>]]>';
    const assembly = { ...source.assembly, data: source.assembly.data
      .replace(/(<Properties\b[^>]*>)/, `$1${comment}`)
      .replace("</Properties>", `${cdata}</Properties>`) };
    const xml = document([source.body, assembly, source.origin, source.joints]), file = archive(xml);
    expect(extractFcstdEmbeddedBomSnapshot(xml).fields).toEqual(ASSEMBLY_FIELDS);
    expect(readFcstdEmbeddedBomFields(file.filename)).toEqual(ASSEMBLY_FIELDS);
    expect(await readFcstdEmbeddedBomFieldsAsync(file.filename)).toEqual(ASSEMBLY_FIELDS);
    expect(inspectFcstdBatchTarget(xml).current).toEqual(ASSEMBLY_FIELDS);
    expect(analyzeCadIndexDocumentXmlWithInstances(xml).embeddedFields).toEqual(ASSEMBLY_FIELDS);

    const proposal = { PartName: "Real & updated name", label: "Real updated label" };
    const patched = patchFcstdEmbeddedBomDocumentXml(xml, proposal);
    expect(patched).toMatchObject({ changed: true, objectName: "AssemblyRoot" });
    expect(writeFcstdEmbeddedBomFields(file.filename, proposal)).toEqual({ changed: true, objectName: "AssemblyRoot" });
    const written = strFromU8(unzipSync(fs.readFileSync(file.filename))["Document.xml"]);
    for (const next of [patched.xml, written]) {
      expect(next).toContain(comment); expect(next).toContain(cdata);
      const actualProperties = dataBlock(next, "AssemblyRoot").replace(comment, "").replace(cdata, "");
      expect(actualProperties.match(/name="PartName"/g)).toHaveLength(1);
      expect(actualProperties.match(/name="Label"/g)).toHaveLength(1);
      expect(actualProperties).toContain('<String value="Real &amp; updated name"/>');
      expect(actualProperties).toContain('<String value="Real updated label"/>');
      expect(extractFcstdEmbeddedBomSnapshot(next).fields).toEqual({ ...ASSEMBLY_FIELDS, ...proposal });
      expect(analyzeCadIndexDocumentXmlWithInstances(next).embeddedFields).toEqual({ ...ASSEMBLY_FIELDS, ...proposal });
      assertOnlyTargetChanged(xml, next);
    }
  });
});

describe("native Assembly ambiguity and malformed identity fail closed", () => {
  it.each(['<!--keep field annotation-->', '<![CDATA[keep opaque field data]]>'])("refuses a whole-field rewrite which would discard inner opaque content [case %#]", opaque => {
    const source = scene();
    const assembly = { ...source.assembly, data: source.assembly.data.replace('<String value="Synthetic assembly"/>', `${opaque}<String value="Synthetic assembly"/>`) };
    const xml = document([source.body, assembly, source.origin, source.joints]), file = archive(xml);
    const before = fs.readFileSync(file.filename);
    expect(() => patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "New name" })).toThrow(/注释或 CDATA/);
    expect(() => writeFcstdEmbeddedBomFields(file.filename, { PartName: "New name" })).toThrow(/注释或 CDATA/);
    expect(fs.readFileSync(file.filename)).toEqual(before);
    // Editing a different field preserves the opaque property without blocking.
    const patched = patchFcstdEmbeddedBomDocumentXml(xml, { label: "New label" });
    expect(patched.xml).toContain(opaque); assertOnlyTargetChanged(xml, patched.xml);
  });
  it("rejects two independent native Assembly roots for batch, read and single write without changing the archive", async () => {
    const second = object("OtherAssembly", "Assembly::AssemblyObject", { ...ASSEMBLY_FIELDS, PartNumber: "SECOND-META" }, []);
    const xml = document([...scene().objects, second]), file = archive(xml), before = fs.readFileSync(file.filename);
    expect(() => inspectFcstdBatchTarget(xml)).toThrow();
    expect(() => extractFcstdEmbeddedBomSnapshot(xml)).toThrow();
    expect(() => readFcstdEmbeddedBomFields(file.filename)).toThrow();
    await expect(readFcstdEmbeddedBomFieldsAsync(file.filename)).rejects.toThrow();
    expect(() => patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "Must not select first" })).toThrow();
    expect(() => writeFcstdEmbeddedBomFields(file.filename, { PartName: "Must not write" })).toThrow();
    expect(() => analyzeCadIndexDocumentXmlWithInstances(xml)).toThrow();
    expect(fs.readFileSync(file.filename)).toEqual(before);
  });

  it("retains the batch safety refusal for an independent App::Part next to a unique native Assembly", () => {
    const part = object("IndependentPart", "App::Part", { PartNumber: "INDEPENDENT-META", PartName: "Independent part" }, []);
    const xml = document([...scene().objects, part]);
    expect(() => inspectFcstdBatchTarget(xml)).toThrow();
    // Single-file target policy may select the explicit unique Assembly, but may
    // never mutate the separate App::Part as a side effect.
    const patched = patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "Assembly only" });
    expect(patched.objectName).toBe("AssemblyRoot"); expect(patched.xml).toContain(part.data);
    assertOnlyTargetChanged(xml, patched.xml);
  });

  const invalidDocuments: Array<[string, () => string]> = [
    ["native declaration without ObjectData", () => { const source = scene(); return document(source.objects).replace(source.assembly.data, ""); }],
    ["duplicate native declaration", () => { const source = scene(); return document(source.objects).replace("</Objects>", `${source.assembly.declaration}</Objects>`).replace('<Objects Count="4">', '<Objects Count="5">'); }],
    ["conflicting declaration types", () => { const source = scene(); return document(source.objects).replace("</Objects>", '<Object name="AssemblyRoot" type="App::Part"/></Objects>').replace('<Objects Count="4">', '<Objects Count="5">'); }],
    ["duplicate native ObjectData", () => { const source = scene(); return document(source.objects).replace("</ObjectData>", `${source.assembly.data}</ObjectData>`).replace('<ObjectData Count="4">', '<ObjectData Count="5">'); }],
    ["self Group cycle", () => document(scene(["Origin", "Joints", "AssemblyRoot"]).objects)],
    ["two-native Group cycle", () => {
      const source = scene(["Origin", "Joints", "NestedAssembly"]);
      return document([...source.objects, object("NestedAssembly", "Assembly::AssemblyObject", ASSEMBLY_FIELDS, ["AssemblyRoot"])]);
    }],
    ["native and Body Group cycle", () => {
      const source = scene(["SourceBody"]);
      return document([object("SourceBody", "PartDesign::Body", BODY_FIELDS, ["AssemblyRoot"]), source.assembly, source.origin, source.joints]);
    }],
  ];
  it.each(invalidDocuments)("rejects %s instead of reading or writing fallback Body [case %#]", async (_reason, createXml) => {
    const xml = createXml(), file = archive(xml), before = fs.readFileSync(file.filename);
    expect(() => extractFcstdEmbeddedBomSnapshot(xml)).toThrow();
    expect(() => inspectFcstdBatchTarget(xml)).toThrow();
    expect(() => patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "Must remain unchanged" })).toThrow();
    expect(() => readFcstdEmbeddedBomFields(file.filename)).toThrow();
    await expect(readFcstdEmbeddedBomFieldsAsync(file.filename)).rejects.toThrow();
    expect(() => writeFcstdEmbeddedBomFields(file.filename, { PartName: "Must remain unchanged" })).toThrow();
    expect(() => analyzeCadIndexDocumentXmlWithInstances(xml)).toThrow();
    expect(fs.readFileSync(file.filename)).toEqual(before);
  });
});
