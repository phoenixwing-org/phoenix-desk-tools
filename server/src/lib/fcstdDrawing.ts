import path from "node:path";
import { pnwExtractXlinksFromDocumentXml } from "@phoenix-wing/cad-core";
import { fcstdFingerprint, fcstdWorkspace, readFcstdBatchArchive, safeFcstdPath } from "./fcstdBatchFiles.js";
import { fcstdLinkInstances, xmlAttribute } from "./fcstdLinkIdentity.js";

/** A model that owns geometry/assembly nodes may also contain TechDraw pages. */
export function isStandaloneDrawing(rel: string, xml: string | null = null) {
  if (/\.drawing\.fcstd$/i.test(rel)) return true;
  const semantic = (xml || "").replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const types = [...semantic.matchAll(/<Object\b[^>]*>/g)].map(([tag]) => xmlAttribute(tag, "type"));
  return types.some(type => type.startsWith("TechDraw::"))
    && !types.some(type => type === "App::Part" || type === "Assembly::AssemblyObject" || type.startsWith("PartDesign::") || /^Part::Feature(?:Python)?$/.test(type));
}

/** null means a model: preserve its strict label consistency checks. */
export function drawingLinkLabelAttributes(rel: string, xml: string): Set<string> | null {
  return isStandaloneDrawing(rel, xml) ? new Set(fcstdLinkInstances(xml).map(item => item.xlink_file_attr)) : null;
}

/** Follow a unique, existing, in-workspace model; never guess from similar names. */
export function proposeDrawingName(root: string, rel: string, xml: string) {
  const sources = new Set<string>();
  for (const link of pnwExtractXlinksFromDocumentXml(xml)) {
    const file = link.file.replace(/\\/g, "/");
    if (!file) continue;
    if (path.posix.isAbsolute(file) || /^[A-Za-z]:/.test(file)) throw new Error("图纸包含绝对引用，请先修正为工作空间内的相对引用");
    const source = path.posix.normalize(path.posix.join(path.posix.dirname(rel), file));
    if (source === ".." || source.startsWith("../") || !/\.fcstd$/i.test(source)) throw new Error("图纸源模型不在工作空间内或不是 FCStd");
    sources.add(source);
  }
  if (sources.size !== 1) throw new Error(sources.size ? "图纸关联多个源模型，无法确定唯一文件名；请人工确认" : "未找到图纸的外部源模型引用，请人工确认");
  const sourceRel = [...sources][0];
  if (sourceRel === rel) throw new Error("图纸引用自身，无法确定源模型");
  const archive = readFcstdBatchArchive(safeFcstdPath(fcstdWorkspace(root), sourceRel));
  if (isStandaloneDrawing(sourceRel, archive.xml)) throw new Error("引用目标仍是图纸，请先确认源模型");
  const filename = path.posix.basename(sourceRel).replace(/(?:\.ASSY)?\.FCStd$/i, ".Drawing.FCStd");
  if (Buffer.byteLength(filename) > 255) throw new Error("图纸目标文件名超过 255 字节");
  return { sourceRel, sourceHash: fcstdFingerprint(archive.bytes), targetRel: path.posix.join(path.posix.dirname(rel), filename) };
}
