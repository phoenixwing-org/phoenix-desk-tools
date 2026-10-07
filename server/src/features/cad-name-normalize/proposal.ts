import path from "node:path";
import { bomRecommendationSuffix, recommendPartName, type BomNameSource } from "../../lib/bomNameRecommendation.js";
import { pnwComposeBomLabel, pnwComposeRecommendedBomFilename, pnwInferBomDocumentKinds, type PnwCadEmbeddedBomFields } from "@phoenix-wing/cad-core";

/** Host batch policy only. Root choice, filename parsing, label and filename formula remain Wing-owned. */
export function proposeNameNormalization(rel: string, current: PnwCadEmbeddedBomFields, types: Record<string, string>, hints: { index: Record<string, unknown>; filename: Record<string, unknown> }, fallback: BomNameSource = "label") {
  const kinds = pnwInferBomDocumentKinds(`model${bomRecommendationSuffix(rel, current)}`);
  if (kinds.drawing) throw new Error("图纸不作为名称真源，请打开源模型");
  for (const field of ["PartName", "Label"]) if (types[field] && types[field] !== "App::PropertyString") throw new Error(`${field} 不是字符串属性，请到文件详情确认`);
  const fields = { PartNumber: "", PartVersion: "", TypeCode: "", ModelSeries: "", PartName: "" };
  for (const field of ["PartNumber", "PartVersion", "TypeCode", "ModelSeries"] as const) {
    const values = [current[field], hints.filename[field], hints.index[field]].map(v => String(v ?? "").trim()).filter(Boolean);
    const normalized = values.map(v => field === "TypeCode" || field === "ModelSeries" ? v.toUpperCase() : v);
    const expected = normalized[0] || "";
    if (normalized.some(v => v !== expected)) throw new Error(`${field} 属性/文件名/索引来源冲突，需先确认`);
    fields[field] = expected;
  }
  if (!/^\d+$/.test(fields.PartNumber) || !/^\d+$/.test(fields.PartVersion)) throw new Error("缺少可靠的数字零件号/版本，请先补齐属性或确认文件名");
  if (!/^[HSR]$/.test(fields.TypeCode)) throw new Error("缺少可靠的 H/S/R 类型码，请先补齐属性或确认文件名");
  // The actual embedded property stays authoritative, regardless of fallback selection.
  const embeddedName = current.PartName.trim();
  if (!kinds.assembly && /\.(?:drawing|fcstd)$/i.test(embeddedName) && !/\.assy\.fcstd$/i.test(embeddedName)) throw new Error("属性 PartName 中的名称包含文件类型后缀，请在文件详情确认");
  const recommendation = recommendPartName(rel, { ...current, ...fields, PartName: current.PartName }, fallback);
  const nameSource = recommendation.source_note;
  const PartName = recommendation.value;
  if (!PartName || /[<>:"/\\|?*\x00-\x1f]/.test(PartName) || PartName.includes("..") || /[. ]$/.test(PartName)) throw new Error(`${nameSource}中的名称为空或包含不安全的文件名字符，请在文件详情确认`);
  if (/\.(?:assy|drawing|fcstd)$/i.test(PartName)) throw new Error(`${nameSource}中的名称包含文件类型后缀，请在文件详情确认`);
  fields.PartName = PartName;
  const nextLabel = pnwComposeBomLabel({ ...fields, PartName: kinds.assembly ? `${PartName}.ASSY` : PartName });
  const filename = pnwComposeRecommendedBomFilename(fields, kinds.recommended_suffix);
  if (!filename || filename.length > 255 || Buffer.byteLength(filename) > 255) throw new Error("推荐文件名为空或超过 255 字节，请人工确认");
  const targetRel = path.posix.join(path.posix.dirname(rel), filename);
  const warnings: string[] = [];
  if (!embeddedName) warnings.push(`PartName 未设定，将从${nameSource}补全；请确认预览`);
  if (/\.assy\.assy\.fcstd$/i.test(rel)) warnings.push("原文件名包含重复 .ASSY.ASSY；PartName 使用纯名称，Label 与文件名只保留一个装配后缀");
  if (embeddedName && current.PartName !== PartName) warnings.push("仅规范 PartName 首尾空白及装配末尾后缀，保留名称正文；请确认预览");
  return { PartName, label: nextLabel, filename, targetRel, warnings };
}
