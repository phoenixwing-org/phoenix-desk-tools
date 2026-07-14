import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { resolveNativeTool } from "./nativeToolService.js";

export type ReferenceLabelChange = {
  xlink_file_attr: string;
  old_label: string;
  new_label: string;
};

export type ReferenceLabelPatchResult = {
  count: number;
  changes: ReferenceLabelChange[];
  engine: "rust" | "node-fallback";
};

export type XlinkAttributePatchResult = {
  count: number;
  engine: "rust" | "node-fallback";
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

function replaceFileAtomically(filename: string, bytes: Uint8Array): void {
  const token = `${process.pid}-${Date.now()}`;
  const dir = path.dirname(filename);
  const base = path.basename(filename);
  const temp = path.join(dir, `.${base}.phoenix-${token}.tmp`);
  const backup = path.join(dir, `.${base}.phoenix-${token}.backup`);
  fs.writeFileSync(temp, bytes);
  try {
    fs.renameSync(filename, backup);
    try {
      fs.renameSync(temp, filename);
    } catch (error) {
      fs.renameSync(backup, filename);
      throw error;
    }
    fs.rmSync(backup, { force: true });
  } finally {
    fs.rmSync(temp, { force: true });
  }
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
  return { count: result.changes.length, changes: result.changes, engine: "node-fallback" };
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
  return { count: result.count, engine: "node-fallback" };
}

function patchXlinksWithRust(
  executable: string,
  filename: string,
  replacements: Record<string, string>,
): XlinkAttributePatchResult {
  const args = Object.entries(replacements).map(([oldAttr, newAttr]) => `${oldAttr}=${newAttr}`);
  const raw = execFileSync(executable, ["patch", filename, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  const parsed = JSON.parse(raw);
  return { count: Number(parsed?.count || 0), engine: "rust" };
}

function patchWithRust(
  executable: string,
  filename: string,
  attrLabels: Record<string, string>,
): ReferenceLabelPatchResult {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-label-patch-"));
  const jobFile = path.join(tempDir, "labels.json");
  try {
    fs.writeFileSync(jobFile, `${JSON.stringify(attrLabels)}\n`, "utf8");
    const raw = execFileSync(executable, ["patch-labels", filename, jobFile], {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });
    const parsed = JSON.parse(raw);
    const changes = Array.isArray(parsed?.changes) ? parsed.changes.map((change: any) => ({
      xlink_file_attr: String(change?.xlink_file_attr || ""),
      old_label: String(change?.old_label || ""),
      new_label: String(change?.new_label || ""),
    })) : [];
    return { count: Number(parsed?.count || changes.length), changes, engine: "rust" };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function patchFcstdReferenceLabels(
  filename: string,
  attrLabels: Record<string, string>,
  options: { forceNodeFallback?: boolean } = {},
): ReferenceLabelPatchResult {
  if (!Object.keys(attrLabels).length) return { count: 0, changes: [], engine: "node-fallback" };
  const executable = options.forceNodeFallback ? null : resolveNativeTool("fcstd-xlink");
  if (executable) return patchWithRust(executable, filename, attrLabels);
  return patchWithNode(filename, attrLabels);
}

export function patchFcstdXlinkAttributes(
  filename: string,
  replacements: Record<string, string>,
  options: { forceNodeFallback?: boolean } = {},
): XlinkAttributePatchResult {
  if (!Object.keys(replacements).length) return { count: 0, engine: "node-fallback" };
  const canUseCli = !Object.keys(replacements).some((oldAttr) => oldAttr.includes("="));
  const executable = options.forceNodeFallback || !canUseCli ? null : resolveNativeTool("fcstd-xlink");
  if (executable) return patchXlinksWithRust(executable, filename, replacements);
  return patchXlinksWithNode(filename, replacements);
}
