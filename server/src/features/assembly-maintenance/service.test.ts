import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CadObjectInfoBudget } from "../cad-object-info/budget.js";
import { ASSEMBLY_INSPECTION_RESPONSE_BYTES, inspectSavedAssembly } from "./service.js";
import { createAssemblyMaintenanceRoutes } from "./routes.js";

// Independent, metadata-only serialization: no copied engineering files or geometry.
const property = (name: string, type: string, content: string) => `<Property name="${name}" type="${type}">${content}</Property>`;
function document(links: Array<{ name: string; file?: string; rigid?: string }> = [{ name: "Sub", file: "Child.FCStd", rigid: "true" }], joint = "") {
  const objects = links.map(link => `<Object name="${link.name}" type="Assembly::AssemblyLink"/>`).join("");
  const data = links.map(link => `<Object name="${link.name}"><Properties>${property("Label", "App::PropertyString", `<String value="${link.name}"/>`)}
    ${property("LinkedObject", "App::PropertyXLink", `<XLink ${link.file === undefined ? "" : `file="${link.file}"`} name="Assembly"/>`)}
    ${link.rigid === undefined ? "" : property("Rigid", "App::PropertyBool", `<Bool value="${link.rigid}"/>`)}</Properties></Object>`).join("");
  return `<Document><Objects><Object name="Assembly" type="Assembly::AssemblyObject"/>${objects}${joint ? '<Object name="Joint" type="App::FeaturePython"/>' : ""}</Objects>
    <ObjectData><Object name="Assembly"><Properties/></Object>${data}${joint}</ObjectData></Document>`;
}
const emptyJoint = `<Object name="Joint"><Properties>${property("Proxy", "App::PropertyPythonObject", '<Python module="JointObject" class="Joint"/>')}
  ${property("Reference1", "App::PropertyXLinkSub", '<XLink file="" name=""/>')}
  ${property("Reference2", "App::PropertyXLinkSub", '<XLink file="" name="Removed"/>')}</Properties></Object>`;
let root: string; const roots: string[] = [];
function workspace() { const value = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "assembly-inspection-"))); roots.push(value); return value; }
function archive(rel = "Host.FCStd", xml = document()) {
  const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zipSync({ "Document.xml": strToU8(xml), "opaque.bin": new Uint8Array([13, 7, 2]) })); return file;
}
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const post = (body: unknown, routes = createAssemblyMaintenanceRoutes()) => routes.request("/inspect", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => { root = workspace(); });
afterEach(() => { vi.restoreAllMocks(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("saved assembly read-only inspection", () => {
  it("reports rigid and flexible intent without diagnosing either as an error or claiming synchronization", async () => {
    const file = archive("Host.FCStd", document([{ name: "Rigid", file: "Child.FCStd", rigid: "true" }, { name: "Flexible", file: "Child.FCStd", rigid: "false" }]));
    // A present path is intentionally not opened or parsed, and may even be non-CAD bytes.
    const target = path.join(root, "Child.FCStd"); fs.writeFileSync(target, "not a model");
    const sourceHash = hash(file), targetHash = hash(target);
    const open = vi.spyOn(fs, "openSync"), read = vi.spyOn(fs, "readFileSync"), discovery = vi.spyOn(fs, "readdirSync");
    const result = await inspectSavedAssembly(root, "Host.FCStd");
    expect(result).toMatchObject({ scope: "current_saved_file", synchronization: "not_checked", source: { sha256: sourceHash },
      update: { available: false, reason_code: "requires_verified_preview" }, summary: { assembly_link_count: 2, joint_issue_count: 0, missing_path_count: 0 } });
    expect(result.links.map(link => [link.rigid, link.path_status])).toEqual([[true, "present"], [false, "present"]]);
    expect(read.mock.calls.some(call => String(call[0]) === target)).toBe(false);
    expect(open.mock.calls.some(call => String(call[0]) === target)).toBe(false);
    expect(discovery).not.toHaveBeenCalled();
    vi.restoreAllMocks(); expect(hash(file)).toBe(sourceHash); expect(hash(target)).toBe(targetHash);
    expect(fs.readdirSync(root).sort()).toEqual(["Child.FCStd", "Host.FCStd"]); expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
  });
  it("reports only proven saved joint disconnections and missing relative paths", async () => {
    archive("Host.FCStd", document([{ name: "Sub", file: "missing.FCStd", rigid: "false" }], emptyJoint));
    const result = await inspectSavedAssembly(root, "Host.FCStd");
    expect(result.summary).toMatchObject({ joint_issue_count: 2, missing_path_count: 1 });
    expect(result.joint_issues.map(issue => issue.reason)).toEqual(["empty_reference", "missing_local_object"]);
    expect(result.links[0]).toMatchObject({ target_rel: "missing.FCStd", path_status: "missing", rigid: false });
  });
  it("preserves malformed/missing Rigid and missing file attributes as unknown, distinguishing explicit local links", async () => {
    archive("Host.FCStd", document([{ name: "Local", file: "", rigid: "bad" }, { name: "Unknown" }]));
    const result = await inspectSavedAssembly(root, "Host.FCStd");
    expect(result.links.map(link => [link.rigid, link.path_status])).toEqual([[null, "local"], [null, "unknown"]]);
  });
  it("does not follow outside, absolute Windows/URI or symlink targets, but permits contained parent-relative links", async () => {
    const outside = workspace(); fs.writeFileSync(path.join(outside, "External.FCStd"), "opaque");
    fs.symlinkSync(outside, path.join(root, "Alias"), "dir");
    fs.writeFileSync(path.join(root, "Child.FCStd"), "opaque");
    archive("sub/Host.FCStd", document([
      { name: "Contained", file: "../Child.FCStd" }, { name: "Escape", file: "../../External.FCStd" },
      { name: "Windows", file: "C:\\private\\External.FCStd" }, { name: "Absolute", file: "/unrelated/External.FCStd" },
      { name: "Uri", file: "file:///unrelated/External.FCStd" }, { name: "Symlink", file: "../Alias/External.FCStd" },
    ]));
    const result = await inspectSavedAssembly(root, "sub/Host.FCStd");
    expect(result.links.map(link => link.path_status)).toEqual(["present", "outside_workspace", "outside_workspace", "outside_workspace", "outside_workspace", "unknown"]);
    expect(result.summary.unknown_path_count).toBe(5);
  });
  it("rejects a selected source outside the workspace or through a symlink", async () => {
    const outside = workspace(), external = path.join(outside, "External.FCStd"); fs.writeFileSync(external, "opaque");
    fs.symlinkSync(external, path.join(root, "Alias.FCStd"));
    await expect(inspectSavedAssembly(root, external)).rejects.toMatchObject({ code: "path_escape" });
    await expect(inspectSavedAssembly(root, "Alias.FCStd")).rejects.toMatchObject({ code: "path_escape" });
  });
  it("accepts an explicit absolute source inside the workspace without leaking that absolute path", async () => {
    const file = archive(); const result = await inspectSavedAssembly(root, file);
    expect(result.rel).toBe("Host.FCStd"); expect(JSON.stringify(result)).not.toContain(root);
  });
  it.each([['<Document><ObjectData><Object name="Part" type="PartDesign::Body"><Properties/></Object></ObjectData></Document>', "not_assembly"],
    ['<Document><Bad></Document>', "invalid_document_xml"], ['<!DOCTYPE Document SYSTEM "file:///private"><Document/>', "invalid_document_xml"]])("rejects unsupported input without rewriting [case %#]", async (xml, code) => {
    const file = archive("Host.FCStd", xml), before = hash(file);
    await expect(inspectSavedAssembly(root, "Host.FCStd")).rejects.toMatchObject({ code });
    expect(hash(file)).toBe(before); expect(fs.readdirSync(root)).toEqual(["Host.FCStd"]);
  });
  it("rejects an archive without Document.xml", async () => {
    fs.writeFileSync(path.join(root, "Host.FCStd"), zipSync({ "Other.xml": strToU8("<Document/>") }));
    await expect(inspectSavedAssembly(root, "Host.FCStd")).rejects.toMatchObject({ code: "missing_document_xml" });
  });
  it("rejects a changed source snapshot rather than presenting mixed observations", async () => {
    const file = archive(); const pending = inspectSavedAssembly(root, "Host.FCStd");
    // The parser yields after the archive read. This unrelated source mutation must invalidate the inspection.
    await new Promise<void>(resolve => setImmediate(() => { fs.appendFileSync(file, "changed"); resolve(); }));
    await expect(pending).rejects.toMatchObject({ code: "source_changed" });
  });
  it("honors cancellation, deadlines and a complete-envelope response budget", async () => {
    archive(); const controller = new AbortController(); controller.abort();
    await expect(inspectSavedAssembly(root, "Host.FCStd", controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    let now = 0; const pending = inspectSavedAssembly(root, "Host.FCStd", undefined, new CadObjectInfoBudget(undefined, { durationMs: 1, now: () => now })); now = 1;
    await expect(pending).rejects.toMatchObject({ code: "timeout" });
    await expect(inspectSavedAssembly(root, "Host.FCStd", undefined, new CadObjectInfoBudget(undefined, { bytes: 100 }))).rejects.toMatchObject({ code: "resource_limit" });
  });
  it("enforces the production 1 MiB output cap, not the generic object reader's larger cap", async () => {
    const links = Array.from({ length: 300 }, (_, index) => ({ name: `Sub${index}`, file: `${"a".repeat(4000)}.FCStd` }));
    archive("Host.FCStd", document(links));
    await expect(inspectSavedAssembly(root, "Host.FCStd")).rejects.toMatchObject({ code: "resource_limit" });
    expect(ASSEMBLY_INSPECTION_RESPONSE_BYTES).toBe(1024 * 1024);
  });
});

describe("assembly maintenance read-only route", () => {
  it("returns the inspection envelope and has no write endpoint", async () => {
    archive(); const routes = createAssemblyMaintenanceRoutes();
    const response = await post({ workspacePath: root, filePath: "Host.FCStd" }, routes);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true, data: { synchronization: "not_checked", update: { available: false } } });
    expect((await routes.request("/update", { method: "POST", body: "{}" })).status).toBe(404);
  });
  it.each([{ workspacePath: "value", filePath: "Host.FCStd", write: true }, { workspacePath: "value", filePath: "Host.FCStd", native: true },
    { workspacePath: "value", filePath: "Host.FCStd", bytes: 1 }, { filePath: "Host.FCStd" }, null, []])("rejects extra or malformed fields [case %#]", async body => {
    const response = await post(body); expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: "invalid_arguments" });
  });
  it("rejects overlong stream bytes even with an understated Content-Length", async () => {
    const response = await createAssemblyMaintenanceRoutes().request("/inspect", { method: "POST", headers: { "Content-Length": "1" }, body: JSON.stringify({ workspacePath: root, filePath: "x".repeat(64 * 1024) }) });
    expect(response.status).toBe(413); expect(await response.json()).toMatchObject({ code: "resource_limit" });
  });
  it("times out an unfinished body and never invokes the reader", async () => {
    const read = vi.fn(); const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(strToU8('{"workspacePath":')); } });
    const request = new Request("http://localhost/inspect", { method: "POST", body, duplex: "half" } as RequestInit);
    const response = await createAssemblyMaintenanceRoutes({ durationMs: 5 }, read).fetch(request);
    expect(response.status).toBe(408); expect(read).not.toHaveBeenCalled();
  });
  it("does not expose unexpected exception paths in responses", async () => {
    const response = await post({ workspacePath: root, filePath: "Host.FCStd" }, createAssemblyMaintenanceRoutes(undefined, async () => { throw new Error(`secret ${root}`); }));
    expect(response.status).toBe(400); expect(await response.text()).not.toContain(root);
  });
  it("returns cancelled for an already aborted in-memory request", async () => {
    const controller = new AbortController(); controller.abort();
    const response = await createAssemblyMaintenanceRoutes().fetch(new Request("http://localhost/inspect", { method: "POST", signal: controller.signal, body: "{}" }));
    expect(await response.json()).toMatchObject({ code: "cancelled" });
  });
});
