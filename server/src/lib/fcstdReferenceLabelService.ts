import fs from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { replaceFileAtomically } from "./fcstdDocumentXmlService.js";

export type ReferenceLabelChange = {
  xlink_file_attr: string;
  old_label: string;
  new_label: string;
};

export type ReferenceLabelPatchResult = {
  count: number;
  changes: ReferenceLabelChange[];
  engine: "typescript";
};

export type XlinkAttributePatchResult = {
  count: number;
  engine: "typescript";
};

function objectBlockSpan(xml: string, position: number): [number, number] | null {
  const objectDataStart = xml.indexOf("<ObjectData");
  if (objectDataStart < 0 || position < objectDataStart) return null;
  const closeAt = xml.indexOf("</ObjectData>", objectDataStart);
  const objectDataEnd = closeAt < 0 ? xml.length : closeAt + "</ObjectData>".length;
  const tokenRe = /<Object(?:\s[^>]*)?>|<\/Object>/g;
  tokenRe.lastIndex = objectDataStart;
  const stack: number[] = [];
  let best: [number, number] | null = null;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(xml)) && match.index < objectDataEnd) {
    const end = match.index + match[0].length;
    if (match[0].startsWith("</")) {
      const start = stack.pop();
      if (start != null && start <= position && position < end && (!best || start > best[0])) {
        best = [start, end];
      }
    } else {
      stack.push(match.index);
    }
  }
  return best;
}

function encodeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function patchReferenceLabelsInDocumentXml(
  xml: string,
  attrLabels: Record<string, string>,
): { xml: string; changes: ReferenceLabelChange[] } {
  const xlinkRe = /<XLink\s+file="([^"]*)"/g;
  const blocks = new Map<string, { start: number; end: number; attr: string; label: string }>();
  let match: RegExpExecArray | null;
  while ((match = xlinkRe.exec(xml))) {
    const attr = match[1];
    if (!Object.prototype.hasOwnProperty.call(attrLabels, attr)) continue;
    const span = objectBlockSpan(xml, match.index);
    if (!span) continue;
    blocks.set(`${span[0]}:${span[1]}`, {
      start: span[0],
      end: span[1],
      attr,
      label: String(attrLabels[attr] ?? ""),
    });
  }

  let patched = xml;
  const changes: ReferenceLabelChange[] = [];
  const labelRe = /(<Property\s+name="Label"\s+type="App::PropertyString"[^>]*>\s*<String\s+value=")([^"]*)(")/s;
  const ordered = [...blocks.values()].sort((left, right) => right.start - left.start);
  for (const blockInfo of ordered) {
    const block = patched.slice(blockInfo.start, blockInfo.end);
    const labelMatch = labelRe.exec(block);
    if (!labelMatch || labelMatch.index == null) continue;
    const oldRaw = labelMatch[2];
    const encoded = encodeXmlAttribute(blockInfo.label);
    if (oldRaw === encoded) continue;
    const valueStart = blockInfo.start + labelMatch.index + labelMatch[1].length;
    patched = patched.slice(0, valueStart) + encoded + patched.slice(valueStart + oldRaw.length);
    changes.push({
      xlink_file_attr: blockInfo.attr,
      old_label: decodeXmlAttribute(oldRaw),
      new_label: blockInfo.label,
    });
  }
  changes.reverse();
  return { xml: patched, changes };
}

function patchWithNode(filename: string, attrLabels: Record<string, string>): ReferenceLabelPatchResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(fs.readFileSync(filename)));
  } catch (error: any) {
    throw new Error(`Invalid FCStd/ZIP: ${filename} (${error.message || error})`);
  }
  const documentBytes = files["Document.xml"];
  if (!documentBytes) throw new Error(`Document.xml is missing from ${filename}`);
  const result = patchReferenceLabelsInDocumentXml(strFromU8(documentBytes), attrLabels);
  if (result.changes.length) {
    files["Document.xml"] = strToU8(result.xml);
    replaceFileAtomically(filename, zipSync(files, { level: 6 }));
  }
  return { count: result.changes.length, changes: result.changes, engine: "typescript" };
}

export function patchXlinkAttributesInDocumentXml(
  xml: string,
  replacements: Record<string, string>,
): { xml: string; count: number } {
  let count = 0;
  const patched = xml.replace(
    /(<XLink\s+file=")([^"]*)(")/g,
    (whole, prefix: string, oldAttr: string, suffix: string) => {
      if (!Object.prototype.hasOwnProperty.call(replacements, oldAttr)) return whole;
      count += 1;
      return `${prefix}${encodeXmlAttribute(String(replacements[oldAttr] ?? ""))}${suffix}`;
    },
  );
  return { xml: patched, count };
}

function patchXlinksWithNode(filename: string, replacements: Record<string, string>): XlinkAttributePatchResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(fs.readFileSync(filename)));
  } catch (error: any) {
    throw new Error(`Invalid FCStd/ZIP: ${filename} (${error.message || error})`);
  }
  const documentBytes = files["Document.xml"];
  if (!documentBytes) throw new Error(`Document.xml is missing from ${filename}`);
  const result = patchXlinkAttributesInDocumentXml(strFromU8(documentBytes), replacements);
  if (result.count) {
    files["Document.xml"] = strToU8(result.xml);
    replaceFileAtomically(filename, zipSync(files, { level: 6 }));
  }
  return { count: result.count, engine: "typescript" };
}

export function patchFcstdReferenceLabels(
  filename: string,
  attrLabels: Record<string, string>,
): ReferenceLabelPatchResult {
  if (!Object.keys(attrLabels).length) return { count: 0, changes: [], engine: "typescript" };
  return patchWithNode(filename, attrLabels);
}

export function patchFcstdXlinkAttributes(
  filename: string,
  replacements: Record<string, string>,
): XlinkAttributePatchResult {
  if (!Object.keys(replacements).length) return { count: 0, engine: "typescript" };
  return patchXlinksWithNode(filename, replacements);
}
