import { describe, expect, it } from "vitest";
import { readFcstdAssemblyLinks, readFcstdAssemblyState } from "./fcstdAssemblyState.js";

// Independently constructed metadata, not a copied engineering assembly.
function document(rigid: string, type = "Assembly::AssemblyLink") {
  return `<Document><Objects><Object name="Sub" type="${type}"/></Objects><ObjectData>
    <Object name="Sub"><Properties>
    <Property name="Label" type="App::PropertyString"><String value="Stage &amp; fixture"/></Property>
    <Property name="LinkedObject" type="App::PropertyXLink"><XLink file="Child&amp;fixture.FCStd" name="Assembly"/></Property>
    ${rigid}</Properties></Object></ObjectData></Document>`;
}
const property = (value: string, type = "App::PropertyBool") => `<Property name="Rigid" type="${type}"><Bool value="${value}"/></Property>`;
describe("saved AssemblyLink intent", () => {
  it.each([["true", true], ["false", false], ["1", true], ["0", false]])("reads %s without treating false as missing", (value, expected) => {
    expect(readFcstdAssemblyLinks(document(property(String(value))))).toEqual([{
      object_name: "Sub", label: "Stage & fixture", target_file: "Child&fixture.FCStd", target_object_name: "Assembly", rigid: expected,
    }]);
  });
  it.each(["", property("yes"), property("false", "App::PropertyString"), '<Property name="Rigid" type="App::PropertyBool"><Bool value="true"/><Bool value="false"/></Property>'])("keeps unknown state instead of assuming rigid [case %#]", rigid => {
    expect(readFcstdAssemblyLinks(document(rigid))[0].rigid).toBeNull();
  });
  it.each(["App::Link", "App::Part", "Assembly::AssemblyObject"])("does not infer Rigid for %s", type => {
    expect(readFcstdAssemblyLinks(document(property("true"), type))).toEqual([]);
  });
  it("ignores comments, CDATA and conflicting type declarations", () => {
    const xml = document(property("true"));
    expect(readFcstdAssemblyLinks(`<Document><!-- ${xml} --><![CDATA[${xml}]]></Document>`)).toEqual([]);
    expect(readFcstdAssemblyLinks(xml.replace("</Objects>", '<Object name="Sub" type="App::Link"/></Objects>'))).toEqual([]);
  });
  it("preserves distinct rigid and flexible instances of the same target", () => {
    const first = document(property("true")), second = document(property("false")).replaceAll('name="Sub"', 'name="Other"');
    const declarations = [first, second].map(xml => /<Objects>(.*?)<\/Objects>/.exec(xml)![1]).join("");
    const objects = [first, second].map(xml => /<ObjectData>([\s\S]*?)<\/ObjectData>/.exec(xml)![1]).join("");
    expect(readFcstdAssemblyLinks(`<Document><Objects>${declarations}</Objects><ObjectData>${objects}</ObjectData></Document>`).map(row => row.rigid)).toEqual([true, false]);
  });
});

function jointDocument(reference: string, declarations = '<Object name="Anchor" type="App::Link"/>', proxy = 'module="JointObject" class="Joint"') {
  return `<Document><Objects><Object name="Joint" type="App::FeaturePython"/>${declarations}</Objects><ObjectData><Object name="Joint"><Properties>
    <Property name="Proxy" type="App::PropertyPythonObject"><Python ${proxy}/></Property>
    <Property name="Reference1" type="App::PropertyXLinkSub"><XLink file="" name="Anchor" sub=""/></Property>
    <Property name="Reference2" type="App::PropertyXLinkSub">${reference}</Property>
    </Properties></Object></ObjectData></Document>`;
}
describe("narrow saved joint disconnection checks", () => {
  it("detects an explicitly empty end without trusting the object's recompute state", () => {
    expect(readFcstdAssemblyState(jointDocument('<XLink file="" name=""/>')).joint_issues).toEqual([
      { object_name: "Joint", label: "Joint", reference: "Reference2", reason: "empty_reference", target_object_name: null },
    ]);
  });
  it("detects a local target missing from object declarations", () => {
    expect(readFcstdAssemblyState(jointDocument('<XLink file="" name="RemovedObject"/>')).joint_issues).toEqual([
      { object_name: "Joint", label: "Joint", reference: "Reference2", reason: "missing_local_object", target_object_name: "RemovedObject" },
    ]);
  });
  it.each(['<XLink file="" name="Anchor" sub="Face1"/>', '<XLink file="Child.FCStd" name="External" sub="Face1"/>'])("does not pretend to natively validate nonempty local subelements or external links [case %#]", ref => {
    expect(readFcstdAssemblyState(jointDocument(ref)).joint_issues).toEqual([]);
  });
  it.each(['module="OtherWorkbench" class="Joint"', 'module="JointObject" class="GroundedJoint"'])("does not diagnose unrelated objects as two-ended joints [case %#]", proxy => {
    expect(readFcstdAssemblyState(jointDocument('<XLink file="" name=""/>', undefined, proxy)).joint_issues).toEqual([]);
  });
  it("keeps unsupported legacy and malformed references out of proven-disconnection results", () => {
    for (const reference of ["", '<XLink file=""/>', '<XLink file="" name=""/><XLink file="" name="Anchor"/>']) {
      expect(readFcstdAssemblyState(jointDocument(reference)).joint_issues).toEqual([]);
    }
  });
  it("does not mistake a legacy local ObjectData entry without a TypeId for a deleted target", () => {
    const xml = jointDocument('<XLink file="" name="Anchor"/>', "").replace("</ObjectData>", '<Object name="Anchor"><Properties/></Object></ObjectData>');
    expect(readFcstdAssemblyState(xml).joint_issues).toEqual([]);
  });
});
