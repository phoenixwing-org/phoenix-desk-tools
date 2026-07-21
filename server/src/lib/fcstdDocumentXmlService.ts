import fs from "node:fs";
import path from "node:path";
import {
  pnwExtractEmbeddedBomFieldsFromDocumentXml,
  pnwPatchEmbeddedBomFieldsInDocumentXml,
  type PnwCadEmbeddedBomFields,
} from "@phoenix-wing/cad-core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export type FcstdEmbeddedBomWriteResult = {
  changed: boolean;
  objectName: string;
};

/** 写临时文件、保留原件作短暂备份，再原子替换；失败时恢复原件。 */
export function replaceFileAtomically(filename: string, bytes: Uint8Array): void {
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

/** Node adapter：只解压 Document.xml，领域字段解析由 Wing cad-core 唯一负责。 */
export function extractDocumentXmlFromFcstdBytes(raw: Uint8Array): string | null {
  try {
    const files = unzipSync(raw, {
      filter: (file) => file.name.replace(/\\/g, "/") === "Document.xml",
    });
    const bytes = files["Document.xml"];
    return bytes ? strFromU8(bytes) : null;
  } catch {
    return null;
  }
}

export function readFcstdDocumentXml(filePath: string): string | null {
  try {
    return extractDocumentXmlFromFcstdBytes(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

export async function readFcstdDocumentXmlAsync(filePath: string): Promise<string | null> {
  try {
    return extractDocumentXmlFromFcstdBytes(await fs.promises.readFile(filePath));
  } catch {
    return null;
  }
}

export function readFcstdEmbeddedBomFields(filePath: string): PnwCadEmbeddedBomFields | null {
  const xml = readFcstdDocumentXml(filePath);
  return xml ? pnwExtractEmbeddedBomFieldsFromDocumentXml(xml) : null;
}

export async function readFcstdEmbeddedBomFieldsAsync(
  filePath: string,
): Promise<PnwCadEmbeddedBomFields | null> {
  const xml = await readFcstdDocumentXmlAsync(filePath);
  return xml ? pnwExtractEmbeddedBomFieldsFromDocumentXml(xml) : null;
}

/** Node 宿主只负责 ZIP 与文件 I/O；根 BOM 对象选择和 XML 更新由 Wing cad-core 负责。 */
export function writeFcstdEmbeddedBomFields(
  filePath: string,
  fields: Partial<PnwCadEmbeddedBomFields>,
): FcstdEmbeddedBomWriteResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(fs.readFileSync(filePath)));
  } catch (error: any) {
    throw new Error(`Invalid FCStd/ZIP: ${filePath} (${error.message || error})`);
  }
  const documentBytes = files["Document.xml"];
  if (!documentBytes) throw new Error(`Document.xml is missing from ${filePath}`);
  const result = pnwPatchEmbeddedBomFieldsInDocumentXml(strFromU8(documentBytes), fields);
  if (!result) throw new Error(`No writable BOM root object found in ${filePath}`);
  if (result.changed) {
    files["Document.xml"] = strToU8(result.xml);
    replaceFileAtomically(filePath, zipSync(files, { level: 6 }));
  }
  return { changed: result.changed, objectName: result.objectName };
}
