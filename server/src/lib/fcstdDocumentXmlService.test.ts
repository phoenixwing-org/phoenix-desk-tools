import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractDocumentXmlFromFcstdBytes,
  inspectFcstdBatchTarget,
  FcstdBatchTargetAmbiguityError,
  patchFcstdEmbeddedBomDocumentXml,
  readFcstdEmbeddedBomFields,
  readFcstdEmbeddedBomFieldsAsync,
  writeFcstdEmbeddedBomFields,
} from "./fcstdDocumentXmlService.js";

const DOCUMENT_XML = `<Document>
  <Objects><Object type="PartDesign::Body" name="Body"/></Objects>
  <ObjectData><Object name="Body"><Properties>
    <Property name="Label" type="App::PropertyString"><String value="测试零件"/></Property>
    <Property name="PartNumber" type="App::PropertyString"><String value="800001"/></Property>
    <Property name="PartVersion" type="App::PropertyString"><String value="001"/></Property>
    <Property name="TypeCode" type="App::PropertyString"><String value="h"/></Property>
    <Property name="ModelSeries" type="App::PropertyString"><String value="px"/></Property>
    <Property name="PartName" type="App::PropertyString"><String value="滑轨"/></Property>
  </Properties></Object></ObjectData>
</Document>`;

const tempRoots: string[] = [];
function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}
afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("batch root selection for imported STEP BaseFeature geometry", () => {
  const label = (value: string) => `<Property name="Label" type="App::PropertyString"><String value="${value}"/></Property>`;
  const base = '<Property name="BaseFeature" type="App::PropertyLink"><Link value="Imported"/></Property>';
  const group = (name: string) => `<Property name="Group" type="App::PropertyLinkList"><LinkList count="1"><Link value="${name}"/></LinkList></Property>`;
  const source = `<Object name="Imported"><Properties>${label("STEP source")}</Properties></Object>`;
  function fixture(bodyProperties = base, featureProperties = base, sourceData = source, outer = false) {
    return `<Document><Objects><Object name="Imported" type="Part::Feature"/><Object name="Body" type="PartDesign::Body"/><Object name="BaseFeature" type="PartDesign::FeatureBase"/>${outer ? '<Object name="Part" type="App::Part"/>' : ''}</Objects><ObjectData>${sourceData}<Object name="Body"><Properties>${label("710303.004-测试基板")}${group("BaseFeature")}${bodyProperties}</Properties></Object><Object name="BaseFeature"><Properties>${featureProperties}</Properties></Object>${outer ? `<Object name="Part"><Properties>${label("710303.004-测试基板")}${group("Body")}</Properties></Object>` : ''}</ObjectData></Document>`;
  }
  it.each([[base, ""], ["", base], [base, base]])("accepts proven Body / owned FeatureBase sources and leaves imported geometry untouched [case %#]", (body, feature) => {
    const xml = fixture(body, feature);
    expect(inspectFcstdBatchTarget(xml)).toMatchObject({ objectName: "Body", current: { label: "710303.004-测试基板" } });
    const patched = patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "测试基板" });
    expect(patched.objectName).toBe("Body"); expect(patched.xml).toContain(source);
  });
  it("follows owned Body inside an App::Part", () => {
    expect(() => inspectFcstdBatchTarget(fixture(base, base, source, true))).not.toThrow();
  });
  it("accepts an owned FeatureBase consuming a Python-generated shape, without touching that source", () => {
    const xml = fixture("", base).replace('type="Part::Feature"', 'type="Part::FeaturePython"');
    expect(inspectFcstdBatchTarget(xml).objectName).toBe("Body");
    expect(patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "测试零件" }).xml).toContain(source);
    expect(() => inspectFcstdBatchTarget(fixture("", "").replace('type="Part::Feature"', 'type="Part::FeaturePython"'))).toThrow(FcstdBatchTargetAmbiguityError);
    const independent = source.replace('</Properties>', '<Property name="PartName" type="App::PropertyString"><String value="独立零件"/></Property></Properties>');
    expect(() => inspectFcstdBatchTarget(fixture("", base, independent).replace('type="Part::Feature"', 'type="Part::FeaturePython"'))).toThrow(FcstdBatchTargetAmbiguityError);
  });
  it.each([
    ["", ""],
    [base.replace('name="BaseFeature"', 'name="Tip"'), ""],
    [base.replace('App::PropertyLink', 'App::PropertyXLink'), ""],
    [`<!--${base}-->`, ""],
    [`<![CDATA[${base}]]>`, ""],
  ])("does not exempt an unrelated source based on visibility, names, comments or other links [case %#]", (body, feature) => {
    expect(() => inspectFcstdBatchTarget(fixture(body, feature))).toThrow(FcstdBatchTargetAmbiguityError);
  });
  it("keeps explicitly annotated source parts blocked and identifies both candidates", () => {
    const annotated = source.replace('</Properties>', '<Property name="PartName" type="App::PropertyString"><String value="Independent"/></Property></Properties>');
    try { inspectFcstdBatchTarget(fixture(base, base, annotated)); throw new Error("expected ambiguity"); }
    catch (error) {
      expect(error).toBeInstanceOf(FcstdBatchTargetAmbiguityError);
      expect(error).toMatchObject({ objectName: "Body", current: { label: "710303.004-测试基板" } });
      expect((error as Error).message).toContain("另有 Imported");
    }
  });
  it("still blocks an additional independent Body", () => {
    const xml = fixture().replace('</Objects>', '<Object name="OtherBody" type="PartDesign::Body"/></Objects>').replace('</ObjectData>', `<Object name="OtherBody"><Properties>${label("Other")}</Properties></Object></ObjectData>`);
    expect(() => inspectFcstdBatchTarget(xml)).toThrow(/多个独立/);
  });
  function wrappedImport(containerProperties = "", siblingType = "Part::Feature", sourceLink = base) {
    const wrapper = `<Object name="ImportPart"><Properties>${label("STEP import")}${containerProperties}<Property name="Group" type="App::PropertyLinkList"><LinkList count="2"><Link value="Imported"/><Link value="Sibling"/></LinkList></Property></Properties></Object>`;
    return { wrapper, xml: fixture(sourceLink, sourceLink)
      .replace('</Objects>', `<Object name="ImportPart" type="App::Part"/><Object name="Sibling" type="${siblingType}"/></Objects>`)
      .replace('</ObjectData>', `${wrapper}<Object name="Sibling"><Properties>${label("other imported solid")}</Properties></Object></ObjectData>`) };
  }
  it("accepts a STEP App::Part wrapper and its raw-shape siblings without changing their data", () => {
    const { xml, wrapper } = wrappedImport();
    expect(inspectFcstdBatchTarget(xml).objectName).toBe("Body");
    const patched = patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "测试基板" });
    expect(patched.objectName).toBe("Body"); expect(patched.xml).toContain(wrapper); expect(patched.xml).toContain(source);
  });
  it("still blocks an unrelated, independently annotated or mixed-body container", () => {
    for (const xml of [wrappedImport("", "Part::Feature", "").xml,
      wrappedImport('<Property name="PartName" type="App::PropertyString"><String value="separate part"/></Property>').xml,
      wrappedImport("", "PartDesign::Body").xml]) {
      expect(() => inspectFcstdBatchTarget(xml)).toThrow(/多个独立/);
    }
  });
});

const BOM_FIELDS = {
  PartNumber: "900001", PartVersion: "002", TypeCode: "H", ModelSeries: "PX", PartName: "新增零件",
};

describe("assembly infrastructure is not an independent BOM object", () => {
  const extra = (type: string, name = "ConstraintFolder") => DOCUMENT_XML
    .replace('</Objects>', `<Object name="${name}" type="${type}"/></Objects>`)
    .replace('</ObjectData>', `<Object name="${name}"><Properties><Property name="Label" type="App::PropertyString"><String value="Auxiliary"/></Property></Properties></Object></ObjectData>`);
  it.each(["Assembly::JointGroup", "Assembly::Joint"])("ignores %s by type without removing it", type => {
    const xml = extra(type);
    expect(inspectFcstdBatchTarget(xml).objectName).toBe("Body");
    expect(patchFcstdEmbeddedBomDocumentXml(xml, { PartName: "示例侧板" }).xml).toContain(`type="${type}"`);
  });
  it("does not exempt an actual part merely named Joints", () => {
    expect(() => inspectFcstdBatchTarget(extra("PartDesign::Body", "Joints"))).toThrow(FcstdBatchTargetAmbiguityError);
  });
});
const UNTOUCHED_OBJECT = `<Object name="Feature"><Properties Count="1"><Property name="Label" type="App::PropertyString"><String value="保留节点"/></Property></Properties></Object>`;
function countedDocument(type = "PartDesign::Body"): string {
  return `<Document><Properties Count="0"/>
    <Objects Count="2"><Object type="${type}" name="Body"/><Object type="PartDesign::Feature" name="Feature"/></Objects>
    <ObjectData Count="2"><Object name="Body"><Properties Count="2" TransientCount="2">
      <Property name="Label" type="App::PropertyString"><String value="测试零件"/></Property>
      <Property name="Group" type="App::PropertyLinkList"><LinkList count="1"><Link value="Feature"/></LinkList></Property>
    </Properties></Object>${UNTOUCHED_OBJECT}</ObjectData></Document>`;
}
function archiveFor(xml: string): string {
  const filename = path.join(tempRoot("fcstd-count-write-"), "part.FCStd");
  fs.writeFileSync(filename, zipSync({ "Document.xml": strToU8(xml), "GuiDocument.xml": strToU8("keep me") }));
  return filename;
}
function xmlFrom(filename: string): string {
  return strFromU8(unzipSync(fs.readFileSync(filename))["Document.xml"]);
}

describe("FCStd Document.xml Node adapter", () => {
  it("extracts only Document.xml and delegates BOM projection to Wing", async () => {
    const root = tempRoot("fcstd-ts-read-");
    const filename = path.join(root, "part.FCStd");
    fs.writeFileSync(filename, zipSync({
      "Document.xml": strToU8(DOCUMENT_XML),
      "GuiDocument.xml": strToU8("not parsed"),
    }));
    const expected = {
      PartNumber: "800001",
      PartVersion: "001",
      TypeCode: "H",
      ModelSeries: "PX",
      PartName: "滑轨",
      label: "测试零件",
    };

    expect(readFcstdEmbeddedBomFields(filename)).toEqual(expected);
    await expect(readFcstdEmbeddedBomFieldsAsync(filename)).resolves.toEqual(expected);
  });

  it("fails closed for invalid archives and missing Document.xml", () => {
    expect(extractDocumentXmlFromFcstdBytes(strToU8("not a zip"))).toBeNull();
    expect(extractDocumentXmlFromFcstdBytes(zipSync({ "GuiDocument.xml": strToU8("x") }))).toBeNull();
  });

  it("updates BOM fields through Wing and preserves other archive entries", () => {
    const root = tempRoot("fcstd-ts-write-");
    const filename = path.join(root, "part.FCStd");
    fs.writeFileSync(filename, zipSync({
      "Document.xml": strToU8(DOCUMENT_XML),
      "GuiDocument.xml": strToU8("keep me"),
    }));

    expect(writeFcstdEmbeddedBomFields(filename, {
      PartNumber: "900&002",
      PartName: "支架 <左>",
      label: "新标签",
    })).toEqual({ changed: true, objectName: "Body" });
    expect(readFcstdEmbeddedBomFields(filename)).toMatchObject({
      PartNumber: "900&002",
      PartName: "支架 <左>",
      label: "新标签",
    });
    const archive = unzipSync(new Uint8Array(fs.readFileSync(filename)));
    expect(strFromU8(archive["GuiDocument.xml"])).toBe("keep me");
    expect(strFromU8(archive["Document.xml"]))
      .toMatch(/<Property name="PartNumber" type="App::PropertyString" group="CustomDefine" doc="零件号" attr="0" ro="0" hide="0" status="2097152">/);
    expect(fs.readdirSync(root).sort()).toEqual(["part.FCStd"]);

    expect(writeFcstdEmbeddedBomFields(filename, {
      PartNumber: "900&002",
      PartName: "支架 <左>",
      label: "新标签",
    }).changed).toBe(false);
  });

  it.each(["PartDesign::Body", "App::Part"])("counts newly inserted properties on %s without changing other counts", (type) => {
    const filename = archiveFor(countedDocument(type));
    expect(writeFcstdEmbeddedBomFields(filename, BOM_FIELDS)).toEqual({ changed: true, objectName: "Body" });
    const xml = xmlFrom(filename);
    expect(xml).toContain('<Properties Count="7" TransientCount="2">');
    expect(xml).toContain('<Document><Properties Count="0"/>');
    expect(xml).toContain('<Objects Count="2">');
    expect(xml).toContain('<ObjectData Count="2">');
    expect(xml).toContain(UNTOUCHED_OBJECT);
    expect(readFcstdEmbeddedBomFields(filename)).toMatchObject(BOM_FIELDS);
    expect(strFromU8(unzipSync(fs.readFileSync(filename))["GuiDocument.xml"])).toBe("keep me");
    const after = fs.readFileSync(filename);
    expect(writeFcstdEmbeddedBomFields(filename, BOM_FIELDS).changed).toBe(false);
    expect(fs.readFileSync(filename)).toEqual(after);
  });

  it("repairs an existing stale Count even when no field value changes", () => {
    const xml = DOCUMENT_XML.replace('<Properties>', '<Properties TransientCount="2" Count = \'1\'>')
      .replace('name="PartNumber" type="App::PropertyString"', 'name="PartNumber" type="App::PropertyString" group="CustomDefine" doc="原说明" attr="0" ro="0" hide="0" status="2097152"');
    const filename = archiveFor(xml);
    const fields = readFcstdEmbeddedBomFields(filename)!;
    // Freeze canonical values/metadata first, then damage only Count, as in the
    // reported file. Even a Wing no-op must still repair the persisted count.
    writeFcstdEmbeddedBomFields(filename, fields);
    const validXml = xmlFrom(filename);
    fs.writeFileSync(filename, zipSync({
      "Document.xml": strToU8(validXml.replace("Count = '6'", "Count = '1'")),
    }));
    expect(writeFcstdEmbeddedBomFields(filename, fields).changed).toBe(true);
    expect(xmlFrom(filename)).toContain('<Properties TransientCount="2" Count = \'6\'>');
    expect(xmlFrom(filename)).toBe(validXml);
    expect(xmlFrom(filename)).toContain('doc="原说明"');
    expect(readFcstdEmbeddedBomFields(filename)).toEqual(fields);
    const after = fs.readFileSync(filename);
    expect(writeFcstdEmbeddedBomFields(filename, fields).changed).toBe(false);
    expect(fs.readFileSync(filename)).toEqual(after);
  });

  it("adds Count to a legacy container without an explicit count", () => {
    const filename = archiveFor(DOCUMENT_XML);
    writeFcstdEmbeddedBomFields(filename, { PartName: "旧格式" });
    expect(xmlFrom(filename)).toContain('<Properties Count="6">');
    expect(writeFcstdEmbeddedBomFields(filename, { PartName: "旧格式" }).changed).toBe(false);
  });

  it("restores the original bytes and removes temp files when atomic replacement fails", () => {
    const root = tempRoot("fcstd-ts-rollback-");
    const filename = path.join(root, "part.FCStd");
    const original = zipSync({ "Document.xml": strToU8(DOCUMENT_XML) });
    fs.writeFileSync(filename, original);
    const realRename = fs.renameSync.bind(fs);
    let calls = 0;
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      calls += 1;
      if (calls === 2) throw new Error("injected atomic replacement failure");
      return realRename(source, target);
    });

    try {
      expect(() => writeFcstdEmbeddedBomFields(filename, { PartName: "Should rollback" }))
        .toThrow("injected atomic replacement failure");
    } finally {
      rename.mockRestore();
    }

    expect(fs.readFileSync(filename)).toEqual(Buffer.from(original));
    expect(fs.readdirSync(root)).toEqual(["part.FCStd"]);
  });
});
