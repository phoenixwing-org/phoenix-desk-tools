import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import {
  chooseSourceWritePayload,
  decodeSourceBuffer,
  encodeSourceText,
  sourceTextEncodingLabel,
} from "./sourceTextCodec.js";

describe("sourceTextCodec", () => {
  it("round-trips UTF-8 with and without BOM", () => {
    const plain = decodeSourceBuffer(Buffer.from("hello 中文\n", "utf8"));
    expect(plain).toMatchObject({ text: "hello 中文\n", encoding: "utf8", hadBom: false });
    expect(encodeSourceText(plain!, plain!.text)).toEqual(Buffer.from("hello 中文\n", "utf8"));

    const bomBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("hello\n")]);
    const bom = decodeSourceBuffer(bomBytes);
    expect(bom).toMatchObject({ text: "hello\n", encoding: "utf8", hadBom: true });
    expect(encodeSourceText(bom!, bom!.text)).toEqual(bomBytes);
  });

  it("round-trips GBK source text", () => {
    const bytes = iconv.encode("// 中文注释\r\nclass Foo {};\r\n", "gbk");
    const payload = decodeSourceBuffer(bytes);
    expect(payload).toMatchObject({ text: "// 中文注释\r\nclass Foo {};\r\n", encoding: "gbk", hadBom: false });
    expect(encodeSourceText(payload!, payload!.text)).toEqual(bytes);
  });

  it("rejects binary and refuses lossy GBK writes", () => {
    expect(decodeSourceBuffer(Buffer.from([0x41, 0, 0x42]))).toBeNull();
    expect(decodeSourceBuffer(Buffer.from([0x81]))).toBeNull();
    expect(decodeSourceBuffer(Buffer.from([0xef, 0xbb, 0xbf, 0xff]))).toBeNull();
    const payload = decodeSourceBuffer(iconv.encode("中文", "gbk"))!;
    expect(() => encodeSourceText(payload, "emoji: \u{1f600}")).toThrow(/cannot be represented in GBK/);
  });

  it("preserves source encoding unless UTF-8 text requires the selected target", () => {
    const ascii = decodeSourceBuffer(Buffer.from("OldName\n", "utf8"))!;
    const gbkTarget = chooseSourceWritePayload(ascii, "新名称\n", "gbk");
    expect(sourceTextEncodingLabel(gbkTarget)).toBe("gbk");
    expect(iconv.decode(encodeSourceText(gbkTarget, "新名称\n"), "gbk")).toBe("新名称\n");

    const utf8Bom = decodeSourceBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("OldName\n")]))!;
    expect(chooseSourceWritePayload(utf8Bom, "新名称\n", "gbk")).toMatchObject({ encoding: "utf8", hadBom: true });

    const gbk = decodeSourceBuffer(iconv.encode("旧名称\n", "gbk"))!;
    expect(chooseSourceWritePayload(gbk, "新名称\n", "utf-8")).toMatchObject({ encoding: "gbk", hadBom: false });
  });
});
