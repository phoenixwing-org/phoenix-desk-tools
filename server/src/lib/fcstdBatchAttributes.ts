import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { pnwInferBomDocumentKinds, pnwNormalizeBomPartNameSuffix } from "@phoenix-wing/cad-core";
import { readBomBatchHints } from "./bomAttributeService.js";
import { assertValidPartName, bomNameSource, InvalidPartNameError, recommendPartName } from "./bomNameRecommendation.js";
import { isStandaloneDrawing } from "./fcstdDrawing.js";
import { updateCadIndexEntryAfterBomWrite } from "./cadIndexMutationService.js";
import { inspectFcstdBatchTarget, patchFcstdEmbeddedBomDocumentXml, replaceFileAtomically } from "./fcstdDocumentXmlService.js";
import { fcstdFingerprint, fcstdWorkspace, readFcstdBatchArchive, safeFcstdPath, visitFcstdBatch } from "./fcstdBatchFiles.js";

export const BATCH_BOM_FIELDS = ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName"] as const;
type Field = typeof BATCH_BOM_FIELDS[number];
export type BatchAttributeChangeReason = "ready" | "unchanged" | "type_conflict" | "source_conflict" | "missing_source" | "invalid_name" | "overwrite_blocked";
export type BatchAttributeChange = { field: Field; current: string; proposed: string; source: string; eligible: boolean; reason: BatchAttributeChangeReason; note: string };
type Row = { rel: string; object_name: string; name_editable: boolean; changes: BatchAttributeChange[] };
type PlannedFile = { hash: string; objectName: string; nameEditable: boolean; values: Partial<Record<Field, string>> };
const plans = new Map<string, { root: string; expires: number; overwrite: boolean; files: Map<string, PlannedFile> }>();
const clean = (value: unknown) => String(value ?? "").trim();

export async function previewBatchAttributes(workspace: string, opts: { batch_dir?: string; overwrite?: boolean; name_source?: unknown; include_drawings?: boolean } = {}) {
  const nameSource = bomNameSource(opts.name_source);
  if (opts.overwrite != null && typeof opts.overwrite !== "boolean") throw new Error("覆盖选项必须是布尔值");
  if (opts.include_drawings != null && typeof opts.include_drawings !== "boolean") throw new Error("包含图纸选项必须是布尔值");
  const root = fcstdWorkspace(workspace);
  const rows: Row[] = [];
  const skipped: Array<{ rel: string; message: string }> = [];
  const files = new Map<string, PlannedFile>();
  let excludedDrawings = 0;
  const drawing = (rel: string) => {
    if (opts.include_drawings) skipped.push({ rel, message: "图纸不写 BOM 属性，请打开源模型" });
    else excludedDrawings++;
  };
  const scan = await visitFcstdBatch(root, String(opts.batch_dir || "."), (rel, filename) => {
    const kinds = pnwInferBomDocumentKinds(rel);
    if (kinds.drawing) { drawing(rel); return; }
    const archive = readFcstdBatchArchive(filename);
    if (isStandaloneDrawing(rel, archive.xml)) { drawing(rel); return; }
    const target = inspectFcstdBatchTarget(archive.xml);
    const hints = readBomBatchHints(root, rel);
    const values: Partial<Record<Field, string>> = {};
    const changes = BATCH_BOM_FIELDS.map((field): BatchAttributeChange => {
      const current = target.current[field];
      const normalize = (value: unknown) => field === "PartName"
        ? pnwNormalizeBomPartNameSuffix(clean(value), kinds.recommended_suffix) : clean(value);
      const index = normalize(hints.index[field]); const hint = normalize(hints.filename[field]);
      let name: ReturnType<typeof recommendPartName> | null = null;
      if (field === "PartName") {
        try { name = recommendPartName(rel, target.current, nameSource); }
        catch (error) {
          if (!(error instanceof InvalidPartNameError)) throw error;
          return { field, current, proposed: "", source: error.sourceNote, eligible: false, reason: "invalid_name", note: error.message };
        }
      }
      const proposed = name ? name.value : index || hint;
      const source = name ? name.source_note : index ? (hint ? "索引 + 文件名" : "索引") : hint ? "文件名推断" : "无来源";
      let note = "";
      let reason: BatchAttributeChangeReason = "ready";
      if (target.types[field] && target.types[field] !== "App::PropertyString") { reason = "type_conflict"; note = "已有属性不是字符串类型，需单文件检查"; }
      else if (field !== "PartName" && index && hint && index !== hint) { reason = "source_conflict"; note = `来源冲突：索引「${index}」/ 文件名「${hint}」，需单文件确认`; }
      else if (!proposed) { reason = "missing_source"; note = "没有可靠的拟写值，跳过"; }
      else if (current === proposed) { reason = "unchanged"; note = "值已一致"; }
      else if (current && !opts.overwrite) { reason = "overwrite_blocked"; note = "保留已有值（默认只补空值/缺失）"; }
      const eligible = reason === "ready";
      if (eligible) values[field] = proposed;
      return { field, current, proposed, source, eligible, reason, note: note || (current ? "覆盖已有值" : "补充属性") };
    });
    const nameEditable = (!target.types.PartName || target.types.PartName === "App::PropertyString") && (!target.current.PartName || opts.overwrite === true);
    rows.push({ rel, object_name: target.objectName, name_editable: nameEditable, changes });
    if (Object.keys(values).length || nameEditable) files.set(rel, { hash: fcstdFingerprint(archive.bytes), objectName: target.objectName, nameEditable, values });
  });
  for (const [key, plan] of plans) if (plan.expires <= Date.now()) plans.delete(key);
  while (plans.size >= 20) plans.delete(plans.keys().next().value!);
  const plan_id = randomUUID();
  plans.set(plan_id, { root, expires: Date.now() + 10 * 60_000, overwrite: opts.overwrite === true, files });
  return { plan_id, ...scan, scanned: scan.scanned - excludedDrawings, excluded_drawings: excludedDrawings, overwrite: opts.overwrite === true, rows, skipped };
}

export function applyBatchAttributes(workspace: string, opts: { plan_id?: string; confirm_overwrite?: boolean; single?: boolean; selections?: Array<{ rel: string; fields: string[]; values?: { PartName?: string } }> } = {}) {
  const root = fcstdWorkspace(workspace); const plan = plans.get(opts.plan_id || "");
  if (!plan || plan.root !== root || plan.expires <= Date.now()) throw new Error("预览已失效，请重新预览");
  if (plan.overwrite && opts.confirm_overwrite !== true) throw new Error("覆盖模式需要明确确认");
  if (opts.single != null && typeof opts.single !== "boolean") throw new Error("单行写入选项必须是布尔值");
  if (opts.single && opts.selections?.length !== 1) throw new Error("单行写入只能选择一个文件");
  if (!Array.isArray(opts.selections) || !opts.selections.length || opts.selections.length > 1000
    || opts.selections.some(row => !row || typeof row.rel !== "string" || !plan.files.has(row.rel)
      || !Array.isArray(row.fields) || !row.fields.length || row.fields.length > BATCH_BOM_FIELDS.length
      || new Set(row.fields).size !== row.fields.length
      || row.fields.some(field => typeof field !== "string" || !(Object.hasOwn(plan.files.get(row.rel)!.values, field) || (field === "PartName" && plan.files.get(row.rel)!.nameEditable && row.values?.PartName !== undefined))))
    || new Set(opts.selections.map(row => row.rel)).size !== opts.selections.length) throw new Error("只能写入本次预览中勾选的文件与可写字段");
  for (const row of opts.selections) {
    if (row.values === undefined) continue;
    if (!row.values || typeof row.values !== "object" || Array.isArray(row.values) || Object.keys(row.values).some(key => key !== "PartName")
      || !Object.hasOwn(row.values, "PartName") || typeof row.values.PartName !== "string" || !plan.files.get(row.rel)!.nameEditable || !row.fields.includes("PartName")) throw new Error("只能编辑当前预览允许写入的零件名");
    const name = row.values.PartName.trim();
    assertValidPartName(name, "手工草稿");
    if (!name || Buffer.byteLength(name) > 255 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || name.includes("..") || /[. ]$/.test(name) || /\.(?:assy|drawing|fcstd)$/i.test(name)) throw new Error("零件名须为非空纯名称，不含 .ASSY 等后缀或不安全字符，且不超过 255 字节");
  }
  if (!opts.single) plans.delete(opts.plan_id!);
  const results: Array<{ rel: string; status: "written" | "failed"; message: string }> = [];
  for (const selection of opts.selections) {
    const planned = plan.files.get(selection.rel)!;
    // Consume this file before attempting I/O; uncertain responses must not replay it.
    if (opts.single) { plan.files.delete(selection.rel); if (!plan.files.size) plans.delete(opts.plan_id!); }
    try {
      const filename = safeFcstdPath(root, selection.rel);
      const archive = readFcstdBatchArchive(filename, true);
      if (fcstdFingerprint(archive.bytes) !== planned.hash) throw new Error("预览后文件已变化，请重新预览");
      const values = Object.fromEntries(selection.fields.map(key => [key, key === "PartName" && selection.values ? selection.values.PartName!.trim() : planned.values[key as Field]]));
      if (selection.fields.includes("PartName")) assertValidPartName(values.PartName, "待写入值");
      const patched = patchFcstdEmbeddedBomDocumentXml(archive.xml, values);
      if (patched.objectName !== planned.objectName) throw new Error("目标对象已变化，未写入");
      archive.files["Document.xml"] = strToU8(patched.xml);
      const bytes = zipSync(archive.files, { level: 6 });
      safeFcstdPath(root, selection.rel);
      if (fcstdFingerprint(fs.readFileSync(filename)) !== planned.hash) throw new Error("文件已变化，未写入");
      replaceFileAtomically(filename, bytes);
      // Partial update values must be merged so unrelated index fields survive.
      let indexUpdated = false;
      try { indexUpdated = updateCadIndexEntryAfterBomWrite(root, selection.rel, values, selection.fields as Field[]); }
      catch { /* The file is already committed; report index failure separately. */ }
      results.push({ rel: selection.rel, status: "written", message: `已写入 ${new Set(selection.fields).size} 个字段到 ${planned.objectName}${indexUpdated ? "，已更新已有索引投影" : "；索引未更新，请在 KT Auto CAD 刷新"}` });
    } catch (error) { results.push({ rel: selection.rel, status: "failed", message: error instanceof Error ? error.message : String(error) }); }
  }
  return { results };
}
