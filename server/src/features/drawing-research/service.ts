import fs from "node:fs";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { pnwExtractXlinksFromDocumentXml } from "@phoenix-wing/cad-core";
import { fcstdWorkspace, safeFcstdPath, readFcstdBatchArchive, fcstdFingerprint } from "../../lib/fcstdBatchFiles.js";
import { fcstdXmlObjects, objectString, xmlAttribute } from "../../lib/fcstdLinkIdentity.js";
import { isStandaloneDrawing } from "../../lib/fcstdDrawing.js";
import { runtimeUserDataDir } from "../../lib/appRuntimePaths.js";

function objects(xml: string) {
  const clean = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  return [...(clean.match(/<Objects\b[^>]*>([\s\S]*?)<\/Objects>/)?.[1] || "").matchAll(/<Object\b[^>]*>/g)].map(([tag]) => ({ name: xmlAttribute(tag, "name"), type: xmlAttribute(tag, "type") }));
}
export function drawingFacts(xml: string) {
  const types = objects(xml), data = fcstdXmlObjects(xml);
  return { pages: types.filter(o => o.type === "TechDraw::DrawPage").map(o => o.name), views: types.filter(o => /^TechDraw::Draw(?:ViewPart|ProjGroupItem|ViewSection|ViewDetail)$/.test(o.type)).length,
    dimensions: types.filter(o => o.type === "TechDraw::DrawViewDimension").length,
    templates: data.filter(o => types.some(t => t.name === o.name && t.type === "TechDraw::DrawSVGTemplate")).map(o => ({ object: o.name, stored_path: objectString(o, "Template"), embedded: xmlAttribute(o.properties.get("PageResult")?.content.match(/<FileIncluded\b[^>]*>/)?.[0] || "", "file") })) };
}
export function sourceNodes(xml: string) {
  const data = fcstdXmlObjects(xml), grouped = new Set(data.flatMap(o => [...(o.properties.get("Group")?.content || "").matchAll(/<Link\b[^>]*>/g)].map(([tag]) => xmlAttribute(tag, "value"))));
  return objects(xml).filter(o => /^(App::Part|Assembly::AssemblyObject|PartDesign::Body|Part::Feature(?:Python)?|App::Link)$/.test(o.type) && !grouped.has(o.name)).map(o => ({ ...o, label: objectString(data.find(d => d.name === o.name) || { name: o.name, properties: new Map() }, "Label") || o.name }));
}
function installationTemplates() {
  let install = "";
  try { install = String(JSON.parse(fs.readFileSync(path.join(runtimeUserDataDir(), "launcher-prefs.json"), "utf8")).freecad_dir || ""); } catch { /* optional launcher preference */ }
  const candidates = [install && path.join(install, "Contents/Resources/share/Mod/TechDraw/Templates"), install && path.join(install, "data/Mod/TechDraw/Templates"), install && path.join(install, "Mod/TechDraw/Templates"), "/Applications/FreeCAD.app/Contents/Resources/share/Mod/TechDraw/Templates", "/usr/share/freecad/Mod/TechDraw/Templates", "/usr/share/freecad/data/Mod/TechDraw/Templates"];
  return candidates.find(p => p && fs.existsSync(p)) || "";
}
export function templateCatalog(requested = "") {
  const candidate = requested.trim() || installationTemplates();
  if (!candidate) return { root: "", items: [] as Array<{ rel: string; family: string; width: string; height: string }> };
  if (!path.isAbsolute(candidate)) throw new Error("模板目录须为绝对路径");
  const root = fs.realpathSync(candidate);
  if (!fs.statSync(root).isDirectory()) throw new Error("模板路径不是目录");
  const items: Array<{ rel: string; family: string; width: string; height: string }> = [], stack = [root]; let visited = 0;
  while (stack.length) for (const item of fs.readdirSync(stack.pop()!, { withFileTypes: true })) {
    if (++visited > 4000) throw new Error("模板目录超过 4000 项，请选择具体模板系列目录");
    const file = path.join(item.parentPath, item.name);
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) { if (!item.name.startsWith(".")) stack.push(file); continue; }
    if (!item.isFile() || !/\.svg$/i.test(item.name) || fs.statSync(file).size > 2 * 1024 * 1024) continue;
    const tag = fs.readFileSync(file, "utf8").match(/<svg\b[^>]*>/)?.[0];
    if (!tag) continue;
    const rel = path.relative(root, file).replace(/\\/g, "/");
    items.push({ rel, family: path.posix.dirname(rel) === "." ? "当前目录" : path.posix.dirname(rel), width: xmlAttribute(tag, "width"), height: xmlAttribute(tag, "height") });
  }
  return { root, items: items.sort((a, b) => a.rel.localeCompare(b.rel)) };
}
export async function inspectDrawing(workspace: string, rel: string, templateRoot = "") {
  const root = fcstdWorkspace(workspace), source = safeFcstdPath(root, rel);
  if (!/\.fcstd$/i.test(rel)) throw new Error("请选择 FCStd 模型");
  const archive = readFcstdBatchArchive(source), sourceRel = path.relative(root, source).replace(/\\/g, "/");
  if (isStandaloneDrawing(sourceRel, archive.xml)) throw new Error("请从源零件或总成的详情进入出图研究");
  const stem = path.posix.basename(sourceRel).replace(/(?:\.ASSY)?\.FCStd$/i, ""), partKey = stem.match(/^\d+\.\d+(?=[^\d]|$)/)?.[0] || "";
  const expected = path.posix.join(path.posix.dirname(sourceRel), stem + ".Drawing.FCStd");
  const drawings: Array<{ rel: string; relation: "linked" | "name"; source_labels: string[] } & ReturnType<typeof drawingFacts>> = [], pdfs: string[] = [], warnings: string[] = [];
  const stack = [root]; let count = 0, inspected = 0;
  outer: while (stack.length) {
    const dir = stack.pop()!;
    for (const item of fs.readdirSync(safeFcstdPath(root, path.relative(root, dir)), { withFileTypes: true })) {
      if (++count > 20000) { warnings.push("扫描达到 20000 项上限，结果可能不完整"); break outer; }
      if (count % 50 === 0) await setImmediate();
      if (item.isSymbolicLink()) continue;
      const file = path.join(dir, item.name), candidate = path.relative(root, file).replace(/\\/g, "/");
      if (item.isDirectory()) { if (!item.name.startsWith(".") && !["node_modules", "__pycache__"].includes(item.name)) stack.push(file); continue; }
      if (!item.isFile()) continue;
      const sameKey = partKey ? item.name.startsWith(partKey) && !/^\d/.test(item.name.slice(partKey.length)) : item.name.startsWith(stem + ".");
      if (/\.pdf$/i.test(item.name) && sameKey) pdfs.push(candidate);
      if (!/\.drawing\.fcstd$/i.test(item.name) && !(sameKey && /\.fcstd$/i.test(item.name))) continue;
      if (candidate === sourceRel) continue;
      if (++inspected > 1000) { warnings.push("图纸候选达到 1000 个上限，结果可能不完整"); break outer; }
      try {
        const xml = readFcstdBatchArchive(safeFcstdPath(root, candidate)).xml;
        if (!isStandaloneDrawing(candidate, xml)) continue;
        const links = pnwExtractXlinksFromDocumentXml(xml).filter(link => {
          if (!link.file) return false;
          try { return safeFcstdPath(root, path.posix.join(path.posix.dirname(candidate), link.file.replace(/\\/g, "/"))) === source; } catch { return false; }
        });
        if (links.length || sameKey) drawings.push({ rel: candidate, relation: links.length ? "linked" : "name", source_labels: [...new Set(links.map(link => link.label))], ...drawingFacts(xml) });
      } catch (error) { warnings.push(`${candidate}：${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  return { source: sourceRel, source_hash: fcstdFingerprint(archive.bytes), nodes: sourceNodes(archive.xml), expected_drawing: expected, drawings, pdfs: pdfs.sort(), templates: templateCatalog(templateRoot), warnings, coverage: "当前工作空间：Drawing.FCStd 与同编号 FCStd；PDF 仅按名称列为候选，未确认版次" };
}
export type DrawingResearch = Awaited<ReturnType<typeof inspectDrawing>>;
