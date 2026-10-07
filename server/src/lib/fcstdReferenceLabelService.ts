import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { replaceFileAtomically } from "./fcstdDocumentXmlService.js";
import { fcstdLinkInstances } from "./fcstdLinkIdentity.js";

export type ObjectLabelPatch = {
  host_object_name: string;
  target_object_name: string;
  xlink_file_attr: string;
  old_label: string;
  link_label: string;
  document_hash?: string;
};
type LabelPatches = Record<string, string> | ObjectLabelPatch[];

export type ReferenceLabelChange = {
  xlink_file_attr: string;
  old_label: string;
  new_label: string;
  host_object_name?: string;
  target_object_name?: string;
};

export type ReferenceLabelPatchResult = {
  count: number;
  changes: ReferenceLabelChange[];
  engine: "typescript";
  backup_file?: string;
};

export type XlinkAttributePatchResult = {
  count: number;
  engine: "typescript";
};

function encodeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function patchReferenceLabelsInDocumentXml(
  xml: string,
  attrLabels: LabelPatches,
): { xml: string; changes: ReferenceLabelChange[] } {
  if (Array.isArray(attrLabels)) {
    const hash = createHash("sha256").update(xml).digest("hex");
    if (attrLabels.some(patch => patch.document_hash && patch.document_hash !== hash)) {
      throw new Error("总成内容已变化（标签或层级），请刷新预览后再应用");
    }
  }
  const instances = fcstdLinkInstances(xml);
  const selected = new Map<number, { instance: typeof instances[number]; label: string }>();
  const exact = Array.isArray(attrLabels);
  const requests = exact ? attrLabels : Object.entries(attrLabels).flatMap(([attr, label]) => {
    const matches = instances.filter(instance => instance.xlink_file_attr === attr);
    // Legacy file-only consumers must fail closed when a file supplies multiple
    // different objects. Never stamp its root label on every projection node.
    if (new Set(matches.map(instance => instance.target_object_name)).size > 1) {
      throw new Error(`同一文件引用了多个目标对象，需在装配结构逐对象修正标签：${attr}`);
    }
    return matches.map(instance => ({ ...instance, old_label: instance.link_label, link_label: label }));
  });
  for (const request of requests) {
    const matches = instances.filter(instance => instance.host_object_name === request.host_object_name
      && instance.target_object_name === request.target_object_name && instance.xlink_file_attr === request.xlink_file_attr);
    if (matches.length !== 1) throw new Error(`引用对象已变化或不唯一，请刷新预览：${request.host_object_name}`);
    const instance = matches[0];
    if (instance.link_label !== request.old_label && instance.link_label !== request.link_label) {
      throw new Error(`标签已被其他操作修改，请刷新预览：${request.host_object_name}`);
    }
    const existing = selected.get(instance.labelStart);
    if (existing && existing.label !== request.link_label) throw new Error(`同一对象收到冲突的标签：${request.host_object_name}`);
    selected.set(instance.labelStart, { instance, label: String(request.link_label) });
  }
  const changes: ReferenceLabelChange[] = [];
  let patched = xml;
  for (const { instance, label } of [...selected.values()].sort((a, b) => b.instance.labelStart - a.instance.labelStart)) {
    if (instance.link_label === label) continue;
    patched = patched.slice(0, instance.labelStart) + encodeXmlAttribute(label) + patched.slice(instance.labelStart + instance.labelLength);
    changes.push({ xlink_file_attr: instance.xlink_file_attr, old_label: instance.link_label, new_label: label,
      ...(exact ? { host_object_name: instance.host_object_name, target_object_name: instance.target_object_name } : {}) });
  }
  changes.reverse();
  return { xml: patched, changes };
}

function patchWithNode(filename: string, attrLabels: LabelPatches, backupFile?: string): ReferenceLabelPatchResult {
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
    if (backupFile) {
      fs.mkdirSync(path.dirname(backupFile), { recursive: true });
      fs.copyFileSync(filename, backupFile, fs.constants.COPYFILE_EXCL);
    }
    files["Document.xml"] = strToU8(result.xml);
    replaceFileAtomically(filename, zipSync(files, { level: 6 }));
  }
  return { count: result.changes.length, changes: result.changes, engine: "typescript",
    ...(result.changes.length && backupFile ? { backup_file: backupFile } : {}) };
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
  attrLabels: LabelPatches,
  backupFile?: string,
): ReferenceLabelPatchResult {
  if (!Object.keys(attrLabels).length) return { count: 0, changes: [], engine: "typescript" };
  return patchWithNode(filename, attrLabels, backupFile);
}

export function patchFcstdXlinkAttributes(
  filename: string,
  replacements: Record<string, string>,
): XlinkAttributePatchResult {
  if (!Object.keys(replacements).length) return { count: 0, engine: "typescript" };
  return patchXlinksWithNode(filename, replacements);
}
