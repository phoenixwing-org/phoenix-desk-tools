import fs from "node:fs";
import iconv from "iconv-lite";

export type SourceTextEncoding = "utf8" | "gbk";
export type SourceTargetEncoding = "utf-8" | "gbk";

export type SourceTextPayload = {
  text: string;
  encoding: SourceTextEncoding;
  hadBom: boolean;
};

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function equalBuffers(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

export function decodeSourceBuffer(raw: Buffer): SourceTextPayload | null {
  if (raw.includes(0)) return null;
  const hadBom = raw.subarray(0, UTF8_BOM.length).equals(UTF8_BOM);
  const utf8Bytes = hadBom ? raw.subarray(UTF8_BOM.length) : raw;
  try {
    return { text: utf8Decoder.decode(utf8Bytes), encoding: "utf8", hadBom };
  } catch {
    if (hadBom) return null;
  }

  const text = iconv.decode(raw, "gbk");
  if (!equalBuffers(iconv.encode(text, "gbk"), raw)) return null;
  return { text, encoding: "gbk", hadBom: false };
}

export function encodeSourceText(payload: SourceTextPayload, text: string): Buffer {
  if (payload.encoding === "gbk") {
    const encoded = iconv.encode(text, "gbk");
    if (iconv.decode(encoded, "gbk") !== text) {
      throw new Error("The source text contains characters that cannot be represented in GBK");
    }
    return encoded;
  }
  const encoded = Buffer.from(text, "utf8");
  return payload.hadBom ? Buffer.concat([UTF8_BOM, encoded]) : encoded;
}

export function sourceTextEncodingLabel(payload: SourceTextPayload): SourceTargetEncoding {
  return payload.encoding === "gbk" ? "gbk" : "utf-8";
}

export function chooseSourceWritePayload(
  payload: SourceTextPayload,
  newText: string,
  targetEncoding: unknown = "utf-8",
): SourceTextPayload {
  if (payload.encoding === "gbk" || payload.hadBom) return payload;
  const target: SourceTextEncoding = targetEncoding === "gbk" ? "gbk" : "utf8";
  if (/[^\x00-\x7f]/.test(newText)) {
    return { ...payload, encoding: target, hadBom: false };
  }
  return payload;
}

export function readSourceText(filename: string): SourceTextPayload | null {
  try {
    return decodeSourceBuffer(fs.readFileSync(filename));
  } catch {
    return null;
  }
}

export function writeSourceText(filename: string, payload: SourceTextPayload, text: string): void {
  fs.writeFileSync(filename, encodeSourceText(payload, text));
}
