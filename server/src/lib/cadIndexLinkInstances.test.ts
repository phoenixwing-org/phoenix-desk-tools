import { describe, expect, it } from "vitest";
import { analyzeCadIndexDocumentXmlWithInstances } from "./cadIndexLinkInstances.js";

describe("CAD index serialized link quantities", () => {
  it("keeps repeated objects without double-counting one object's duplicate properties", () => {
    const result = analyzeCadIndexDocumentXmlWithInstances(`<Document><ObjectData>
      <Object name="First"><Properties>
        <Property name="Label"><String value="first &amp; label"/></Property>
        <Property name="LinkedObject" type="App::PropertyXLink"><XLink file="./Leaf.FCStd" name="Body"/></Property>
        <Property name="CachedSource"><XLink file="./Leaf.FCStd" name="Body"/></Property>
      </Properties></Object>
      <Object name="Second"><Properties><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="./Leaf.FCStd" name="Body"/></Property></Properties></Object>
      <!-- <Object name="Fake"><XLink file="./Leaf.FCStd"/></Object> -->
      <![CDATA[<XLink file="./Leaf.FCStd"/>]]>
    </ObjectData></Document>`);
    expect(result.xlinks).toEqual([{ file: "./Leaf.FCStd", label: "first & label" }, { file: "./Leaf.FCStd", label: "" }]);
  });
  it("keeps old root-level references and nested objects as separate instances", () => {
    expect(analyzeCadIndexDocumentXmlWithInstances(`<Document><XLink file="Leaf.FCStd"/><XLink file="Leaf.FCStd"/></Document>`).xlinks).toHaveLength(2);
    expect(analyzeCadIndexDocumentXmlWithInstances(`<Document><ObjectData><Object name="Parent"><XLink file="Leaf.FCStd"/>
      <Object name="Child"><XLink file="Leaf.FCStd"/></Object></Object></ObjectData></Document>`).xlinks).toHaveLength(2);
  });
  it("rejects bad XML instead of producing a successful empty graph", () => {
    expect(() => analyzeCadIndexDocumentXmlWithInstances("<Document><ObjectData>")).toThrow(/incomplete/);
  });
  it("preserves quoted > and decodes XML entities exactly once", () => {
    const xml = `<Document><ObjectData>
      <Object name="Angle"><Properties><Property name="LinkedObject"><XLink file="A>B.FCStd"/></Property></Properties></Object>
      <Object name="Entity"><Properties><Property name="Label"><String value="A&#38;amp;B"/></Property><Property name="LinkedObject"><XLink file="A&#38;amp;B.FCStd"/></Property></Properties></Object>
      <Object name="EncodedAngle"><XLink file="A&gt;B.FCStd"/></Object>
    </ObjectData></Document>`;
    expect(analyzeCadIndexDocumentXmlWithInstances(xml).xlinks).toEqual([
      { file: "A>B.FCStd", label: "" }, { file: "A&amp;B.FCStd", label: "A&amp;B" }, { file: "A>B.FCStd", label: "" },
    ]);
    expect(() => analyzeCadIndexDocumentXmlWithInstances(`<Document><XLink file="A&unknown;B.FCStd"/></Document>`)).toThrow(/格式无效/);
  });
  it.each([
    '<XLink file="Leaf.FCStd" name="A"/><XLink file="Leaf.FCStd" name="B"/>',
    '<XLink file="Leaf.FCStd" name="A"/><XLink file="Another.FCStd" name="B"/>',
  ])("fails closed on unsupported same-object multi-target semantics: %s", body => {
    expect(() => analyzeCadIndexDocumentXmlWithInstances(`<Document><ObjectData><Object name="Array"><Properties><Property name="LinkedObject" type="App::PropertyXLinkList">${body}</Property></Properties></Object></ObjectData></Document>`)).toThrow(/multi-target.*unsupported/);
  });
  it("applies the same fail-closed array rule to legacy direct Object layout", () => {
    const xml = `<Document><Object name="Array"><Properties><Property name="LinkedObject" type="App::PropertyXLinkList">
      <XLink file="Leaf.FCStd" name="A"/><XLink file="Leaf.FCStd" name="B"/>
      </Property></Properties></Object></Document>`;
    expect(() => analyzeCadIndexDocumentXmlWithInstances(xml)).toThrow(/multi-target.*unsupported/);
  });
  it.each(["ObjectData", "direct Object"])("does not guess identical list-entry quantities in %s layout", layout => {
    const object = `<Object name="Array"><Properties><Property name="LinkedObject" type="App::PropertyXLinkList">
      <XLink file="Leaf.FCStd" name="Body"/><XLink file="Leaf.FCStd" name="Body"/>
      </Property></Properties></Object>`;
    const xml = `<Document>${layout === "ObjectData" ? `<ObjectData>${object}</ObjectData>` : object}</Document>`;
    expect(() => analyzeCadIndexDocumentXmlWithInstances(xml)).toThrow(/multi-target.*unsupported/);
  });
  it("rejects unsupported list types even when they currently have only one entry", () => {
    expect(() => analyzeCadIndexDocumentXmlWithInstances(`<Document><ObjectData><Object name="Array"><Properties>
      <Property name="LinkedObject" type="App::PropertyXLinkSubList"><XLink file="Leaf.FCStd" name="Body"/></Property>
      </Properties></Object></ObjectData></Document>`)).toThrow(/multi-target.*unsupported/);
  });
  it("counts legacy direct Object instances once and leaves bare Document links separate", () => {
    const xml = `<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects>
      <Object name="First"><Properties><Property name="LinkedObject"><XLink file="A>B.FCStd" name="Body"/></Property>
      <Property name="CachedSource"><XLink file="A>B.FCStd" name="Body"/></Property></Properties></Object>
      <Object name="Second"><XLink file="A>B.FCStd" name="Body"/></Object>
      <XLink file="A&gt;B.FCStd"/>
      </Document>`;
    expect(analyzeCadIndexDocumentXmlWithInstances(xml).xlinks).toEqual([
      { file: "A>B.FCStd", label: "" }, { file: "A>B.FCStd", label: "" }, { file: "A>B.FCStd", label: "" },
    ]);
  });
  it.each(["ObjectData", "direct Object"])("includes a single XLink outside Properties at the Object tail in %s layout", layout => {
    const object = `<Object name="Tail"><Properties><Property name="Label"><String value="tail label"/></Property></Properties>
      <XLink file="Tail>A&#38;amp;B.FCStd" name="Body"/></Object>`;
    const xml = `<Document>${layout === "ObjectData" ? `<ObjectData>${object}</ObjectData>` : object}</Document>`;
    expect(analyzeCadIndexDocumentXmlWithInstances(xml).xlinks).toEqual([{ file: "Tail>A&amp;B.FCStd", label: "tail label" }]);
  });
  it.each(["ObjectData", "direct Object"])("coalesces the same cached property and bare tail instance in %s layout", layout => {
    const object = `<Object name="Tail"><Properties><Property name="LinkedObject"><XLink file="Leaf.FCStd" name="Body"/></Property></Properties>
      <XLink file="Leaf.FCStd" name="Body"/></Object>`;
    const xml = `<Document>${layout === "ObjectData" ? `<ObjectData>${object}</ObjectData>` : object}</Document>`;
    expect(analyzeCadIndexDocumentXmlWithInstances(xml).xlinks).toEqual([{ file: "Leaf.FCStd", label: "" }]);
  });
  it.each([
    ["ObjectData", '<XLink file="Leaf.FCStd" name="A"/><XLink file="Leaf.FCStd" name="B"/>'],
    ["direct Object", '<XLink file="Leaf.FCStd" name="A"/><XLink file="Leaf.FCStd" name="B"/>'],
    ["ObjectData", '<XLink file="Leaf.FCStd" name="A"/><XLink file="Leaf.FCStd" name="A"/>'],
    ["direct Object", '<XLink file="Leaf.FCStd" name="A"/><XLink file="Leaf.FCStd" name="A"/>'],
    ["ObjectData", '<Properties><Property name="LinkedObject"><XLink file="Leaf.FCStd" name="A"/></Property></Properties><XLink file="Leaf.FCStd" name="B"/>'],
    ["direct Object", '<Properties><Property name="LinkedObject"><XLink file="Leaf.FCStd" name="A"/></Property></Properties><XLink file="Leaf.FCStd" name="B"/>'],
  ])("rejects unknown multi-target/array quantity at the Object tail in %s layout (case %#)", (layout, body) => {
    const object = `<Object name="Tail">${body}</Object>`;
    const xml = `<Document>${layout === "ObjectData" ? `<ObjectData>${object}</ObjectData>` : object}</Document>`;
    expect(() => analyzeCadIndexDocumentXmlWithInstances(xml)).toThrow(/multi-target.*unsupported/);
  });

  it.each(["TechDraw::DrawProjGroup", "TechDraw::DrawProjGroupItem", "TechDraw::DrawViewPart"])(
    "preserves declared %s XSource dependencies without treating their list as a quantity", type => {
      const xml = `<Document><Objects><Object name="View" type="${type}"/></Objects><ObjectData>
        <Object name="View"><Properties><Property name="XSource" type="App::PropertyXLinkList">
          <XLink file="Leaf.FCStd" name="Body"/>
        </Property></Properties></Object></ObjectData></Document>`;
      const result = analyzeCadIndexDocumentXmlWithInstances(xml);
      expect(result.xlinks).toEqual([{ file: "Leaf.FCStd", label: "" }]);
      expect(result.bomXlinks).toEqual([]);
      expect(result.documentRole).toBe("drawing");
    },
  );
  it("keeps all drawing source files once across source objects and multiple projection views", () => {
    const xml = `<Document><Objects><Object name="Model" type="App::Link"/>
      <Object name="Front" type="TechDraw::DrawProjGroupItem"/><Object name="Side" type="TechDraw::DrawProjGroupItem"/></Objects><ObjectData>
      <Object name="Model"><Properties><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="Leaf.FCStd" name="Body"/></Property></Properties></Object>
      <Object name="Front"><Properties><Property name="XSource" type="App::PropertyXLinkList">
        <XLink file="Leaf.FCStd" name="Body"/><XLink file="Leaf.FCStd" name="Face"/><XLink file="Other.FCStd" name="Body"/>
      </Property></Properties></Object>
      <Object name="Side"><Properties><Property name="XSource" type="App::PropertyXLinkList"><XLink file="Leaf.FCStd" name="Body"/></Property></Properties></Object>
      </ObjectData></Document>`;
    const result = analyzeCadIndexDocumentXmlWithInstances(xml);
    expect(result.xlinks).toEqual([{ file: "Leaf.FCStd", label: "" }, { file: "Other.FCStd", label: "" }]);
    expect(result.bomXlinks).toEqual([]);
    expect(result.documentRole).toBe("drawing");
  });
  it.each(["Assembly::AssemblyObject", "Part::Box", "Part::Cylinder", "Sketcher::SketchObject", "Mesh::Feature"])("retains physical quantities in a %s model containing TechDraw views", type => {
    const xml = `<Document><Objects><Object name="Assembly" type="${type}"/>
      <Object name="View" type="TechDraw::DrawViewPart"/><Object name="First" type="App::Link"/><Object name="Second" type="App::Link"/></Objects>
      <ObjectData><Object name="Assembly"><Properties/></Object><Object name="View"><Properties><Property name="Source" type="App::PropertyXLinkList">
        <XLink file="Leaf.FCStd" name="Body"/><XLink file="DrawingOnly.FCStd" name="Body"/>
      </Property></Properties></Object>
      <Object name="First"><Properties><Property name="LinkedObject"><XLink file="Leaf.FCStd" name="Body"/></Property></Properties></Object>
      <Object name="Second"><Properties><Property name="LinkedObject"><XLink file="Leaf.FCStd" name="Body"/></Property></Properties></Object>
      </ObjectData></Document>`;
    const result = analyzeCadIndexDocumentXmlWithInstances(xml);
    expect(result.bomXlinks.map(link => link.file)).toEqual(["Leaf.FCStd", "Leaf.FCStd"]);
    expect(result.documentRole).toBe("model");
    expect(result.xlinks.map(link => link.file)).toEqual(["Leaf.FCStd", "Leaf.FCStd", "DrawingOnly.FCStd"]);
  });
  it.each(["App::Link", "", "PartDesign::Body", "TechDraw::Unknown"])("does not allow an XSource list on unknown or physical type %s", type => {
    const declaration = type ? `<Objects><Object name="Array" type="${type}"/></Objects>` : "";
    expect(() => analyzeCadIndexDocumentXmlWithInstances(`<Document>${declaration}<ObjectData><Object name="Array"><Properties>
      <Property name="XSource" type="App::PropertyXLinkList"><XLink file="Leaf.FCStd" name="Body"/></Property>
      </Properties></Object></ObjectData></Document>`)).toThrow(/multi-target.*unsupported/);
  });
  it("does not relax true Link arrays merely because the document also has a drawing page", () => {
    const xml = `<Document><Objects><Object name="Page" type="TechDraw::DrawPage"/><Object name="Array" type="App::Link"/></Objects>
      <ObjectData><Object name="Array"><Properties><Property name="LinkedObject" type="App::PropertyXLinkList">
      <XLink file="Leaf.FCStd" name="Body"/></Property></Properties></Object></ObjectData></Document>`;
    expect(() => analyzeCadIndexDocumentXmlWithInstances(xml)).toThrow(/multi-target.*unsupported/);
  });
  it("does not allow unrecognized drawing-list properties or conflicting TypeIds", () => {
    const object = `<Object name="View"><Properties><Property name="LinkedObject" type="App::PropertyXLinkList">
      <XLink file="Leaf.FCStd" name="Body"/></Property></Properties></Object>`;
    expect(() => analyzeCadIndexDocumentXmlWithInstances(`<Document><Objects><Object name="View" type="TechDraw::DrawViewPart"/></Objects><ObjectData>${object}</ObjectData></Document>`))
      .toThrow(/multi-target.*unsupported/);
    expect(() => analyzeCadIndexDocumentXmlWithInstances(`<Document><Objects><Object name="View" type="TechDraw::DrawViewPart"/><Object name="View" type="App::Link"/></Objects><ObjectData>${object.replace('name="LinkedObject"', 'name="XSource"')}</ObjectData></Document>`))
      .toThrow(/multi-target.*unsupported/);
  });
});
