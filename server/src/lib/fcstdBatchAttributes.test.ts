import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { previewBatchAttributes, applyBatchAttributes } from "./fcstdBatchAttributes.js";
import { readFcstdEmbeddedBomFields } from "./fcstdDocumentXmlService.js";
import { ensurePhoenixDatabase } from "./phoenixDatabaseService.js";
import { cadRoutes } from "../routes/cad.js";
import * as indexMutation from "./cadIndexMutationService.js";

const roots: string[] = [];
function workspace() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desk-batch-attrs-")); roots.push(dir); return dir; }
const rel = "100001.002-H-PX-Bracket.FCStd";
const existing = '<Property name="PartName" type="App::PropertyString" group="CustomDefine" doc="keep metadata"><String value="已有名称"/></Property>';
function document(properties = "", second = false, nested = false) {
  return `<Document><Objects><Object name="Body" type="${nested ? 'App::Part' : 'PartDesign::Body'}"/>${second ? '<Object name="Other" type="PartDesign::Body"/>' : ''}</Objects><ObjectData><Object name="Body"><Properties Count="1"><Property name="Label" type="App::PropertyString"><String value="保留标签"/></Property>${properties}${nested ? '<Property name="Group" type="App::PropertyLinkList"><LinkList count="1"><Link value="Other"/></LinkList></Property>' : ''}</Properties></Object>${second ? '<Object name="Other"><Properties Count="1"><Property name="Label" type="App::PropertyString"><String value="nested"/></Property></Properties></Object>' : ''}</ObjectData></Document>`;
}
function fixture(dir: string, name = rel, xml = document(existing)) {
  const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zipSync({ "Document.xml": strToU8(xml), "shape.brp": strToU8("shape unchanged"), "GuiDocument.xml": strToU8("gui unchanged") })); return file;
}
const fields = ["PartNumber", "PartVersion"];
it.each(["Body", "Body001"])("batch attribute preview derives a plain filename name for saved default %s without changing the Label or file", async objectName => {
  const dir = workspace(); const filename = "测试盖板.FCStd";
  // Independent metadata-only root: default Label, no PartName or geometry.
  const savedXml = document().replaceAll('name="Body"', `name="${objectName}"`).replace("保留标签", objectName);
  const file = fixture(dir, filename, savedXml); const before = fs.readFileSync(file);
  const plan = await previewBatchAttributes(dir);
  expect(plan.errors).toEqual([]); expect(plan.rows).toHaveLength(1);
  expect(plan.rows[0].object_name).toBe(objectName);
  expect(plan.rows[0].changes.find(change => change.field === "PartName")).toMatchObject({
    current: "", proposed: "测试盖板", source: "默认节点标签，从文件名补全", eligible: true, reason: "ready",
  });
  expect(readFcstdEmbeddedBomFields(file)).toMatchObject({ PartName: "", label: objectName });
  expect(fs.readFileSync(file)).toEqual(before);
  expect(fs.existsSync(path.join(dir, ".phoenix"))).toBe(false);
});
it.each(["", "S", " a "])("does not offer an invalid PartName %j or the single-letter label as a writable recommendation", async name => {
  const dir = workspace();
  const file = fixture(dir, rel, document(existing.replace("已有名称", name)).replace("保留标签", "100001.002-S"));
  const before = fs.readFileSync(file);
  const plan = await previewBatchAttributes(dir, { overwrite: true });
  expect(plan.errors).toEqual([]);
  expect(plan.rows[0].changes.find(c => c.field === "PartName")).toMatchObject({ proposed: "", eligible: false, reason: "invalid_name", note: expect.stringContaining("为空或仅为一个英文字母") });
  expect(() => applyBatchAttributes(dir, { plan_id: plan.plan_id, confirm_overwrite: true, selections: [{ rel, fields: ["PartName"] }] })).toThrow(/可写字段/);
  expect(fs.readFileSync(file)).toEqual(before);
  // An explicit valid edit can repair the old value, under the existing overwrite confirmation.
  expect(applyBatchAttributes(dir, { plan_id: plan.plan_id, confirm_overwrite: true, selections: [{ rel, fields: ["PartName"], values: { PartName: "测试支架" } }] }).results[0].status).toBe("written");
  expect(readFcstdEmbeddedBomFields(file)).toMatchObject({ PartName: "测试支架" });
});
it.each(["label", "filename"] as const)("uses %s only for absent PartName, ignoring stale index name hints", async name_source => {
  const dir = workspace(); const file = fixture(dir, rel, document()); const before = fs.readFileSync(file);
  const db = pnwCreateDb(ensurePhoenixDatabase(dir));
  db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,part_name,updated_at) VALUES (?,?,?,?)", [rel, rel, "索引旧名称", "today"]); db.close();
  const plan = await previewBatchAttributes(dir, { name_source });
  expect(plan.rows[0].changes.find(c => c.field === "PartName")).toMatchObject({ proposed: name_source === "label" ? "保留标签" : "Bracket", eligible: true, reason: "ready" });
  expect(fs.readFileSync(file)).toEqual(before);
  fixture(dir);
  const existingPlan = await previewBatchAttributes(dir, { name_source, overwrite: true });
  expect(existingPlan.rows[0].changes.find(c => c.field === "PartName")).toMatchObject({ proposed: "已有名称", eligible: false, reason: "unchanged" });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it("previews without writes, keeps existing values, and writes only explicitly selected fields", async () => {
  const dir = workspace(); const file = fixture(dir); const before = fs.readFileSync(file);
  fixture(dir, "untouched.FCStd"); const untouched = fs.readFileSync(path.join(dir, "untouched.FCStd"));
  const preview = await previewBatchAttributes(dir);
  expect(preview.errors).toEqual([]);
  expect(fs.readFileSync(file)).toEqual(before); expect(fs.existsSync(path.join(dir, ".phoenix"))).toBe(false);
  const row = preview.rows.find(row => row.rel === rel)!;
  expect(row.object_name).toBe("Body");
  expect(row.changes.find(c => c.field === "PartName")).toMatchObject({ current: "已有名称", proposed: "已有名称", eligible: false, reason: "unchanged" });
  expect(row.changes.find(c => c.field === "PartNumber")).toMatchObject({ proposed: "100001", source: "文件名推断", eligible: true, reason: "ready" });
  const result = applyBatchAttributes(dir, { plan_id: preview.plan_id, selections: [{ rel, fields }] });
  expect(result.results[0].status).toBe("written");
  expect(readFcstdEmbeddedBomFields(file)).toMatchObject({ PartNumber: "100001", PartVersion: "002", PartName: "已有名称", label: "保留标签", TypeCode: "", ModelSeries: "" });
  const zip = unzipSync(fs.readFileSync(file));
  const xml = strFromU8(zip["Document.xml"]);
  expect(xml).toContain(existing); expect(xml).toContain('Properties Count="4"'); expect(xml).toContain('group="CustomDefine"');
  expect(zip["shape.brp"]).toEqual(unzipSync(before)["shape.brp"]); expect(zip["GuiDocument.xml"]).toEqual(unzipSync(before)["GuiDocument.xml"]);
  expect(fs.readFileSync(path.join(dir, "untouched.FCStd"))).toEqual(untouched);
  expect(fs.existsSync(path.join(dir, ".phoenix"))).toBe(false);
  const after = await previewBatchAttributes(dir);
  expect(after.rows.find(row => row.rel === rel)?.changes.find(c => c.field === "PartNumber")).toMatchObject({ eligible: false, reason: "unchanged" });
  expect(after.rows.find(row => row.rel === "untouched.FCStd")?.changes.find(c => c.field === "PartNumber")).toMatchObject({ eligible: false, reason: "missing_source" });
});

it("requires an explicit overwrite plan and confirmation, and refuses forged or noneligible fields", async () => {
  const dir = workspace(); const file = fixture(dir, rel, document(existing + '<Property name="TypeCode" type="App::PropertyString"><String value="R"/></Property>')); const before = fs.readFileSync(file);
  const normal = await previewBatchAttributes(dir);
  expect(() => applyBatchAttributes(dir, { plan_id: normal.plan_id, selections: [{ rel, fields: ["TypeCode"] }] })).toThrow(/可写字段/);
  const plan = await previewBatchAttributes(dir, { overwrite: true });
  expect(() => applyBatchAttributes(dir, { plan_id: plan.plan_id, selections: [{ rel, fields: ["TypeCode"] }] })).toThrow(/明确确认/);
  for (const bad of ["label", "__proto__", "filename"]) expect(() => applyBatchAttributes(dir, { plan_id: plan.plan_id, confirm_overwrite: true, selections: [{ rel, fields: [bad] }] })).toThrow(/可写字段/);
  expect(fs.readFileSync(file)).toEqual(before);
  expect(applyBatchAttributes(dir, { plan_id: plan.plan_id, confirm_overwrite: true, selections: [{ rel, fields: ["TypeCode"] }] }).results[0].status).toBe("written");
  expect(readFcstdEmbeddedBomFields(file)).toMatchObject({ TypeCode: "H", PartName: "已有名称" });
});

it("refuses ambiguous roots but permits a single Part with a nested Body; skips drawings", async () => {
  const dir = workspace(); fixture(dir, "ambiguous.FCStd", document("", true));
  fixture(dir, "100002.001-H-Root.FCStd", document("", true, true));
  fixture(dir, "100003.001-H-Root.Drawing.FCStd");
  const preview = await previewBatchAttributes(dir, { include_drawings: true });
  expect(preview.rows.map(row => row.rel)).toEqual(["100002.001-H-Root.FCStd"]);
  expect(preview.errors).toEqual([{ rel: "ambiguous.FCStd", message: expect.stringMatching(/多个独立/) }]);
  expect(preview.skipped[0].message).toMatch(/图纸/);
});

it("excludes drawings by default, including TechDraw documents without a drawing suffix", async () => {
  const dir = workspace(); fixture(dir);
  fixture(dir, "sheet.Drawing.FCStd", "not even an archive document");
  fixture(dir, "sheet.FCStd", document().replace("PartDesign::Body", "TechDraw::DrawPage"));
  const normal = await previewBatchAttributes(dir);
  expect(normal.rows).toHaveLength(1); expect(normal.skipped).toEqual([]); expect(normal.errors).toEqual([]);
  expect(normal.scanned).toBe(1); expect(normal.excluded_drawings).toBe(2);
  const inclusive = await previewBatchAttributes(dir, { include_drawings: true });
  expect(inclusive.scanned).toBe(3); expect(inclusive.skipped).toHaveLength(2);
  expect(() => applyBatchAttributes(dir, { plan_id: inclusive.plan_id, selections: [{ rel: "sheet.FCStd", fields }] })).toThrow(/可写字段/);
  await expect(previewBatchAttributes(dir, { include_drawings: "false" as never })).rejects.toThrow(/布尔值/);
});

it("applies an edited name to one file, consuming only that file and preserving all other data", async () => {
  const dir = workspace(); const first = fixture(dir, rel, document());
  const otherRel = "720423.003-H-PX-Frame.FCStd"; const other = fixture(dir, otherRel, document());
  const untouched = fs.readFileSync(other); const original = unzipSync(fs.readFileSync(first));
  const plan = await previewBatchAttributes(dir);
  const selected = { rel, fields: ["PartName"], values: { PartName: "  测试框架  " } };
  expect(applyBatchAttributes(dir, { plan_id: plan.plan_id, single: true, selections: [selected] }).results[0].status).toBe("written");
  expect(readFcstdEmbeddedBomFields(first)).toMatchObject({ PartName: "测试框架", label: "保留标签", PartNumber: "" });
  const modified = unzipSync(fs.readFileSync(first));
  expect(modified["shape.brp"]).toEqual(original["shape.brp"]); expect(modified["GuiDocument.xml"]).toEqual(original["GuiDocument.xml"]);
  expect(fs.readFileSync(other)).toEqual(untouched);
  expect(() => applyBatchAttributes(dir, { plan_id: plan.plan_id, single: true, selections: [selected] })).toThrow(/可写字段/);
  expect(applyBatchAttributes(dir, { plan_id: plan.plan_id, single: true, selections: [{ rel: otherRel, fields }] }).results[0].status).toBe("written");
});

it("validates manual name overrides and overwrite authority before consuming any plan", async () => {
  const dir = workspace(); const file = fixture(dir); const before = fs.readFileSync(file);
  const normal = await previewBatchAttributes(dir);
  expect(normal.rows[0].name_editable).toBe(false);
  expect(() => applyBatchAttributes(dir, { plan_id: normal.plan_id, selections: [{ rel, fields: ["PartName"], values: { PartName: "替换" } }] })).toThrow(/可写字段/);
  const plan = await previewBatchAttributes(dir, { overwrite: true });
  const apply = (values: unknown, chosen = ["PartName"]) => applyBatchAttributes(dir, { plan_id: plan.plan_id, confirm_overwrite: true, single: true, selections: [{ rel, fields: chosen, values: values as { PartName: string } }] });
  for (const name of ["", " ", "S", " s ", "A", "z", "Ｓ", "../escape", "a/b", "测试.ASSY", "测试.fcstd", "x".repeat(256), "a\u0000b"]) expect(() => apply({ PartName: name })).toThrow(/零件名/);
  for (const values of [null, [], { label: "forged" }, { PartName: 42 }, { PartName: "测试", TypeCode: "S" }]) expect(() => apply(values)).toThrow(/零件名|可写字段/);
  expect(() => apply({ PartName: "测试" }, fields)).toThrow(/零件名/);
  expect(() => applyBatchAttributes(dir, { plan_id: plan.plan_id, confirm_overwrite: true, single: true, selections: [{ rel, fields }, { rel, fields }] })).toThrow(/一个文件/);
  expect(fs.readFileSync(file)).toEqual(before);
  expect(apply({ PartName: "测试框架" }).results[0].status).toBe("written");
});

it("consumes a stale single row without consuming other files in its plan", async () => {
  const dir = workspace(); const first = fixture(dir); const other = "720423.003-H-PX-Frame.FCStd"; fixture(dir, other);
  const plan = await previewBatchAttributes(dir); fs.appendFileSync(first, "stale");
  expect(applyBatchAttributes(dir, { plan_id: plan.plan_id, single: true, selections: [{ rel, fields }] }).results[0].status).toBe("failed");
  expect(() => applyBatchAttributes(dir, { plan_id: plan.plan_id, single: true, selections: [{ rel, fields }] })).toThrow(/可写字段/);
  expect(applyBatchAttributes(dir, { plan_id: plan.plan_id, selections: [{ rel: other, fields }] }).results[0].status).toBe("written");
});

it.each(["Part::Feature", "Part::FeaturePython"])("writes Body attributes without touching the %s BaseFeature source", async sourceType => {
  const dir = workspace();
  const source = '<Object name="Imported"><Properties><Property name="Label" type="App::PropertyString"><String value="STEP source"/></Property></Properties></Object>';
  const xml = document().replace('</Objects>', `<Object name="Imported" type="${sourceType}"/></Objects>`)
    .replace('</Properties>', '<Property name="BaseFeature" type="App::PropertyLink"><Link value="Imported"/></Property></Properties>')
    .replace('</ObjectData>', `${source}</ObjectData>`);
  const file = fixture(dir, rel, xml);
  const plan = await previewBatchAttributes(dir);
  expect(plan.errors).toEqual([]); expect(plan.rows[0].object_name).toBe("Body");
  const result = applyBatchAttributes(dir, { plan_id: plan.plan_id, selections: [{ rel, fields }] });
  expect(result.results[0].status).toBe("written");
  expect(readFcstdEmbeddedBomFields(file)).toMatchObject({ PartNumber: "100001", PartVersion: "002" });
  expect(strFromU8(unzipSync(fs.readFileSync(file))["Document.xml"])).toContain(source);
});

it("blocks wrong property types and conflicting index hints; preserves unrelated index fields after partial writes", async () => {
  const dir = workspace(); fixture(dir, rel, document('<Property name="PartNumber" type="App::PropertyInteger"><Integer value="42"/></Property>' + existing));
  const file = ensurePhoenixDatabase(dir); const db = pnwCreateDb(file);
  db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,part_version,part_name,label,model_series,updated_at) VALUES (?,?,?,?,?,?,?)", [rel, rel, "999", "已有名称", " 保留标签 ", "px", "today"]); db.close();
  const plan = await previewBatchAttributes(dir);
  const row = plan.rows[0];
  expect(row.changes.find(c => c.field === "PartNumber")).toMatchObject({ eligible: false, reason: "type_conflict", note: expect.stringMatching(/不是字符串/) });
  expect(row.changes.find(c => c.field === "PartVersion")).toMatchObject({ eligible: false, reason: "source_conflict", note: expect.stringMatching(/来源冲突/) });
  const result = applyBatchAttributes(dir, { plan_id: plan.plan_id, selections: [{ rel, fields: ["TypeCode"] }] });
  expect(result.results[0].status).toBe("written");
  const verify = pnwCreateDb(file);
  expect(verify.get("SELECT type_code,part_version,part_name,label,model_series FROM phoenix_cad_file_asset")).toEqual({ type_code: "H", part_version: "999", part_name: "已有名称", label: " 保留标签 ", model_series: "px" }); verify.close();
});

it.each([
  ["Bracket.ASSY", "Bracket", ".ASSY.FCStd", "Bracket"],
  ["Bracket.assy.ASSY", "Bracket", ".ASSY.FCStd", "Bracket"],
  ["Bracket.ASSY", "Other", ".ASSY.FCStd", "Bracket"],
  ["Bracket.ASSY.Detail", "Bracket", ".ASSY.FCStd", "Bracket.ASSY.Detail"],
  ["Bracket.ASSY", "Bracket", ".FCStd", "Bracket"],
])("keeps embedded %s before filename %s with suffix %s (result=%s)", async (indexName, filenameName, suffix, expected) => {
  const dir = workspace();
  const name = `100007.001-H-PX-${filenameName}${suffix}`;
  const file = fixture(dir, name, document(existing.replace("已有名称", indexName)));
  const before = fs.readFileSync(file);
  const db = pnwCreateDb(ensurePhoenixDatabase(dir));
  db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,part_name,updated_at) VALUES (?,?,?,?)", [name, name, indexName, "today"]);
  db.close();
  const normal = await previewBatchAttributes(dir);
  const changed = expected !== indexName;
  expect(normal.rows[0].changes.find(c => c.field === "PartName")?.reason).toBe(changed ? "overwrite_blocked" : "unchanged");
  const plan = await previewBatchAttributes(dir, { overwrite: true });
  const change = plan.rows[0].changes.find(c => c.field === "PartName")!;
  expect(change.reason).toBe(changed ? "ready" : "unchanged");
  expect(change.proposed).toBe(expected);
  expect(fs.readFileSync(file)).toEqual(before);
  if (changed) {
    const result = applyBatchAttributes(dir, { plan_id: plan.plan_id, confirm_overwrite: true, selections: [{ rel: name, fields: ["PartName"] }] });
    expect(result.results[0].status).toBe("written");
    expect(readFcstdEmbeddedBomFields(file)).toMatchObject({ PartName: expected, label: "保留标签" });
  }
});

it("reports a committed file honestly when the optional index projection throws", async () => {
  const dir = workspace(); const file = fixture(dir);
  const plan = await previewBatchAttributes(dir);
  vi.spyOn(indexMutation, "updateCadIndexEntryAfterBomWrite").mockImplementation(() => { throw new Error("index unavailable"); });
  const result = applyBatchAttributes(dir, { plan_id: plan.plan_id, selections: [{ rel, fields }] });
  expect(result.results[0]).toMatchObject({ status: "written", message: expect.stringMatching(/索引未更新/) });
  expect(readFcstdEmbeddedBomFields(file)).toMatchObject({ PartNumber: "100001", PartVersion: "002", PartName: "已有名称" });
});

it("binds plans to workspace, TTL, file fingerprint and a single execution", async () => {
  const dir = workspace(); const a = fixture(dir); const other = "100002.002-H-PX-Second.FCStd"; fixture(dir, other);
  const plan = await previewBatchAttributes(dir);
  expect(() => applyBatchAttributes(workspace(), { plan_id: plan.plan_id, selections: [{ rel, fields }] })).toThrow(/失效/);
  expect(() => applyBatchAttributes(dir, { plan_id: plan.plan_id, selections: [{ rel: "../escape.FCStd", fields }] })).toThrow(/勾选/);
  fs.appendFileSync(a, "changed"); const changed = fs.readFileSync(a);
  const result = applyBatchAttributes(dir, { plan_id: plan.plan_id, selections: [{ rel, fields }, { rel: other, fields }] });
  expect(result.results.map(row => row.status)).toEqual(["failed", "written"]); expect(fs.readFileSync(a)).toEqual(changed);
  expect(() => applyBatchAttributes(dir, { plan_id: plan.plan_id, selections: [{ rel: other, fields }] })).toThrow(/失效/);
  const expired = await previewBatchAttributes(dir); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 11 * 60_000);
  expect(() => applyBatchAttributes(dir, { plan_id: expired.plan_id, selections: [{ rel: other, fields: ["TypeCode"] }] })).toThrow(/失效/);
});

it("reports malformed input and symlinks; rechecks symlinks and rolls back a failed replacement", async () => {
  const dir = workspace(); const a = fixture(dir); const external = workspace(); const target = fixture(external);
  fixture(dir, "broken.FCStd", "<Document><bad>"); fs.symlinkSync(target, path.join(dir, "linked.FCStd"));
  const plan = await previewBatchAttributes(dir); expect(plan.errors).toHaveLength(2);
  await expect(previewBatchAttributes(dir, { batch_dir: external })).rejects.toThrow(/超出/);
  const before = fs.readFileSync(a); const rename = fs.renameSync.bind(fs); let count = 0;
  vi.spyOn(fs, "renameSync").mockImplementation((a,b) => { if (++count === 2) throw new Error("injected"); rename(a,b); });
  expect(applyBatchAttributes(dir, { plan_id: plan.plan_id, selections: [{ rel, fields }] }).results[0].status).toBe("failed");
  expect(fs.readFileSync(a)).toEqual(before); vi.restoreAllMocks();
  const retry = await previewBatchAttributes(dir); fs.unlinkSync(a); fs.symlinkSync(target, a);
  expect(applyBatchAttributes(dir, { plan_id: retry.plan_id, selections: [{ rel, fields }] }).results[0]).toMatchObject({ status: "failed", message: expect.stringMatching(/符号链接/) });
  expect(fs.readFileSync(target)).toEqual(before);
});

it("exposes preview/apply routes and rejects unplanned requests", async () => {
  const dir = workspace(); fixture(dir);
  const query = `?workspace=${encodeURIComponent(dir)}`;
  const response = await cadRoutes.request(`/batch-attributes/preview${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch_dir: "." }) });
  expect(response.status).toBe(200); const preview = await response.json();
  const applied = await cadRoutes.request(`/batch-attributes/apply${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan_id: preview.plan_id, selections: [{ rel, fields }] }) });
  expect(applied.status).toBe(200); expect(await applied.json()).toMatchObject({ results: [{ status: "written" }] });
});
