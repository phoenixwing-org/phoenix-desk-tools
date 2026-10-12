import { describe, expect, it } from "vitest";
import { pnwIsCadNativeV1FcstdDocument } from "@phoenix-wing/cad-contracts";
import { CAD_OBJECT_LIMITS, decodeCadXmlAttribute, parseCadObjectDocumentXml } from "./document.js";
import { CadObjectInfoBudget } from "./budget.js";

// Independently constructed serialization cases, not copied from any CAD project.
const prop = (name: string, value: string, type = "App::PropertyString") => `<Property name="${name}" type="${type}">${value}</Property>`;
const obj = (name: string, type: string, properties = "", tail = "") => `<Object name="${name}" type="${type}"><Properties>${properties}</Properties>${tail}</Object>`;
const doc = (objects: string) => `<Document><ObjectData>${objects}</ObjectData></Document>`;

describe("shared single-pass CAD XML entity compatibility port", () => {
  it("does not decode escaped entity syntax twice", () => {
    expect(decodeCadXmlAttribute("A&#38;amp;B.FCStd")).toBe("A&amp;B.FCStd");
    expect(decodeCadXmlAttribute("&amp;lt; &amp;#65; &#x26;#x41;")).toBe("&lt; &#65; &#x41;");
  });
  it("accepts literal greater-than, standard entities and valid numeric references", () => {
    expect(decodeCadXmlAttribute("A>B &lt; &amp; &#65; &#x1F642;")).toBe("A>B < & A 🙂");
  });
  it.each(["&unknown;", "&unfinished", "&#0;", "&#x110000;", "\uD800"])("rejects unknown/invalid XML input %j", value => {
    expect(() => decodeCadXmlAttribute(value)).toThrowError(expect.objectContaining({ code: "invalid_document_xml" }));
  });
});

describe("saved CAD native v1 object document", () => {
  it("maps known saved local translation and Z quarter-turn quaternion without parent composition or normalization", async () => {
    const half = Math.SQRT1_2;
    const { document } = await parseCadObjectDocumentXml(doc(
      obj("Parent", "App::Part", prop("Group", '<Link value="Child"/>')
        + prop("Placement", '<PropertyPlacement Px="100" Py="200" Pz="300" Q0="0" Q1="0" Q2="0" Q3="1"/>'))
      + obj("Child", "Part::Feature", prop("Placement", `<PropertyPlacement Px="7" Py="-11" Pz="13" Q0="0" Q1="0" Q2="${half}" Q3="${half}"/>`))
      + obj("Unnormalized", "Part::Feature", prop("Placement", '<PropertyPlacement Px="1" Py="2" Pz="3" Q0="0" Q1="0" Q2="2" Q3="2"/>'))));
    expect(document.objects[1].placement).toEqual({ x: 7, y: -11, z: 13, q0: 0, q1: 0, q2: half, q3: half });
    expect(document.objects[2].placement).toEqual({ x: 1, y: 2, z: 3, q0: 0, q1: 0, q2: 2, q3: 2 });
    // This freezes saved scalar ordering only, not FreeCAD geometry, world coordinates or runtime units.
  });
  it("checks the shared deadline during XML parsing rather than returning a partial document", async () => {
    let now = 0;
    const budget = new CadObjectInfoBudget(undefined, { durationMs: 5, now: () => now++ });
    await expect(parseCadObjectDocumentXml(doc(obj("A", "Part::Feature")), undefined, budget)).rejects.toMatchObject({ code: "timeout" });
  });
  it("projects every frozen field, multiple roots, duplicate Group instances and local placement", async () => {
    const xml = doc(obj("Container", "App::Part",
      prop("Label", '<String value="Root &amp; Frame"/>')
      + prop("Group", '<Link value="Body"/><Link name="Body"/><Link value="Nested"/>')
      + prop("Material", '<String value="Steel"/>')
      + prop("Placement", '<PropertyPlacement Px="10" Py="-2.5" Pz="3e1" Q0="0.1" Q1="0.2" Q2="0.3" Q3="0.9"/>')
      + prop("Code", '<String value="generic"/>') + prop("Measure", '<PropertyLength value="12.5"/>') + prop("Count", '<Integer value="2"/>'))
      + obj("Body", "PartDesign::Body", prop("Material", '<Integer value="7"/>'))
      + obj("Nested", "App::LinkGroup", prop("Group", '<Link value="Feature"/>'))
      + obj("Feature", "Part::Feature") + obj("Separate", "Assembly::AssemblyObject")
      + obj("Hidden", "Sketcher::SketchObject") + obj("LinkOnly", "App::Link"));
    const { document } = await parseCadObjectDocumentXml(xml);
    expect(pnwIsCadNativeV1FcstdDocument(document)).toBe(true);
    expect(document.objects).toHaveLength(7);
    expect(document.root_names).toEqual(["Container", "Separate"]);
    expect(document.objects[0]).toEqual({ name: "Container", label: "Root & Frame", type_id: "App::Part",
      children: ["Body", "Body", "Nested"], properties: { Code: "generic", Measure: 12.5, Count: 2 },
      material: "Steel", placement: { x: 10, y: -2.5, z: 30, q0: 0.1, q1: 0.2, q2: 0.3, q3: 0.9 }, is_valid_bom_item: true, level: 0 });
    expect(document.objects.map(object => object.level)).toEqual([0, 1, 1, 2, 0, 0, 0]);
    expect(document.objects[1].material).toBeNull();
    expect(document.objects[5].is_valid_bom_item).toBe(false);
  });

  it("keeps declaration-only objects and resolves modern types without filtering document objects", async () => {
    const { document } = await parseCadObjectDocumentXml(`<Document><Objects>
      <Object name="A" type="PartDesign::Body"/><Object name="B" type="Sketcher::SketchObject"/>
      </Objects><ObjectData><Object name="A"><Properties/></Object></ObjectData></Document>`);
    expect(document.objects.map(object => [object.name, object.type_id])).toEqual([["A", "PartDesign::Body"], ["B", "Sketcher::SketchObject"]]);
  });

  it("distinguishes missing and explicitly empty labels/material/strings; decodes text, entities and CDATA", async () => {
    const { document } = await parseCadObjectDocumentXml(doc(obj("Missing", "Part::Feature")
      + obj("Empty", "Part::Feature", prop("Label", '<String value=""/>') + prop("Material", '<String/>') + prop("Empty", '<String value=""/>'))
      + obj("Text", "Part::Feature", prop("Label", '<String>Text &#65; &#x1F642; &lt; &quot; &apos;</String>')
      + prop("Literal", '<String><![CDATA[A & B < C]]></String>'))));
    expect(document.objects[0].label).toBe("Missing");
    expect(document.objects[0].material).toBeNull();
    expect(document.objects[1].label).toBe("");
    expect(document.objects[1].material).toBe("");
    expect(document.objects[1].properties.Empty).toBe("");
    expect(document.objects[2].label).toBe('Text A 🙂 < " \'');
    expect(document.objects[2].properties.Literal).toBe("A & B < C");
  });

  it("retains each legacy and modern nested XLink even inside unknown properties", async () => {
    const { document } = await parseCadObjectDocumentXml(doc(obj("Instance", "App::Link",
      prop("Label", '<String value=""/>') + prop("LinkedObject", '<XLink file="parts/A&amp;B.FCStd"/>', "App::PropertyXLink")
      + prop("FutureLink", '<PropertyXLink><XLink file="parts/A&amp;B.FCStd" label="Explicit &lt; label"/></PropertyXLink>', "Future::Property"),
      '<XLink file="notes.txt"/><XLink file="" label=""/>')));
    expect(document.xlinks).toEqual([{ file: "parts/A&B.FCStd", label: "" }, { file: "parts/A&B.FCStd", label: "Explicit < label" },
      { file: "notes.txt", label: "" }, { file: "", label: "" }]);
    expect(document.objects[0].properties).toEqual({});
    expect(document.root_names).toEqual([]);
  });

  it("preserves unprojectable properties as a warning, never coercing them to zero", async () => {
    const { document, warnings } = await parseCadObjectDocumentXml(doc(obj("A", "Part::Feature",
      prop("Complex", '<Vector x="1" y="2" z="3"/>', "App::PropertyVector") + prop("NoValue", "", "App::PropertyFloat"))));
    expect(document.objects[0].properties).toEqual({});
    expect(warnings[0]).toContain("2 个");
  });
  it("retains prototype-like scalar property names as own JSON keys", async () => {
    const keys = ["__proto__", "constructor", "toString", "toJSON"];
    const { document } = await parseCadObjectDocumentXml(doc(obj("A", "Part::Feature", keys.map(key => prop(key, `<String value="saved-${key}"/>`)).join(""))));
    expect(Object.getPrototypeOf(document.objects[0].properties)).toBeNull();
    const serialized = JSON.parse(JSON.stringify(document)).objects[0].properties;
    for (const key of keys) {
      expect(Object.hasOwn(document.objects[0].properties, key)).toBe(true);
      expect(Object.hasOwn(serialized, key)).toBe(true);
      expect(serialized[key]).toBe(`saved-${key}`);
    }
  });

  it("uses breadth-first first arrival, retains cycles/unreachable objects and dangling Group names", async () => {
    const { document, warnings } = await parseCadObjectDocumentXml(doc(
      obj("Root", "App::Part", prop("Group", '<Link value="Deep"/><Link value="Leaf"/><Link value="Unknown"/>'))
      + obj("Deep", "App::Part", prop("Group", '<Link value="Leaf"/>')) + obj("Leaf", "Part::Feature")
      + obj("CycleA", "App::Part", prop("Group", '<Link value="CycleB"/>'))
      + obj("CycleB", "App::Part", prop("Group", '<Link value="CycleA"/>'))));
    expect(document.root_names).toEqual(["Root"]);
    expect(document.objects.map(object => object.level)).toEqual([0, 1, 1, 0, 0]);
    expect(warnings).toHaveLength(3);
  });
  it("reports a reachable cycle without repeating objects or inventing deeper levels", async () => {
    const { document, warnings } = await parseCadObjectDocumentXml(doc(
      obj("Root", "App::Part", prop("Group", '<Link value="A"/>'))
      + obj("A", "App::Part", prop("Group", '<Link value="B"/>'))
      + obj("B", "App::Part", prop("Group", '<Link value="A"/>'))));
    expect(document.objects.map(object => object.level)).toEqual([0, 1, 2]);
    expect(warnings).toEqual([expect.stringContaining("循环引用")]);
  });

  it.each(["NaN", "Infinity", "-Infinity", "1e999", "", "12bad", "0x10"])("rejects nonfinite/invalid numeric %j", async value => {
    await expect(parseCadObjectDocumentXml(doc(obj("A", "Part::Feature", prop("Value", `<Float value="${value}"/>`)))))
      .rejects.toMatchObject({ code: "invalid_numeric_value" });
  });
  it.each(["1.2", "1e3", "9007199254740993"])("rejects inexact integer %s", async value => {
    await expect(parseCadObjectDocumentXml(doc(obj("A", "Part::Feature", prop("Value", `<Integer value="${value}"/>`)))))
      .rejects.toMatchObject({ code: "invalid_numeric_value" });
  });
  it("does not invent missing placement components", async () => {
    await expect(parseCadObjectDocumentXml(doc(obj("A", "Part::Feature", prop("Placement", '<PropertyPlacement Px="1"/>')))))
      .rejects.toMatchObject({ code: "invalid_numeric_value" });
  });
  it.each([
    '<Document><ObjectData><Object name="A"><Properties></Object></ObjectData></Document>',
    '<Document><ObjectData/><Bad', '<Document/><Document/>', '<Document/>trailing',
    '<Document><String value="&unknown;"/></Document>', '<Document><String value="&#0;"/></Document>',
    '<Document>&amp</Document>', '<Document>raw]]></Document>', '<!DOCTYPE Document SYSTEM "file:///not-read"><Document/>',
    '<Document><!-- illegal -- text --></Document>', '<![CDATA[not outside]]><Document/>',
    '<Document><ObjectData><Object name="A"/><Object name="A"/></ObjectData></Document>',
    '<Document><String value="one" value="two"/></Document>',
    '<?xml version="1.0" encoding="UTF-16"?><Document/>',
    '<Document><!-- bad character \u0000 --></Document>',
  ])("rejects complete-XML violation case %# without a partial successful document", async xml => {
    await expect(parseCadObjectDocumentXml(xml)).rejects.toMatchObject({ code: "invalid_document_xml" });
  });
  it("accepts comments/PI and UTF-8 declaration without treating their example objects as real", async () => {
    const { document } = await parseCadObjectDocumentXml('<?xml version="1.0" encoding="UTF-8"?><Document><!-- <Object name="fake"/> --><?example test?><ObjectData/></Document>');
    expect(document.objects).toEqual([]);
  });
  it("bounds XML bytes, depth, node count and object count", async () => {
    await expect(parseCadObjectDocumentXml(`<Document>${" ".repeat(CAD_OBJECT_LIMITS.xmlBytes)}</Document>`)).rejects.toMatchObject({ code: "resource_limit" });
    await expect(parseCadObjectDocumentXml(`<Document>${"<Group>".repeat(128)}${"</Group>".repeat(128)}</Document>`)).rejects.toMatchObject({ code: "resource_limit" });
    await expect(parseCadObjectDocumentXml(`<Document>${"<Value/>".repeat(CAD_OBJECT_LIMITS.nodes)}</Document>`)).rejects.toMatchObject({ code: "resource_limit" });
    await expect(parseCadObjectDocumentXml(doc(Array.from({ length: 10001 }, (_, i) => obj(`O${i}`, "Part::Feature")).join("")))).rejects.toMatchObject({ code: "resource_limit" });
  });
  it("cancels before and during a large XML parse", async () => {
    const before = new AbortController(); before.abort();
    await expect(parseCadObjectDocumentXml("<Document/>", before.signal)).rejects.toMatchObject({ code: "cancelled" });
    const during = new AbortController();
    const pending = parseCadObjectDocumentXml(doc(Array.from({ length: 500 }, (_, i) => obj(`O${i}`, "Part::Feature")).join("")), during.signal);
    setImmediate(() => during.abort());
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
});
