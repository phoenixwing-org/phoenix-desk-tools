import { pnwInferBomFieldsFromFilename, pnwInferFcstdSuffix, pnwNormalizeBomPartNameSuffix } from "@phoenix-wing/cad-core";

export type BomNameSource = "label" | "filename";
export type BomNameRootContext = { objectName?: string; typeId?: string; explicitSource?: boolean };
export function bomNameSource(value: unknown): BomNameSource {
  if (value === undefined || value === "label") return "label";
  if (value === "filename") return "filename";
  throw new Error("名称补全来源必须是标签名或文件名");
}
const clean = (value: unknown) => String(value ?? "").trim();

export class InvalidPartNameError extends Error {
  constructor(readonly sourceNote: string) {
    super(`${sourceNote}中的零件名 PartName 为空或仅为一个英文字母，禁止推荐或批量改名；请人工填写有效零件名`);
    this.name = "InvalidPartNameError";
  }
}

/** Validate the business name, not its part number, type code or assembly suffix. */
export function assertValidPartName(value: unknown, sourceNote = "属性 PartName") {
  const name = pnwNormalizeBomPartNameSuffix(clean(value), ".ASSY.FCStd").normalize("NFKC").trim();
  if (!name || /^[a-z]$/i.test(name)) throw new InvalidPartNameError(sourceNote);
}

/** Keep an explicit assembly marker on the root node when a legacy filename lacks it. */
export function bomRecommendationSuffix(rel: string, fields: Record<string, unknown>) {
  const suffix = pnwInferFcstdSuffix(rel);
  if (suffix === ".Drawing.FCStd" || suffix === ".ASSY.FCStd") return suffix;
  return [fields.PartName, fields.label].some(value => /\.assy(?:\.fcstd)?$/i.test(clean(value))) ? ".ASSY.FCStd" : suffix;
}

/** Strip only a structured identity prefix; do not split or translate a plain display name. */
function labelName(label: string, fields: Record<string, unknown>) {
  const numbered = /^\d+\.\d+[A-Za-z0-9]*-(.*)$/s.exec(label);
  const number = clean(fields.PartNumber);
  let name = numbered?.[1] ?? (number && label.startsWith(`${number}-`) ? label.slice(number.length + 1) : label);
  if (name === label) return name;
  const type = clean(fields.TypeCode).toUpperCase();
  const model = clean(fields.ModelSeries);
  const prefix = type === "S" ? "S-" : type && model ? `${type}-${model}-` : "";
  if (prefix && name.toUpperCase().startsWith(prefix.toUpperCase())) name = name.slice(prefix.length);
  return name;
}

/** Actual PartName wins; an index projection is never proof that the property exists. */
export function recommendPartName(rel: string, current: Record<string, unknown>, source: BomNameSource = "label", context: BomNameRootContext = {}) {
  const hints = pnwInferBomFieldsFromFilename(rel);
  // Explicit row actions select their named source, without changing the
  // default PartName-first policy used by bulk/default recommendations.
  const embedded = context.explicitSource ? "" : clean(current.PartName);
  const label = clean(current.label);
  const defaultBody = context.typeId === "PartDesign::Body"
    && /^Body\d*$/.test(context.objectName || "") && label === context.objectName;
  if (context.explicitSource && source === "label" && (!label || defaultBody)) {
    throw new Error("节点标签为空或为默认 Body 名称，无法推荐有效零件名；请从文件名推荐或手动填写");
  }
  const fields = { ...hints, ...Object.fromEntries(Object.entries(current).filter(([, value]) => clean(value))) };
  const fromLabel = source === "label" && !!label && !embedded && !defaultBody;
  const raw = embedded || (fromLabel ? labelName(label, fields) : hints.PartName);
  // PartName is always a plain business name, even when an older filename
  // lacks the assembly marker carried by its node Label or PartName.
  const suffix = /\.assy(?:\.fcstd)?$/i.test(raw) ? ".ASSY.FCStd" : bomRecommendationSuffix(rel, current);
  const value = pnwNormalizeBomPartNameSuffix(raw, suffix);
  const source_note = embedded ? "属性 PartName" : fromLabel ? "标签名" : source === "label"
    ? defaultBody ? "默认节点标签，从文件名补全" : "标签为空，从文件名补全" : "文件名";
  // Invalid explicit properties or selected sources require review, never silent fallback.
  assertValidPartName(value, source_note);
  return { value, source_note };
}
