import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fcstdFingerprint } from "../../lib/fcstdBatchFiles.js";
import { CadObjectInfoBudget } from "../cad-object-info/budget.js";
import { captureSavedAssemblyBaseline, SAVED_ASSEMBLY_BASELINE_LIMITS, verifySavedAssemblyBaseline } from "./baseline.js";

// Independently constructed serialization only; no engineering files, project
// inventory, geometry, real part identifiers, or local configuration is copied.
const property = (name: string, type: string, value: string, metadata = "") => `<Property name="${name}" type="${type}"${metadata}>${value}</Property>`;
const string = (name: string, value: string, metadata = "") => property(name, "App::PropertyString", `<String value="${value}"/>`, metadata);
type ObjectXml = { name: string; type: string; properties: string };
const placement = property("Placement", "App::PropertyPlacement", '<PropertyPlacement Px="2.5" Py="0" Pz="-1" Q0="0" Q1="0" Q2="0" Q3="1"/>');
const group = (names: string[]) => property("Group", "App::PropertyLinkList", `<LinkList count="${names.length}">${names.map(name => `<Link value="${name}"/>`).join("")}</LinkList>`);
const xlink = (file: string, name = "Assembly", content = "") => `<XLink file="${file}" name="${name}" stamp="saved">${content}</XLink>`;
const safeProxy = (kind = "Joint") => `<Python value="bnVsbA==" encoded="yes" module="JointObject" class="${kind}"/>`;
const instance = (file = "Child.FCStd", name = "Instance", target = "Assembly"): ObjectXml => ({ name, type: "Assembly::AssemblyLink",
  properties: property("LinkedObject", "App::PropertyXLink", xlink(file, target)) + property("Rigid", "App::PropertyBool", '<Bool value="true"/>') + placement });
function document(extra: ObjectXml[] = [], rootExtra = "") {
  const objects: ObjectXml[] = [{ name: "Assembly", type: "Assembly::AssemblyObject", properties: group(extra.map(object => object.name)) + placement + rootExtra }, ...extra];
  return `<Document><Objects>${objects.map(object => `<Object name="${object.name}" type="${object.type}"/>`).join("")}</Objects><ObjectData>${objects.map(object =>
    `<Object name="${object.name}"><Properties>${string("Label", object.name)}${object.properties}</Properties></Object>`).join("")}</ObjectData></Document>`;
}
const leaf = () => document([], string("Note", "synthetic leaf"));
const joint = (first = "Instance", second = "Assembly"): ObjectXml => ({ name: "Joint", type: "App::FeaturePython", properties:
  property("Proxy", "App::PropertyPythonObject", safeProxy())
  + property("Reference1", "App::PropertyXLinkSub", xlink("", first, '<Sub value="Nested.Face"/><Sub value="Full.Sub.Path"/>'), ' group="Joint metadata"')
  + property("Reference2", "App::PropertyXLinkSub", xlink("", second, '<Sub value="Origin.Axis"/>')) });
function exactDocument(objects: ObjectXml[]) {
  return `<Document><Objects>${objects.map(object => `<Object name="${object.name}" type="${object.type}"/>`).join("")}</Objects><ObjectData>${objects.map(object =>
    `<Object name="${object.name}"><Properties>${string("Label", object.name)}${object.properties}</Properties></Object>`).join("")}</ObjectData></Document>`;
}
const assembly = (children: string[]): ObjectXml => ({ name: "Assembly", type: "Assembly::AssemblyObject", properties: group(children) + placement });
const derived = (name: string, file: string, target: string): ObjectXml => ({ name, type: "App::Link", properties: property("LinkedObject", "App::PropertyXLink", xlink(file, target)) + placement });
function staleHost(extra: ObjectXml[] = [], rootChildren = ["Selected"], ownerChildren = ["OldCopy"]) {
  return exactDocument([assembly([...rootChildren, ...extra.map(object => object.name)]),
    { ...instance("Child.FCStd", "Selected"), properties: instance("Child.FCStd", "Selected").properties + group(ownerChildren) },
    derived("OldCopy", "Child.FCStd", "AbsentSourceMember"), ...extra]);
}
let root: string;
const roots: string[] = [];
function workspace() { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "saved-assembly-baseline-"))); roots.push(dir); return dir; }
function archive(rel: string, xml = leaf()) {
  const filename = path.join(root, rel); fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, zipSync({ "Document.xml": strToU8(xml), "opaque.payload": new Uint8Array([5, 12, 255]) }));
  return filename;
}
const hash = (filename: string) => fcstdFingerprint(fs.readFileSync(filename));
beforeEach(() => { root = workspace(); });
afterEach(() => { vi.restoreAllMocks(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("opening-before saved assembly baseline", () => {
  it("freezes the full explicit transitive graph, deduplicates cycles, and never discovers files or writes", async () => {
    const host = archive("Host.FCStd", document([instance()]));
    const child = archive("Child.FCStd", document([instance("nested/Leaf.FCStd"), { name: "Back", type: "App::Link", properties: property("LinkedObject", "App::PropertyXLink", xlink("Host.FCStd")) }]));
    const last = archive("nested/Leaf.FCStd"); archive("Unrelated.FCStd", "not XML");
    const before = [host, child, last].map(hash);
    const discovery = vi.spyOn(fs, "readdirSync"), asyncDiscovery = vi.spyOn(fs.promises, "readdir"), write = vi.spyOn(fs, "writeFileSync");
    const result = await captureSavedAssemblyBaseline(root, "Host.FCStd");
    expect(result).toMatchObject({ version: 1, root, hostRel: "Host.FCStd", complete: true, scope: "saved_xml_before_native_open", actualFrames: "not_available_from_saved_xml" });
    expect(result.files.map(file => file.rel)).toEqual(["Host.FCStd", "Child.FCStd", "nested/Leaf.FCStd"]);
    expect(result.files.map(file => file.sha256)).toEqual(before);
    for (const file of result.files) expect(file).toMatchObject({ bytes: fs.statSync(path.join(root, file.rel)).size, stat: { size: file.bytes, dev: expect.any(Number), ino: expect.any(Number), mtimeMs: expect.any(Number), ctimeMs: expect.any(Number) } });
    expect(result.links).toHaveLength(3);
    expect(result.links[2]).toMatchObject({ sourceRel: "Child.FCStd", objectName: "Back", targetRel: "Host.FCStd", targetObjectName: "Assembly" });
    expect(discovery).not.toHaveBeenCalled(); expect(asyncDiscovery).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect([host, child, last].map(hash)).toEqual(before);
  });

  it("preserves original full Joint structure, group, local placement, Rigid and every user attribute", async () => {
    const user = property("UserNote", "App::PropertyString", '<!--keep annotation--><String value="generic &amp; independent"/><![CDATA[opaque user data]]>', ' group="User attributes" status="dynamic"');
    archive("Host.FCStd", document([instance(), { name: "Joints", type: "Assembly::JointGroup", properties: group(["Joint"]) }, joint()], user)); archive("Child.FCStd");
    const result = await captureSavedAssemblyBaseline(root, "Host.FCStd"), objects = result.files[0].objects;
    expect(objects.find(object => object.name === "Assembly")).toMatchObject({ typeId: "Assembly::AssemblyObject", children: ["Instance", "Joints", "Joint"], properties: { UserNote: { rawXml: user } } });
    expect(objects.find(object => object.name === "Instance")).toMatchObject({ rigid: true, placement: { x: 2.5, y: 0, z: -1, q0: 0, q1: 0, q2: 0, q3: 1 }, properties: { Placement: { rawXml: placement } } });
    const savedJoint = objects.find(object => object.name === "Joint")!;
    expect(savedJoint.joint?.kind).toBe("Joint");
    expect(savedJoint.joint?.kind === "Joint" && savedJoint.joint.reference1RawXml).toBe(property("Reference1", "App::PropertyXLinkSub", xlink("", "Instance", '<Sub value="Nested.Face"/><Sub value="Full.Sub.Path"/>'), ' group="Joint metadata"'));
    expect(savedJoint.joint?.proxyRawXml).toContain('module="JointObject" class="Joint"');
    expect(result.links.filter(link => link.objectName === "Joint").map(link => [link.targetRel, link.targetObjectName])).toEqual([["Host.FCStd", "Instance"], ["Host.FCStd", "Assembly"]]);
    // A saved subpath is retained, never asserted to be an actual connection frame.
    expect(result.actualFrames).toBe("not_available_from_saved_xml");
  });

  it("follows non-Assembly App::Link dependencies and contained parent-relative paths", async () => {
    archive("nested/Host.FCStd", document([{ name: "GenericLink", type: "App::Link", properties: property("LinkedObject", "App::PropertyXLink", xlink("../Leaf.FCStd")) }]));
    archive("Leaf.FCStd");
    const result = await captureSavedAssemblyBaseline(root, path.join(root, "nested/Host.FCStd"));
    expect(result.files.map(file => file.rel)).toEqual(["nested/Host.FCStd", "Leaf.FCStd"]);
    expect(result.links[0]).toMatchObject({ targetRel: "Leaf.FCStd", savedFile: "../Leaf.FCStd" });
  });

  it("permits a non-assembly leaf and internal archive members without treating them as CAD dependencies", async () => {
    archive("Host.FCStd", document([instance("Leaf.FCStd", "Instance", "Body")]));
    archive("Leaf.FCStd", '<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties>'
      + property("Shape", "Part::PropertyPartShape", '<Part file="PartShape.brp"/>') + '</Properties></Object></ObjectData></Document>');
    const result = await captureSavedAssemblyBaseline(root, "Host.FCStd");
    expect(result.files[1].objects[0]).toMatchObject({ name: "Body", typeId: "PartDesign::Body" });
    expect(result.links).toHaveLength(1);
  });

  it("treats known basename-only Link placement/scale payloads as internal archive members", async () => {
    archive("Host.FCStd", document([], property("PlacementList", "App::PropertyPlacementList", '<PlacementList file="PlacementList"/>')
      + property("ScaleList", "App::PropertyVectorList", '<VectorList file="ScaleList"/>')));
    const baseline = await captureSavedAssemblyBaseline(root, "Host.FCStd");
    expect(baseline.files).toHaveLength(1); expect(baseline.links).toHaveLength(0);
    archive("Host.FCStd", document([], property("PlacementList", "App::PropertyPlacementList", '<PlacementList file="outside/PlacementList"/>')));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unsupported_external_reference" });
  });

  it("allows only the proved-empty Native App::Link ColoredElements hidden reference", async () => {
    const empty = property("ColoredElements", "App::PropertyLinkSubHidden", '<LinkSub value="" count="0">\n</LinkSub>');
    archive("Host.FCStd", document([{ ...derived("Copy", "Child.FCStd", "Assembly"), properties: derived("Copy", "Child.FCStd", "Assembly").properties + empty }])); archive("Child.FCStd");
    expect((await captureSavedAssemblyBaseline(root, "Host.FCStd")).files[0].objects.find(object => object.name === "Copy")?.properties.ColoredElements.rawXml).toBe(empty);
    archive("Host.FCStd", document([{ ...derived("Copy", "Child.FCStd", "Assembly"), properties: derived("Copy", "Child.FCStd", "Assembly").properties
      + property("ColoredElements", "App::PropertyLinkSubHidden", '<LinkSub value="Assembly" count="1"><Sub value="Copy.Face1"/></LinkSub>') }]));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unsupported_link_property_type" });
  });

  it("accounts for the Native App::Link optional null copy-on-change XLink without hiding ordinary empty references", async () => {
    const optional = property("LinkCopyOnChangeSource", "App::PropertyXLink", '<XLink file="" stamp="" name=""/>');
    const object = derived("Copy", "Child.FCStd", "Assembly");
    archive("Host.FCStd", document([{ ...object, properties: object.properties + optional }])); archive("Child.FCStd");
    const baseline = await captureSavedAssemblyBaseline(root, "Host.FCStd");
    expect(baseline.links).toHaveLength(1); expect(baseline.files[0].objects.find(object => object.name === "Copy")?.properties.LinkCopyOnChangeSource.rawXml).toBe(optional);
    archive("Host.FCStd", document([{ ...object, properties: object.properties + optional.replace('name="LinkCopyOnChangeSource"', 'name="UnknownReference"') }]));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unresolved_xlink_identity" });
  });

  it("rejects file-bearing unknown serializers outside ObjectData instead of missing a dependency", async () => {
    archive("Host.FCStd", document().replace('</Document>', '<UnknownExternal file="Child.FCStd"/></Document>'));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unsupported_external_reference" });
  });

  it("captures standard document-level metadata without dropping it or mistaking it for object properties", async () => {
    const metadata = string("Comment", "independent user note") + property("Meta", "App::PropertyMap", '<Map count="0"/>')
      + property("Uid", "App::PropertyUUID", '<Uuid value="00000000-0000-4000-a000-000000000000"/>');
    archive("Host.FCStd", document().replace('<Document>', '<Document><Properties>' + metadata + '</Properties>'));
    const baseline = await captureSavedAssemblyBaseline(root, "Host.FCStd");
    expect(baseline.files[0].documentProperties.Comment.rawXml).toBe(string("Comment", "independent user note"));
    archive("Host.FCStd", document().replace('<Document>', '<Document><Properties>' + property("Proxy", "App::PropertyPythonObject", '<Python module="UserModule" class="Custom"/>') + '</Properties>'));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unknown_document_property" });
  });

  it.each(["Missing.FCStd", "/outside/Child.FCStd", "C:\\outside\\Child.FCStd", "file:///outside/Child.FCStd", "../Child.FCStd", "Child.step"])("refuses missing/unsafe dependency without any partial complete DTO: %s", async file => {
    const host = archive("Host.FCStd", document([instance(file)])), before = hash(host);
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required" });
    expect(hash(host)).toBe(before);
  });

  it("rejects symlink host, dependency and workspace spellings", async () => {
    archive("Host.FCStd", document([instance()])); const target = archive("Source.FCStd");
    fs.symlinkSync(target, path.join(root, "Child.FCStd")); fs.symlinkSync(path.join(root, "Host.FCStd"), path.join(root, "Alias.FCStd"));
    await expect(captureSavedAssemblyBaseline(root, "Alias.FCStd")).rejects.toMatchObject({ code: "manual_required" });
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required" });
    const outer = workspace(); fs.symlinkSync(root, path.join(outer, "Workspace"), "dir");
    await expect(captureSavedAssemblyBaseline(path.join(outer, "Workspace"), "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "symlink_workspace" });
  });

  it.each(["", "Removed"])("refuses an already disconnected Joint endpoint %s", async name => {
    archive("Host.FCStd", document([instance(), joint(name)])); archive("Child.FCStd");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required" });
  });

  it("rejects target object identity missing from a successfully read dependency", async () => {
    archive("Host.FCStd", document([instance("Child.FCStd", "Instance", "Removed")])); archive("Child.FCStd");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "missing_link_target_object" });
  });

  it.each([
    property("Unknown", "App::PropertyXLinkSubList", '<XLinkSubList count="1">' + xlink("Child.FCStd") + "</XLinkSubList>"),
    property("Unknown", "App::PropertyXLink", '<XLink name="Assembly"/>'),
    property("Unknown", "App::PropertyXLink", '<Wrapper>' + xlink("Child.FCStd") + "</Wrapper>"),
    property("Unknown", "App::PropertyLink", '<Link file="Child.FCStd" value="Assembly"/>'),
    property("Unknown", "App::PropertyString", '<UnknownExternal file="Child.FCStd"/>'),
    property("Unknown", "App::PropertyFile", '<String value="Child.FCStd"/>'),
    property("Unknown", "App::PropertyString", xlink("Child.FCStd")),
  ])("fails closed on unknown reference serialization [case %#]", async serialized => {
    archive("Host.FCStd", document([], serialized)); archive("Child.FCStd");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required" });
  });

  it("rejects unknown Rigid and incomplete Joint schema rather than inventing defaults", async () => {
    archive("Host.FCStd", document([instance()]).replace('<Bool value="true"/>', '<Bool value="unknown"/>')); archive("Child.FCStd");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unknown_rigid_state" });
    archive("Host.FCStd", document([instance(), joint()]).replace('module="JointObject"', 'module="UnknownProxy"'));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unknown_python_proxy" });
  });

  it.each(["App::FeaturePython", "PartDesign::FeaturePython"])("refuses an unaudited executable %s before any Native open", async type => {
    archive("Host.FCStd", document([{ name: "CustomFeature", type, properties: property("Proxy", "App::PropertyPythonObject", '<Python module="UserModule" class="CustomFeature"/>') }]));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unknown_python_proxy" });
  });

  it("rejects a Python Proxy on a non-FeaturePython object and any secondary Python object property", async () => {
    archive("Host.FCStd", document([{ name: "Script", type: "App::Part", properties: property("Proxy", "App::PropertyPythonObject", '<Python module="UserModule" class="CustomFeature"/>') }]));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unknown_python_proxy" });
    archive("Host.FCStd", document([], property("UserPython", "App::PropertyPythonObject", '<Python module="UserModule" class="CustomData"/>')));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unknown_python_property" });
  });

  it("does not let an inline innocent type hide a native executable declaration", async () => {
    archive("Host.FCStd", document([{ name: "Hidden", type: "App::FeaturePython", properties: "" }])
      .replace('<Object name="Hidden"><Properties>', '<Object name="Hidden" type="App::Part"><Properties>'));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "conflicting_object_type" });
  });

  it("retains a reviewed GroundedJoint with its explicit existing local ObjectToGround", async () => {
    // Current Native writes LinkGlobal with a single local <Link>, not XLink.
    const target = property("ObjectToGround", "App::PropertyLinkGlobal", '\n                    <Link value="Assembly"/>\n                ', ' group="Grounded Joint"');
    const proxy = property("Proxy", "App::PropertyPythonObject", safeProxy("GroundedJoint"));
    archive("Host.FCStd", document([{ name: "Ground", type: "App::FeaturePython", properties: proxy + target + string("UserNote", "retain grounding metadata") }]));
    const result = await captureSavedAssemblyBaseline(root, "Host.FCStd");
    expect(result.files[0].objects.find(object => object.name === "Ground")?.joint).toEqual({ kind: "GroundedJoint", proxyRawXml: proxy, objectToGroundRawXml: target });
    expect(result.files[0].objects.find(object => object.name === "Ground")?.properties.ObjectToGround).toEqual({ type: "App::PropertyLinkGlobal", rawXml: target });
  });

  it("refuses legacy GroundedJoint PropertyLink until it is migrated and saved separately", async () => {
    archive("Host.FCStd", document([{ name: "Ground", type: "App::FeaturePython", properties:
      property("Proxy", "App::PropertyPythonObject", safeProxy("GroundedJoint"))
      + property("ObjectToGround", "App::PropertyLink", '<Link value="Assembly"/>') }]));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "legacy_grounded_target_requires_migration" });
  });

  it.each(["ObjectToGround", "OtherGlobal"])("does not allow generic PropertyLinkGlobal outside the reviewed grounded field: %s", async name => {
    archive("Host.FCStd", document([], property(name, "App::PropertyLinkGlobal", '<Link value="Assembly"/>')));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unsupported_link_property_type" });
  });

  it("does not allow an additional PropertyLinkGlobal even on a reviewed GroundedJoint", async () => {
    archive("Host.FCStd", document([{ name: "Ground", type: "App::FeaturePython", properties:
      property("Proxy", "App::PropertyPythonObject", safeProxy("GroundedJoint"))
      + property("ObjectToGround", "App::PropertyLinkGlobal", '<Link value="Assembly"/>')
      + property("OtherGlobal", "App::PropertyLinkGlobal", '<Link value="Assembly"/>') }]));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unsupported_link_property_type" });
  });

  it.each([
    property("ObjectToGround", "App::PropertyLinkGlobal", '<Link value=""/>'),
    property("ObjectToGround", "App::PropertyLinkGlobal", '<Link value="Removed"/>'),
    property("ObjectToGround", "App::PropertyLinkGlobal", '<Link value="Assembly"/><Link value="Assembly"/>'),
    property("ObjectToGround", "App::PropertyXLink", xlink("Child.FCStd")),
    "",
  ])("refuses a GroundedJoint without a proven local target [case %#]", async target => {
    archive("Child.FCStd");
    archive("Host.FCStd", document([{ name: "Ground", type: "App::FeaturePython", properties: property("Proxy", "App::PropertyPythonObject", safeProxy("GroundedJoint")) + target }]));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required" });
  });

  it("rejects malformed dependency XML instead of silently truncating the graph", async () => {
    archive("Host.FCStd", document([instance()])); archive("Child.FCStd", "<Document><Bad></Document>");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "invalid_document_xml" });
  });

  it("bounds file count, compressed total, XML total and full DTO", async () => {
    const host = archive("Host.FCStd", document([instance()])); archive("Child.FCStd");
    expect(SAVED_ASSEMBLY_BASELINE_LIMITS).toEqual({ files: 100, bytes: 64 * 1024 * 1024, xmlBytes: 32 * 1024 * 1024 });
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { maxFiles: 1 })).rejects.toMatchObject({ code: "resource_limit" });
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { maxBytes: fs.statSync(host).size - 1 })).rejects.toMatchObject({ code: "resource_limit" });
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { maxXmlBytes: 10 })).rejects.toMatchObject({ code: "resource_limit" });
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { budget: new CadObjectInfoBudget(undefined, { bytes: 100 }) })).rejects.toMatchObject({ code: "resource_limit" });
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { maxFiles: 101 })).rejects.toThrow(/不能提高/);
  });

  it("invalidates the snapshot on a host change during parsing", async () => {
    const host = archive("Host.FCStd", document([instance()])); archive("Child.FCStd");
    const pending = captureSavedAssemblyBaseline(root, "Host.FCStd"); fs.appendFileSync(host, "changed");
    await expect(pending).rejects.toMatchObject({ code: "source_changed" });
  });

  it("rechecks every dependency and refuses changes, replacement or deletion before publication", async () => {
    archive("Host.FCStd", document([instance()])); const child = archive("Child.FCStd");
    const baseline = await captureSavedAssemblyBaseline(root, "Host.FCStd"); await verifySavedAssemblyBaseline(baseline);
    fs.appendFileSync(child, "changed");
    await expect(verifySavedAssemblyBaseline(baseline)).rejects.toMatchObject({ code: "source_changed" });
    fs.unlinkSync(child);
    await expect(verifySavedAssemblyBaseline(baseline)).rejects.toMatchObject({ code: "source_changed" });
  });

  it("honors cancellation and the shared cooperative deadline", async () => {
    archive("Host.FCStd"); const controller = new AbortController(); controller.abort();
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    let now = 0; const budget = new CadObjectInfoBudget(undefined, { durationMs: 1, now: () => now }); now = 1;
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { budget })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("explicitly selected stale derived copy candidates, never deletion authority", () => {
  it("remains strict by default and only marks the selected owner's unreferenced missing App::Link copy", async () => {
    archive("Host.FCStd", staleHost()); archive("Child.FCStd");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "missing_link_target_object" });
    const baseline = await captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { selectedHostObjects: ["Selected"] });
    expect(baseline.staleDerivedLinks).toEqual([{ sourceRel: "Host.FCStd", objectName: "OldCopy", ownerObjectName: "Selected",
      targetRel: "Child.FCStd", targetObjectName: "AbsentSourceMember", sourceAssemblyRel: "Child.FCStd", sourceAssemblyObjectName: "Assembly",
      selectedHostObjects: ["Selected"], proof: "selected_owned_app_link_absent_from_source_group" }]);
    expect(baseline.files[0].objects.some(object => object.name === "OldCopy")).toBe(true);
    expect(baseline.complete).toBe(true);
  });

  it("proves a three-layer copied owner chain and the selected dependency definition without broadening to other branches", async () => {
    archive("Leaf.FCStd", exactDocument([assembly(["Keep"]), { name: "Keep", type: "App::Part", properties: placement }]));
    archive("Middle.FCStd", exactDocument([assembly(["Nested"]),
      { ...instance("Leaf.FCStd", "Nested"), properties: instance("Leaf.FCStd", "Nested").properties + group(["MiddleKeep", "MiddleOld"]) },
      derived("MiddleKeep", "Leaf.FCStd", "Keep"), derived("MiddleOld", "Leaf.FCStd", "AbsentSourceMember")]));
    archive("Host.FCStd", exactDocument([assembly(["Selected"]),
      { ...instance("Middle.FCStd", "Selected"), properties: instance("Middle.FCStd", "Selected").properties + group(["CopiedNested"]) },
      { ...instance("Middle.FCStd", "CopiedNested", "Nested"), properties: instance("Middle.FCStd", "CopiedNested", "Nested").properties + group(["HostKeep", "HostOld"]) },
      derived("HostKeep", "Leaf.FCStd", "Keep"), derived("HostOld", "Leaf.FCStd", "AbsentSourceMember")]));
    const baseline = await captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { selectedHostObjects: ["Selected"] });
    expect(baseline.staleDerivedLinks.map(link => [link.sourceRel, link.objectName, link.ownerObjectName, link.sourceAssemblyRel, link.selectedHostObjects])).toEqual([
      ["Host.FCStd", "HostOld", "CopiedNested", "Leaf.FCStd", ["Selected"]],
      ["Middle.FCStd", "MiddleOld", "Nested", "Leaf.FCStd", ["Selected"]],
    ]);
    expect(baseline.files.map(file => file.rel)).toEqual(["Host.FCStd", "Middle.FCStd", "Leaf.FCStd"]);
  });

  it("does not authorize a second stale host branch merely because it shares the selected source", async () => {
    const other = { ...instance("Child.FCStd", "Other"), properties: instance("Child.FCStd", "Other").properties + group(["OtherOld"]) };
    archive("Child.FCStd");
    archive("Host.FCStd", exactDocument([assembly(["Selected", "Other"]),
      { ...instance("Child.FCStd", "Selected"), properties: instance("Child.FCStd", "Selected").properties + group(["OldCopy"]) },
      derived("OldCopy", "Child.FCStd", "AbsentSourceMember"), other, derived("OtherOld", "Child.FCStd", "AbsentSourceMember")]));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { selectedHostObjects: ["Selected"] })).rejects.toMatchObject({ code: "manual_required", reason: "missing_link_target_object" });
    const baseline = await captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { selectedHostObjects: ["Selected", "Other"] });
    expect(baseline.staleDerivedLinks).toHaveLength(2);
  });

  it("rejects an old copy with multiple Group owners", async () => {
    archive("Host.FCStd", staleHost([], ["Selected", "OldCopy"])); archive("Child.FCStd");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { selectedHostObjects: ["Selected"] })).rejects.toMatchObject({ code: "manual_required", reason: "missing_link_target_object" });
  });

  it.each([
    { name: "User", type: "App::Part", properties: property("Reference", "App::PropertyLink", '<Link value="OldCopy"/>') },
    { ...joint("OldCopy", "Assembly") },
    { ...joint("Selected", "Assembly"), properties: joint("Selected", "Assembly").properties.replace(xlink("", "Selected", '<Sub value="Nested.Face"/><Sub value="Full.Sub.Path"/>'), xlink("", "Selected", '<Sub value="OldCopy.Face1"/>')) },
    { ...joint("Selected", "Assembly"), properties: joint("Selected", "Assembly").properties.replace(xlink("", "Selected", '<Sub value="Nested.Face"/><Sub value="Full.Sub.Path"/>'), xlink("", "Selected", '<Sub value="AbsentSourceMember.Face1"/>')) },
    { name: "User", type: "App::Part", properties: property("Reference", "App::PropertyLinkSub", '<LinkSub value="Selected" count="1"><Sub value="OldCopy.Face1"/></LinkSub>') },
    { ...joint("Selected", "Assembly"), properties: joint("Selected", "Assembly").properties.replace(xlink("", "Selected", '<Sub value="Nested.Face"/><Sub value="Full.Sub.Path"/>'), xlink("Child.FCStd", "Assembly", '<Sub value="AbsentSourceMember.Face1"/>')) },
  ] satisfies ObjectXml[])("refuses a non-owner direct or full-subpath reference, including Joint endpoints [case %#]", async reference => {
    archive("Host.FCStd", staleHost([reference])); archive("Child.FCStd");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { selectedHostObjects: ["Selected"] })).rejects.toMatchObject({ code: "manual_required" });
  });

  it("does not guess through unknown saved subpath syntax", async () => {
    const reference = { name: "User", type: "App::Part", properties: property("Reference", "App::PropertyLinkSub", '<LinkSub value="Selected"><Sub value="OldCopy[1].Face1"/></LinkSub>') };
    archive("Host.FCStd", staleHost([reference])); archive("Child.FCStd");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { selectedHostObjects: ["Selected"] })).rejects.toMatchObject({ code: "manual_required", reason: "unknown_subpath_for_stale_proof" });
  });

  it.each(["Unselected", "OldCopy"])("does not infer selection authority from arbitrary object %s", async name => {
    archive("Host.FCStd", staleHost()); archive("Child.FCStd");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { selectedHostObjects: [name] })).rejects.toMatchObject({ code: "manual_required", reason: "invalid_selected_host_objects" });
  });

  it("never permits a missing dependency file even for selected derived copies", async () => {
    archive("Host.FCStd", staleHost());
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { selectedHostObjects: ["Selected"] })).rejects.toMatchObject({ code: "manual_required" });
  });

  it("does not treat an arbitrary missing XLink property as a derived copy", async () => {
    archive("Host.FCStd", staleHost().replace('name="OldCopy" type="App::Link"', 'name="OldCopy" type="App::Part"')); archive("Child.FCStd");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { selectedHostObjects: ["Selected"] })).rejects.toMatchObject({ code: "manual_required", reason: "missing_link_target_object" });
  });

  it("requires the actual single XLink property type for both a copy and its AssemblyLink owner", async () => {
    archive("Child.FCStd");
    const raw = staleHost(), oldLink = property("LinkedObject", "App::PropertyXLink", xlink("Child.FCStd", "AbsentSourceMember"));
    archive("Host.FCStd", raw.replace(oldLink, oldLink.replace('type="App::PropertyXLink"', 'type="App::PropertyXLinkSub"')));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { selectedHostObjects: ["Selected"] })).rejects.toMatchObject({ code: "manual_required", reason: "missing_link_target_object" });
    const ownerLink = property("LinkedObject", "App::PropertyXLink", xlink("Child.FCStd", "Assembly"));
    archive("Host.FCStd", raw.replace(ownerLink, ownerLink.replace('type="App::PropertyXLink"', 'type="App::PropertyXLinkSub"')));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd", undefined, { selectedHostObjects: ["Selected"] })).rejects.toMatchObject({ code: "manual_required", reason: "unproven_derived_owner_source" });
  });
});

describe("saved executable surfaces are rejected before Native open", () => {
  it.each([
    '<Python file="OpaqueProxy" module="JointObject" class="Joint"/>',
    '<Python value="e30=" encoded="yes" module="JointObject" class="Joint"/>',
    '<Python value="null" module="JointObject" class="Joint"/>',
    '<Python value="bnVsbA==" encoded="yes" module="JointObject" class="Joint" json="yes"/>',
    '<Python value="bnVsbA==" encoded="yes" module="JointObject" class="Joint" object="yes"/>',
    '<Wrapper>' + safeProxy() + '</Wrapper>',
    safeProxy() + safeProxy(),
  ])("does not certify alternate Joint state from module/class metadata alone [case %#]", async serialized => {
    archive("Host.FCStd", document([instance(), { ...joint(), properties: joint().properties.replace(safeProxy(), serialized) }])); archive("Child.FCStd");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required" });
  });

  it("retains the real null Joint state and its ordinary empty suppressible Python extension", async () => {
    const empty = '<Extensions Count="1"><Extension type="App::SuppressibleExtensionPython" name="SuppressibleExtensionPython">\n</Extension></Extensions>';
    archive("Host.FCStd", document([instance(), joint()]).replace('<Object name="Joint"><Properties>', '<Object name="Joint" Extensions="True">' + empty + '<Properties>'));
    archive("Child.FCStd");
    expect((await captureSavedAssemblyBaseline(root, "Host.FCStd")).files[0].objects.find(object => object.name === "Joint")?.joint?.kind).toBe("Joint");
  });

  it.each([
    '<Extensions Count="1"><Extension type="App::GroupExtensionPython" name="UserExtension"></Extension></Extensions>',
    '<Extensions Count="1"><Extension type="App::SuppressibleExtensionPython" name="SuppressibleExtensionPython"><State value="unreviewed"/></Extension></Extensions>',
    '<Extensions Count="0"><Extension type="App::SuppressibleExtensionPython" name="SuppressibleExtensionPython"></Extension></Extensions>',
  ])("rejects unaudited or nonempty Python extension state [case %#]", async serialized => {
    archive("Host.FCStd", document([instance(), joint()]).replace('<Object name="Joint"><Properties>', '<Object name="Joint" Extensions="True">' + serialized + '<Properties>')); archive("Child.FCStd");
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required" });
  });

  it("does not allow a suppressible Python extension on an unreviewed ordinary object", async () => {
    archive("Host.FCStd", document().replace('<Object name="Assembly"><Properties>', '<Object name="Assembly" Extensions="True"><Extensions Count="1"><Extension type="App::SuppressibleExtensionPython" name="SuppressibleExtensionPython"></Extension></Extensions><Properties>'));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unreviewed_python_extension" });
  });

  it("rejects non-FeaturePython scripted object types and stray Python serialization", async () => {
    archive("Host.FCStd", document([{ name: "Script", type: "Part::Part2DObjectPython", properties: "" }]));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unknown_python_proxy" });
    archive("Host.FCStd", document([], property("Plain", "App::PropertyString", safeProxy())));
    await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unaccounted_python_serialization" });
  });

  it("retains a known empty ExpressionEngine but rejects active or unknown expression serialization", async () => {
    const empty = property("ExpressionEngine", "App::PropertyExpressionEngine", '<ExpressionEngine count="0">\n</ExpressionEngine>');
    archive("Host.FCStd", document([], empty));
    expect((await captureSavedAssemblyBaseline(root, "Host.FCStd")).files[0].objects[0].properties.ExpressionEngine.rawXml).toBe(empty);
    for (const content of ['<ExpressionEngine count="1"><Expression path="Placement" expression="2 + 3"/></ExpressionEngine>',
      '<ExpressionEngine count="0" xlink="1"/>', '<ExpressionEngine count="0"><Expression path="Placement" expression="2 + 3"/></ExpressionEngine>']) {
      archive("Host.FCStd", document([], property("ExpressionEngine", "App::PropertyExpressionEngine", content)));
      await expect(captureSavedAssemblyBaseline(root, "Host.FCStd")).rejects.toMatchObject({ code: "manual_required", reason: "unreviewed_expression_engine" });
    }
  });
});
