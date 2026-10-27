import { pnwAnalyzeCadIndexDocumentXml, type PnwCadXlinkRef } from "@phoenix-wing/cad-core";
import { fcstdXmlObjects } from "./fcstdLinkIdentity.js";
import { decodeCadXmlAttribute } from "../features/cad-object-info/document.js";
import { extractFcstdEmbeddedBomSnapshot } from "./fcstdDocumentXmlService.js";
import { readFcstdAssemblyState } from "./fcstdAssemblyState.js";

function tags(fragment: string, name: string): string[] {
  // '>' is legal inside a quoted XML attribute; it is not a tag terminator.
  return [...fragment.matchAll(new RegExp(`<${name}\\b(?:[^"'>]|"[^"]*"|'[^']*')*>`, "g"))].map(match => match[0]);
}
function attribute(tag: string, key: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${key}\\s*=\\s*(["'])([\\s\\S]*?)\\1`).exec(tag);
  return match ? decodeCadXmlAttribute(match[2].replace(/[\t\n\r]/g, " ")) : undefined;
}
function linkTags(fragment: string) {
  return tags(fragment, "XLink").map(tag => ({ file: attribute(tag, "file")?.trim() || "", name: attribute(tag, "name") || "", label: attribute(tag, "label")?.trim() || "" }))
    .filter(link => /\.fcstd$/i.test(link.file.replaceAll("\\", "/").split("/").at(-1)!));
}
const referenceFileKey = (file: string) => file.trim().replaceAll("\\", "/");

function withoutObjectBlocks(xml: string): string {
  const spans: Array<[number, number]> = []; let depth = 0; let start = 0;
  for (const token of xml.matchAll(/<Object\b(?:[^"'>]|"[^"]*"|'[^']*')*>|<\/Object\s*>/g)) {
    if (token[0].startsWith("</")) {
      if (--depth === 0) spans.push([start, token.index! + token[0].length]);
    } else if (!token[0].endsWith("/>")) {
      if (depth++ === 0) start = token.index!;
    }
  }
  for (const [from, to] of spans.reverse()) xml = xml.slice(0, from) + " ".repeat(to - from) + xml.slice(to);
  return xml;
}

function objectTypes(xml: string): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const tag of tags(xml, "Object")) {
    const name = attribute(tag, "name") || "", type = attribute(tag, "type") || "";
    if (!name || !type) continue;
    const types = candidates.get(name) || new Set<string>();
    types.add(type); candidates.set(name, types);
  }
  // Conflicting or absent TypeIds must not justify a source-list exception.
  return new Map([...candidates].filter(([, types]) => types.size === 1).map(([name, types]) => [name, [...types][0]]));
}

const DRAWING_SOURCE_PROPERTIES = new Set(["Source", "XSource", "Source2D", "MetadataSource"]);
const DRAWING_SOURCE_TYPES = new Set(["TechDraw::DrawViewPart", "TechDraw::DrawProjGroup", "TechDraw::DrawProjGroupItem",
  "TechDraw::DrawViewSection", "TechDraw::DrawViewDetail", "TechDraw::DrawViewDraft", "TechDraw::DrawViewArch", "TechDraw::DrawPage"]);
const DRAWING_LINK_TYPES = new Set(["App::PropertyXLink", "App::PropertyXLinkSub", "App::PropertyXLinkList", "App::PropertyXLinkSubList"]);
function ownsModelGeometry(type: string): boolean {
  // Be conservative for a model with embedded drawings: primitives, sketches,
  // meshes and assembly infrastructure must not make its links disappear.
  return type === "App::Part" || /^(?:Assembly|Part|PartDesign|Sketcher|Mesh|MeshPart|Points)::/.test(type);
}

/**
 * Host compatibility for the shared light reader's file-deduplicated projection.
 * Quantity is the number of serialized link objects, not repeated properties of
 * one object. Shared structure validation and the target resolver remain owned
 * by Wing. Quote-safe extraction decodes entities once; the shared deduplicated
 * string projection must not act as a whitelist for actual serialized paths.
 * Same-object multi-target/Link-array semantics are unsupported and fail closed.
 * Declared TechDraw source properties describe dependencies, not physical link
 * quantities. Keep those references separately; they must not multiply the BOM.
 */
export function analyzeCadIndexDocumentXmlWithInstances(xml: string) {
  const analysis = pnwAnalyzeCadIndexDocumentXml(xml);
  const semantic = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const outsideObjectData = semantic.replace(/<ObjectData\b[^>]*>[\s\S]*?<\/ObjectData>/gi, "");
  const xlinks: PnwCadXlinkRef[] = [];
  const sources = new Map<string, PnwCadXlinkRef>();
  const types = objectTypes(semantic);
  const standaloneDrawing = [...types.values()].some(type => DRAWING_SOURCE_TYPES.has(type))
    && ![...types.values()].some(ownsModelGeometry);
  // The same per-object rule applies to legacy Document/Object data, not just
  // modern ObjectData. The wrapper is only an adapter for the existing object
  // span reader; the original complete document was already validated above.
  const objects = [...fcstdXmlObjects(semantic), ...fcstdXmlObjects(`<ObjectData>${outsideObjectData}</ObjectData>`)];
  for (const object of objects) {
    const seen = new Map<string, string>();
    const labelTag = tags(object.properties.get("Label")?.content || "", "String")[0];
    const label = labelTag ? attribute(labelTag, "value")?.trim() || "" : "";
    // fcstdXmlObjects includes Object's own bare XLink tags (including tails
    // outside Properties) as property ""; child objects are masked separately.
    for (const [name, property] of object.properties) {
      const links = linkTags(property.content);
      if (DRAWING_SOURCE_TYPES.has(types.get(object.name) || "") && DRAWING_SOURCE_PROPERTIES.has(name) && DRAWING_LINK_TYPES.has(property.type)) {
        for (const link of links) if (!sources.has(referenceFileKey(link.file))) sources.set(referenceFileKey(link.file), { file: link.file, label: label || link.label });
        continue;
      }
      // Even identical list entries may be separate physical instances. A
      // repeated cached property is safe to coalesce, a list/array is not.
      if (links.length && (/^App::PropertyXLink(?:Sub)?List$/.test(property.type) || links.length > 1)) {
        throw new Error("Same-object multi-target XLink/Link-array quantity is unsupported; index not written");
      }
      for (const link of links) {
        if (seen.has(link.file)) {
          if (seen.get(link.file) !== link.name) throw new Error("Same-object multi-target XLink/Link-array quantity is unsupported; index not written");
          continue;
        }
        if (seen.size) throw new Error("Same-object multi-target XLink/Link-array quantity is unsupported; index not written");
        seen.set(link.file, link.name);
        xlinks.push({ file: link.file, label: label || link.label });
      }
    }
  }
  // Frozen older/simple XML may serialize XLink directly under Document.
  for (const link of linkTags(withoutObjectBlocks(outsideObjectData))) {
    xlinks.push({ file: link.file, label: link.label });
  }
  const bomXlinks = standaloneDrawing ? [] : [...xlinks];
  // A physical instance and its cached drawing source must not count twice.
  const linkedFiles = new Set(xlinks.map(link => referenceFileKey(link.file)));
  for (const [file, link] of sources) if (!linkedFiles.has(file)) xlinks.push(link);
  const assemblyState = readFcstdAssemblyState(xml);
  return { ...analysis, embeddedFields: Object.freeze(extractFcstdEmbeddedBomSnapshot(xml).fields || {}), xlinks, bomXlinks,
    assemblyLinks: assemblyState.links, assemblyJointIssues: assemblyState.joint_issues,
    // Filename suffixes are display hints, not proof of manufacturing role.
    // Preserve the same object-type decision already used for link quantities.
    documentRole: standaloneDrawing ? "drawing" as const : "model" as const };
}
