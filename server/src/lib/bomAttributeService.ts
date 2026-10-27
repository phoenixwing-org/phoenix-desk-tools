import fs from "node:fs";
import path from "node:path";
import {
  pnwComposeBomLabel,
  pnwComposeRecommendedBomFilename,
  pnwInferBomDocumentKinds,
  pnwInferBomFieldsFromFilename,
  pnwInferFcstdSuffix,
  pnwNormalizeBomPartNameSuffix,
  pnwNormalizeCadRelativePath,
  type PnwCadBomFields,
  type PnwCadDocumentKinds,
} from "@phoenix-wing/cad-core";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { assertValidPartName, bomNameSource, bomRecommendationSuffix, recommendPartName } from "./bomNameRecommendation.js";
import { isStandaloneDrawing, proposeDrawingName } from "./fcstdDrawing.js";
import { readFcstdAssemblyState, type FcstdAssemblyLinkState, type FcstdAssemblyJointIssue } from "./fcstdAssemblyState.js";
import {
  updateCadIndexEntryAfterBomWrite,
  updateCadIndexEntryAfterRename,
} from "./cadIndexMutationService.js";
import { executeDiskFileRename } from "./pnwRenameService.js";
import {
  loadWorkspaceSection,
  replaceWorkspaceSection,
} from "./workspacePrefsService.js";
import {
  readFcstdDocumentXml,
  extractFcstdEmbeddedBomSnapshot,
  writeFcstdEmbeddedBomFields,
} from "./fcstdDocumentXmlService.js";

const DEFAULT_PART_VERSION = "001";
const DEFAULT_TYPE_CODE = "H";

export type BomFields = PnwCadBomFields;

export type BomKindFilters = {
  part: boolean;
  assembly: boolean;
  drawing: boolean;
};

export type BomDocumentKinds = PnwCadDocumentKinds;

export type BomPreview = {
  rel_path: string;
  fields: BomFields;
  source_note: string;
  abs_path_display: string;
  is_fcstd: boolean;
  document_kinds: BomDocumentKinds | null;
  embedded_warning: string | null;
  file_size_bytes: number | null;
  file_size_display: string | null;
  bom_readonly?: boolean;
  bom_source_rel?: string | null;
  bom_readonly_reason?: string | null;
  /** Saved per-instance Rigid intent; a normal load never writes CAD or the DB. */
  assembly_links?: FcstdAssemblyLinkState[];
  assembly_joint_issues?: FcstdAssemblyJointIssue[];
};

type BomPrefsStored = {
  last_part_number: string;
  last_part_version: string;
  last_type_code: string;
  last_model_series: string;
};

type BomAssetRow = Partial<BomFields> & {
  repo_rel_path?: string | null;
  filename?: string | null;
  asset_kind?: string | null;
  part_number?: string | null;
  part_version?: string | null;
  type_code?: string | null;
  model_series?: string | null;
  part_name?: string | null;
  label?: string | null;
};

const EDITABLE_KEYS = ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName", "label"] as const;
const RECOMMEND_ORDER = ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName", "label", "filename"] as const;

function clean(v: unknown): string {
  return String(v ?? "").trim();
}

function cleanUpper(v: unknown): string {
  return clean(v).toUpperCase();
}

function normalizeRelPath(rel: string): string {
  return pnwNormalizeCadRelativePath(rel);
}

function resolveUnderWorkspace(workspaceRoot: string, rel: string): { rel: string; abs: string } {
  const root = path.resolve(workspaceRoot);
  const safeRel = normalizeRelPath(rel);
  const abs = path.resolve(root, safeRel);
  const back = path.relative(root, abs);
  if (back.startsWith("..") || path.isAbsolute(back)) {
    throw new Error(`Path escapes workspace: ${rel}`);
  }
  return { rel: safeRel, abs };
}

function pathDisplay(abs: string, workspaceRoot: string): string {
  const root = path.resolve(workspaceRoot);
  const back = path.relative(root, abs).replace(/\\/g, "/");
  if (!back.startsWith("..") && !path.isAbsolute(back)) return back ? `./${back}` : ".";
  return path.normalize(abs);
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function isFcstdFilename(filename: string): boolean {
  return /\.fcstd$/i.test(filename);
}

function requireFcstdFilename(filename: string): void {
  if (!isFcstdFilename(filename)) throw new Error("Target filename must end with .FCStd");
}

function validateBomTargetFilename(filename: string): string {
  const cleanName = clean(filename);
  if (!cleanName) throw new Error("Target filename is required");
  if (cleanName.includes("/") || cleanName.includes("\\")) throw new Error("Target filename must not contain path separators");
  if (cleanName === "." || cleanName === ".." || cleanName.includes("..")) throw new Error("Target filename must not contain '..'");
  if (/[<>:"|?*\x00-\x1F]/.test(cleanName)) throw new Error("Target filename contains characters not allowed on Windows");
  if (cleanName.length > 255) throw new Error("Target filename is too long");
  requireFcstdFilename(cleanName);
  return cleanName;
}

export const inferBomFieldsFromFilename = pnwInferBomFieldsFromFilename;

function emptyFields(rel: string): BomFields {
  const safeRel = normalizeRelPath(rel);
  return {
    repo_rel_path: safeRel,
    filename: path.posix.basename(safeRel),
    PartNumber: "",
    PartVersion: "",
    TypeCode: "",
    ModelSeries: "",
    PartName: "",
    label: "",
  };
}

function mergeFields(base: BomFields, patch: Partial<BomFields>): BomFields {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, clean(v)])),
    TypeCode: cleanUpper(patch.TypeCode ?? base.TypeCode),
    ModelSeries: cleanUpper(patch.ModelSeries ?? base.ModelSeries),
  };
}

function mergeNonEmptyFields(base: BomFields, patch: Partial<BomFields>): BomFields {
  const nonEmpty = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => clean(value)),
  ) as Partial<BomFields>;
  return mergeFields(base, nonEmpty);
}

function bodyToFields(rel: string, body: any = {}): BomFields {
  const src = body?.fields && typeof body.fields === "object" ? { ...body.fields, ...body } : body;
  return mergeFields(emptyFields(rel), {
    repo_rel_path: clean(src.repo_rel_path || rel),
    filename: clean(src.filename || path.posix.basename(normalizeRelPath(rel))),
    PartNumber: clean(src.PartNumber ?? src.part_number),
    PartVersion: clean(src.PartVersion ?? src.part_version),
    TypeCode: clean(src.TypeCode ?? src.type_code),
    ModelSeries: clean(src.ModelSeries ?? src.model_series),
    PartName: clean(src.PartName ?? src.part_name),
    label: clean(src.label ?? src.Label),
  });
}

function assetToFields(rel: string, asset: BomAssetRow | null): Partial<BomFields> {
  if (!asset) return {};
  return {
    repo_rel_path: clean(asset.repo_rel_path || asset.repo_rel_path || rel),
    filename: clean(asset.filename || path.posix.basename(normalizeRelPath(rel))),
    PartNumber: clean(asset.PartNumber || asset.part_number),
    PartVersion: clean(asset.PartVersion || asset.part_version),
    TypeCode: cleanUpper(asset.TypeCode || asset.type_code),
    ModelSeries: cleanUpper(asset.ModelSeries || asset.model_series),
    PartName: clean(asset.PartName || asset.part_name),
    label: clean(asset.label),
  };
}

function dbPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".phoenix", "phoenix-workspace.sqlite");
}

function readAssetFromDb(workspaceRoot: string, rel: string, strict = false): BomAssetRow | null {
  const dbFile = dbPath(workspaceRoot);
  if (!fs.existsSync(dbFile)) return null;
  try {
    const db = pnwCreateDb(dbFile);
    try {
      const safeRel = normalizeRelPath(rel);
      return db.get<BomAssetRow>(
        `SELECT repo_rel_path, filename, asset_kind, part_number, part_version, type_code, model_series, part_name, label, file_status
         FROM phoenix_cad_file_asset
         WHERE (repo_rel_path = ? OR repo_rel_path = ?) AND COALESCE(file_status, 'present') = 'present'
         LIMIT 1`,
        [safeRel, `./${safeRel}`],
      ) || null;
    } finally {
      db.close?.();
    }
  } catch (error) {
    if (strict) throw new Error(`索引提示读取失败：${String(error)}`);
    return null;
  }
}

function drawingState(workspaceRoot: string, rel: string) {
  const { abs } = resolveUnderWorkspace(workspaceRoot, rel);
  const xml = isFcstdFilename(rel) ? readFcstdDocumentXml(abs) : null;
  return { xml, readonly: isStandaloneDrawing(rel, xml) };
}

function requireModelBom(workspaceRoot: string, rel: string) {
  if (drawingState(workspaceRoot, rel).readonly) throw new Error("独立图纸不编辑或推荐 BOM 属性，请打开源模型；图纸可单独改名");
}

/** Separate source snapshots for a batch preview; no workspace-memory defaults. */
export function readBomBatchHints(workspaceRoot: string, rel: string) {
  return { index: assetToFields(rel, readAssetFromDb(workspaceRoot, rel, true)), filename: inferBomFieldsFromFilename(rel) };
}

export const inferBomDocumentKinds = pnwInferBomDocumentKinds;

function defaultPrefs(): BomPrefsStored {
  return {
    last_part_number: "",
    last_part_version: DEFAULT_PART_VERSION,
    last_type_code: DEFAULT_TYPE_CODE,
    last_model_series: "",
  };
}

function nextPartNumberAfter(last: string): string {
  const m = /^(\d+)(.*)$/.exec(clean(last));
  if (!m) return clean(last);
  const n = String(Number(m[1]) + 1);
  return `${n.length < m[1].length ? n.padStart(m[1].length, "0") : n}${m[2]}`;
}

function recommendedFill(stored: BomPrefsStored) {
  return {
    PartNumber: nextPartNumberAfter(stored.last_part_number),
    PartVersion: stored.last_part_version || DEFAULT_PART_VERSION,
    TypeCode: (stored.last_type_code || DEFAULT_TYPE_CODE).toUpperCase(),
    ModelSeries: stored.last_model_series || "",
  };
}

export function loadBomApplyPrefs(workspaceRoot: string) {
  const raw = loadWorkspaceSection<Record<string, any>>(workspaceRoot, "bom_apply", {});
  const stored = {
    ...defaultPrefs(),
    last_part_number: clean(raw.last_part_number),
    last_part_version: clean(raw.last_part_version) || DEFAULT_PART_VERSION,
    last_type_code: cleanUpper(raw.last_type_code) || DEFAULT_TYPE_CODE,
    last_model_series: cleanUpper(raw.last_model_series),
  };
  return { stored, recommended_fill: recommendedFill(stored) };
}

export function rememberBomApplyPrefs(workspaceRoot: string, fields: Partial<BomFields>): void {
  const current = loadBomApplyPrefs(workspaceRoot).stored;
  const next = {
    ...current,
    last_part_number: clean(fields.PartNumber) || current.last_part_number,
    last_part_version: clean(fields.PartVersion) || current.last_part_version || DEFAULT_PART_VERSION,
    last_type_code: cleanUpper(fields.TypeCode) || current.last_type_code || DEFAULT_TYPE_CODE,
    last_model_series: cleanUpper(fields.ModelSeries) || current.last_model_series,
  };
  replaceWorkspaceSection(workspaceRoot, "bom_apply", next);
}

export function loadBomPreview(workspaceRoot: string, rel: string): BomPreview {
  const { rel: safeRel, abs } = resolveUnderWorkspace(workspaceRoot, rel);
  const isFcstd = isFcstdFilename(safeRel);
  const base = inferBomFieldsFromFilename(safeRel);
  const dbFields = assetToFields(safeRel, readAssetFromDb(workspaceRoot, safeRel));
  const drawing = drawingState(workspaceRoot, safeRel);
  const snapshot = drawing.xml ? extractFcstdEmbeddedBomSnapshot(drawing.xml) : null;
  const embedded: Partial<BomFields> = snapshot?.fields ?? {};
  let sourceRel: string | null = null;
  let readonlyReason: string | null = null;
  if (drawing.readonly) {
    try { sourceRel = proposeDrawingName(workspaceRoot, safeRel, drawing.xml || "").sourceRel; }
    catch (error) { readonlyReason = error instanceof Error ? error.message : String(error); }
  }
  const fields = mergeNonEmptyFields(mergeNonEmptyFields(base, dbFields), embedded);
  // Disk intent wins over stale index/filename guesses, including deliberate empty strings.
  for (const key of snapshot?.present ?? []) fields[key] = clean(snapshot?.fields?.[key]);
  // Filename/index projections and object-display fallbacks are not saved
  // PartName/Label properties on an actual root object.
  if (Object.keys(embedded).length) {
    fields.PartName = clean(embedded.PartName);
    fields.label = clean(embedded.label);
  }
  const stat = fs.existsSync(abs) ? fs.statSync(abs) : null;
  const assemblyState = drawing.xml && !drawing.readonly ? readFcstdAssemblyState(drawing.xml) : { links: [], joint_issues: [] };
  return {
    rel_path: safeRel,
    fields,
    source_note: isFcstd
      ? "Loaded from the TypeScript FCStd reader, database, and filename hints."
      : "Loaded from filename/database hints.",
    abs_path_display: pathDisplay(abs, workspaceRoot),
    is_fcstd: isFcstd,
    document_kinds: isFcstd ? inferBomDocumentKinds(drawing.readonly ? "model.Drawing.FCStd" : `model${bomRecommendationSuffix(safeRel, embedded)}`) : null,
    embedded_warning: null,
    file_size_bytes: stat?.size ?? null,
    file_size_display: stat ? formatSize(stat.size) : null,
    bom_readonly: drawing.readonly,
    bom_source_rel: sourceRel,
    bom_readonly_reason: readonlyReason,
    assembly_links: assemblyState.links,
    assembly_joint_issues: assemblyState.joint_issues,
  };
}

export function fillRecommendedValues(workspaceRoot: string, rel: string, values: any = {}) {
  const fields = bodyToFields(rel, values);
  const fills = loadBomApplyPrefs(workspaceRoot).recommended_fill;
  const filled_keys: string[] = [];
  for (const key of ["PartNumber", "PartVersion", "TypeCode", "ModelSeries"] as const) {
    if (fields[key]) continue;
    if (!fills[key]) continue;
    fields[key] = fills[key];
    filled_keys.push(key);
  }
  return { fields, filled_keys };
}

export function composeBomLabel(fields: Partial<BomFields>, rel = fields.repo_rel_path || fields.filename || "") {
  if (bomRecommendationSuffix(rel, fields) !== ".ASSY.FCStd") return pnwComposeBomLabel(fields);
  const name = pnwNormalizeBomPartNameSuffix(clean(fields.PartName) || clean(fields.label), ".ASSY.FCStd");
  // PartName remains a plain name; only the assembly's display label carries the marker.
  return pnwComposeBomLabel({ ...fields, PartName: name ? `${name}.ASSY` : "", label: "" });
}

export function applyBomLabelFormula(workspaceRoot: string, rel: string, values: any = {}, fillEmptyFromPrefs = true) {
  requireModelBom(workspaceRoot, rel);
  let fields = bodyToFields(rel, values);
  let filled_keys: string[] = [];
  if (fillEmptyFromPrefs) {
    const filled = fillRecommendedValues(workspaceRoot, rel, fields);
    fields = filled.fields;
    filled_keys = filled.filled_keys;
  }
  assertValidPartName(fields.PartName);
  const label = composeBomLabel(fields, rel);
  if (!label) throw new Error("PartNumber and PartVersion are required to compose label");
  fields.label = label;
  return { fields, label, filled_keys };
}

function composeRecommendedFilename(fields: Partial<BomFields>, suffix: string): string {
  assertValidPartName(fields.PartName);
  return pnwComposeRecommendedBomFilename(fields, suffix);
}

function recommendValueFromHints(workspaceRoot: string, rel: string, field: string, values: any = {}): { value: string; source_note: string; forceFilled?: boolean } {
  if (values.explicit_name_source != null && typeof values.explicit_name_source !== "boolean") throw new Error("明确推荐来源选项必须是布尔值");
  if (values.explicit_name_source && field !== "PartName") throw new Error("明确推荐来源仅用于零件名称");
  const drawing = drawingState(workspaceRoot, rel);
  if (drawing.readonly) {
    if (field !== "filename") throw new Error("独立图纸不推荐 BOM 属性，请打开源模型");
    return { value: path.posix.basename(proposeDrawingName(workspaceRoot, rel, drawing.xml || "").targetRel), source_note: "源模型当前文件名" };
  }
  const current = bodyToFields(rel, values);
  const nameSource = bomNameSource(values.name_source);
  const preview = loadBomPreview(workspaceRoot, rel).fields;
  const filenameHints = inferBomFieldsFromFilename(rel);
  const prefs = loadBomApplyPrefs(workspaceRoot).recommended_fill as any;
  if (["PartName", "label", "filename"].includes(field)) {
    const snapshot = isFcstdFilename(rel) && drawing.xml ? extractFcstdEmbeddedBomSnapshot(drawing.xml) : null;
    const embedded: Partial<BomFields> = snapshot?.fields ?? {};
    if (!current.label) current.label = clean(embedded.label);
    const recommended = recommendPartName(rel, {
      ...preview, ...embedded,
      PartName: field === "PartName" ? embedded.PartName : current.PartName || embedded.PartName,
      // An explicit node action reads the saved node, not an unsaved label draft.
      label: values.explicit_name_source ? embedded.label || "" : current.label || embedded.label || "",
    }, nameSource, { objectName: snapshot?.objectName, typeId: snapshot?.typeId, explicitSource: values.explicit_name_source === true });
    if (field === "PartName") return recommended;
    current.PartName = recommended.value;
  }
  if (field === "label") return { value: composeBomLabel(current, rel), source_note: "Label formula" };
  if (field === "filename") {
    const suffix = bomRecommendationSuffix(rel, current);
    const value = composeRecommendedFilename(current, suffix);
    return { value, source_note: "Filename formula" };
  }
  if (field === "ModelSeries" && cleanUpper(current.TypeCode) === "S") {
    return { value: "", source_note: "Standard part TypeCode=S uses empty ModelSeries", forceFilled: true };
  }
  const rawValue =
    clean((preview as any)[field]) ||
    clean((filenameHints as any)[field]) ||
    clean(prefs[field]);
  const value = field === "PartName"
    ? pnwNormalizeBomPartNameSuffix(rawValue, pnwInferFcstdSuffix(rel)) : rawValue;
  const source_note = clean((preview as any)[field])
    ? "Index or embedded BOM"
    : clean((filenameHints as any)[field])
      ? "Filename hints"
      : clean(prefs[field])
        ? "Workspace memory"
        : "No recommendation";
  return { value, source_note };
}

export function recommendBomField(workspaceRoot: string, rel: string, field: string, values: any = {}) {
  const { value, source_note, forceFilled } = recommendValueFromHints(workspaceRoot, rel, field, values);
  return { field, value, source_note, filled: Boolean(forceFilled || value) };
}

export function recommendBomFieldsAll(workspaceRoot: string, rel: string, values: any = {}) {
  const working: any = { ...bodyToFields(rel, values), name_source: bomNameSource(values.name_source) };
  const results: Record<string, any> = {};
  const filled_keys: string[] = [];
  for (const field of RECOMMEND_ORDER) {
    const result = recommendBomField(workspaceRoot, rel, field, working);
    results[field] = result;
    if (result.filled) {
      working[field] = result.value;
      filled_keys.push(field);
    }
    if (cleanUpper(working.TypeCode) === "S") working.ModelSeries = "";
  }
  return { results, filled_keys };
}

export function fillBomFromFilename(_workspaceRoot: string, rel: string) {
  return { fields: inferBomFieldsFromFilename(rel) };
}

export function fillBomFromEmbedded(workspaceRoot: string, rel: string, values: any = {}) {
  const preview = loadBomPreview(workspaceRoot, rel);
  const fields = mergeNonEmptyFields(bodyToFields(rel, values), preview.fields);
  return { fields, document_kinds: preview.document_kinds };
}

export function readBomDocumentKinds(workspaceRoot: string, rel: string) {
  return { document_kinds: loadBomPreview(workspaceRoot, rel).document_kinds ?? inferBomDocumentKinds(rel) };
}

export function recommendBomFilename(workspaceRoot: string, rel: string, values: any = {}) {
  if (drawingState(workspaceRoot, rel).readonly) {
    const recommendation = recommendValueFromHints(workspaceRoot, rel, "filename", values);
    return { recommended_filename: recommendation.value, fields: bodyToFields(rel, values), suffix: ".Drawing.FCStd", filled_keys: [], hint_text: recommendation.source_note,
      matches_disk_name: recommendation.value === path.posix.basename(rel), document_kinds: inferBomDocumentKinds("model.Drawing.FCStd") };
  }
  const filled = fillRecommendedValues(workspaceRoot, rel, values);
  const fields = filled.fields;
  const document_kinds = inferBomDocumentKinds(`model${bomRecommendationSuffix(rel, fields)}`);
  const suffix = document_kinds.recommended_suffix || pnwInferFcstdSuffix(rel);
  const recommended_filename = composeRecommendedFilename(fields, suffix);
  if (!recommended_filename) throw new Error("PartNumber and PartVersion are required to recommend filename");
  return {
    recommended_filename,
    fields,
    suffix,
    filled_keys: filled.filled_keys,
    hint_text: `${path.posix.basename(rel)} -> ${recommended_filename}`,
    matches_disk_name: recommended_filename === path.posix.basename(rel),
    document_kinds,
  };
}

export async function writeBomToFcstd(workspaceRoot: string, rel: string, values: any = {}): Promise<any> {
  requireModelBom(workspaceRoot, rel);
  const { rel: safeRel, abs } = resolveUnderWorkspace(workspaceRoot, rel);
  if (!isFcstdFilename(safeRel)) throw new Error("Only .FCStd files can be written");
  const fields = bodyToFields(safeRel, values);
  const writeValues: Record<string, string> = {};
  for (const key of EDITABLE_KEYS) {
    writeValues[key] = fields[key] || "";
  }
  const result = writeFcstdEmbeddedBomFields(abs, writeValues);
  const indexUpdated = updateCadIndexEntryAfterBomWrite(workspaceRoot, safeRel, fields);
  rememberBomApplyPrefs(workspaceRoot, fields);
  return {
    status: "ok",
    rel: safeRel,
    changed: result.changed,
    index_updated: indexUpdated,
    object_name: result.objectName,
    engine: "typescript",
  };
}

export function hasUnsavedBomDocumentAttrs(baseline: any = {}, current: any = {}): boolean {
  const base = bodyToFields(clean(baseline.repo_rel_path || current.repo_rel_path || "x.FCStd"), baseline);
  const next = bodyToFields(clean(current.repo_rel_path || baseline.repo_rel_path || "x.FCStd"), current);
  return EDITABLE_KEYS.some((key) => clean((next as any)[key]) !== clean((base as any)[key]));
}

export async function renameBomFcstdFile(workspaceRoot: string, rel: string, body: any = {}) {
  const current = body?.fields && typeof body.fields === "object" ? { ...body.fields, ...body } : body;
  const baseline = body?.baseline && typeof body.baseline === "object" ? body.baseline : {};
  const targetFilename = validateBomTargetFilename(current.filename || current.new_filename);
  requireFcstdFilename(path.posix.basename(rel.replace(/\\/g, "/")));

  const bomReadonly = drawingState(workspaceRoot, rel).readonly;
  // A stale drawing form must never trigger model-attribute writes during a disk rename.
  const unsaved = !bomReadonly && hasUnsavedBomDocumentAttrs(baseline, current);
  const writeAttrsFirst = Boolean(current.write_attrs_first || current.writeAttrsFirst);
  if (unsaved && !writeAttrsFirst) {
    throw new Error("BOM attributes have unsaved changes; write them first or set write_attrs_first.");
  }

  let attrsSaved = false;
  if (unsaved && writeAttrsFirst) {
    await writeBomToFcstd(workspaceRoot, rel, current);
    attrsSaved = true;
  }

  const renamed = executeDiskFileRename(workspaceRoot, rel, { filename: targetFilename });
  const mapUpdated = updateCadIndexEntryAfterRename(workspaceRoot, rel, renamed.rel_path);
  return {
    ...renamed,
    map_updated: mapUpdated,
    attrs_saved: attrsSaved,
    bom_readonly: bomReadonly,
  };
}
