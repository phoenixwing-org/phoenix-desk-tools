import { describe, expect, it } from "vitest";
import {
  CAD_BOM_TRANSFER_MAX_BYTES,
  CAD_BOM_TRANSFER_SCHEMA,
  CadBomTransferValidationError,
  cadBomTransferPayloadHash,
  canonicalCadBomTransferJson,
  normalizeCadBomTransferEnvelope,
  parseCadBomTransferEnvelope,
} from "./envelope.js";

// Independent metadata-only fixture; no CAD file, inventory, geometry or database.
function part(partNo = "META-HOST") {
  return { partNo, revision: "A", name: "Independent metadata", type: "", term: "", source: "", description: "", attributes: {} as Record<string, string> };
}
function item(partNo = "META-CHILD") {
  return { partNo, revision: "A", qty: 2, attributes: {} as Record<string, string> };
}
function bom(partNo = "META-HOST", child = "META-CHILD") {
  return { bomKey: `${partNo}@A`, partNo, revision: "A", name: "Independent relation", description: "", items: [item(child)], attributes: {} as Record<string, string> };
}
function fixture() {
  const result = {
    schema: CAD_BOM_TRANSFER_SCHEMA,
    schemaVersion: 1,
    transferId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    createdAt: "2025-01-02T03:04:05.000Z",
    producer: { id: "kt-auto-cad", version: "0.2.0" },
    workspace: { schemaVersion: 13, fingerprint: `sha256:${"a".repeat(64)}`, scanId: "opaque-historical-scan", scannedAt: "2025-01-02T03:04:05.000Z" },
    payloadHash: "",
    parts: [part(), part("META-CHILD")],
    boms: [bom()],
    attachments: [] as [],
  };
  return seal(result);
}
type Fixture = ReturnType<typeof fixture>;
function seal<T extends { parts: ReturnType<typeof part>[]; boms: ReturnType<typeof bom>[]; attachments: []; payloadHash: string }>(value: T): T {
  value.payloadHash = cadBomTransferPayloadHash(value);
  return value;
}
function singlePart() {
  const result = fixture();
  result.parts = [part()];
  result.boms = [];
  return seal(result);
}
function section(value: Fixture, name: string): Record<string, unknown> {
  if (name === "envelope") return value;
  if (name === "producer") return value.producer;
  if (name === "workspace") return value.workspace;
  if (name === "part") return value.parts[0];
  if (name === "bom") return value.boms[0];
  return value.boms[0].items[0];
}

describe("CAD BOM transfer envelope v1 pure boundary", () => {
  it.each(["kt-auto-cad", "phoenix-desk-tools"])("accepts only supported producer %s without rewriting its version", id => {
    const input = fixture(); input.producer = { id, version: "1".repeat(32) };
    const result = normalizeCadBomTransferEnvelope(input);
    expect(result.producer).toEqual(input.producer);
    expect(result.workspace.scanId).not.toBe(result.transferId);
    expect(result.payloadHash).toBe(input.payloadHash);
  });
  it.each(["other", "KT-AUTO-CAD", " phoenix-desk-tools "])("rejects producer outside strict allowlist: %s", id => {
    const input = fixture(); input.producer.id = id;
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("producer.id");
  });
  it.each([["blank", " "], ["oversize", "v".repeat(33)], ["non-string", 1]])("rejects producer version: %s", (_name, version) => {
    const input = fixture(); section(input, "producer").version = version;
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("producer.version");
  });
  it("matches independently fixed canonical payload bytes and SHA-256", () => {
    const payload = { attachments: [] as [], boms: [], parts: [{ ...part("META"), name: "Independent" }] };
    const golden = '{"attachments":[],"boms":[],"parts":[{"attributes":{},"description":"","name":"Independent","partNo":"META","revision":"A","source":"","term":"","type":""}]}';
    expect(canonicalCadBomTransferJson(payload)).toBe(golden);
    expect(cadBomTransferPayloadHash(payload)).toBe("sha256:d6f8b0ea08b8f8da0ff394cb3dddef8f0f54ee7403cb9f35efc11181f603a759");
  });
  it("sorts identities, BOM keys, items and object keys without mutating caller arrays", () => {
    const input = fixture();
    input.parts.push(part("META-NEXT"));
    input.boms[0].items.push(item("META-NEXT"));
    input.boms.push(bom("META-CHILD", "META-NEXT"));
    seal(input);
    input.parts.reverse(); input.boms.reverse(); input.boms[1].items.reverse();
    const before = JSON.stringify(input);
    const normalized = normalizeCadBomTransferEnvelope(input);
    expect(normalized.parts.map(value => value.partNo)).toEqual(["META-CHILD", "META-HOST", "META-NEXT"]);
    expect(normalized.boms.map(value => value.bomKey)).toEqual(["META-CHILD@A", "META-HOST@A"]);
    expect(normalized.boms[1].items.map(value => value.partNo)).toEqual(["META-CHILD", "META-NEXT"]);
    expect(cadBomTransferPayloadHash(normalized)).toBe(input.payloadHash);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("hashes normalized trimmed fields, excludes producer/workspace metadata and requires matching hash", () => {
    const input = fixture(); const expected = input.payloadHash;
    input.parts[0].name = ` ${input.parts[0].name} `;
    input.parts[0].attributes = { z: " ", a: " trimmed " };
    const clean = fixture(); clean.parts[0].attributes = { a: "trimmed", z: "" }; seal(clean);
    input.payloadHash = clean.payloadHash;
    input.workspace.scanId = "x".repeat(64); input.producer.version = "next";
    const normalized = normalizeCadBomTransferEnvelope(input);
    expect(Object.keys(normalized.parts[1].attributes)).toEqual(["a", "z"]);
    expect(normalized.parts[1].attributes.a).toBe("trimmed");
    input.payloadHash = expected;
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("payloadHash");
  });
  it.each(["envelope", "producer", "workspace", "part", "bom", "item"])("rejects unknown fields in %s", name => {
    const input = fixture(); section(input, name).unknownField = "not-v1";
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("未知字段");
  });
  const required = [
    ["envelope", ["schema", "schemaVersion", "transferId", "createdAt", "producer", "workspace", "payloadHash", "parts", "boms", "attachments"]],
    ["producer", ["id", "version"]],
    ["workspace", ["schemaVersion", "fingerprint", "scanId", "scannedAt"]],
    ["part", ["partNo", "revision", "name", "type", "term", "source", "description", "attributes"]],
    ["bom", ["bomKey", "partNo", "revision", "name", "description", "items", "attributes"]],
    ["item", ["partNo", "revision", "qty", "attributes"]],
  ] as const;
  it.each(required.flatMap(([name, keys]) => keys.map(key => [`${name}.${key}`, name, key])))("requires own field %s", (_label, name, key) => {
    const input = fixture(); delete section(input, name)[key];
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("必需字段");
  });
  it.each([["schema", "different"], ["schemaVersion", 2]])("rejects unsupported envelope %s", (key, value) => {
    const input = fixture(); section(input, "envelope")[key] = value;
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("不支持");
  });
  it("requires workspace schema 13 and strict lowercase SHA-256 fingerprints", () => {
    const input = fixture(); input.workspace.schemaVersion = 14;
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("schemaVersion");
    input.workspace.schemaVersion = 13; input.workspace.fingerprint = `sha256:${"A".repeat(64)}`;
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("fingerprint");
  });
  it.each([
    ["uppercase", "AAAAAAAA-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
    ["version-zero", "aaaaaaaa-bbbb-0ccc-8ddd-eeeeeeeeeeee"],
    ["version-six", "aaaaaaaa-bbbb-6ccc-8ddd-eeeeeeeeeeee"],
    ["wrong-variant", "aaaaaaaa-bbbb-4ccc-7ddd-eeeeeeeeeeee"],
    ["not-uuid", "opaque-scan"],
  ])("rejects invalid transfer UUID: %s", (_label, value) => {
    const input = fixture(); input.transferId = value;
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("UUID");
  });
  it.each([1, 2, 3, 4, 5])("accepts receiver v1 UUID version %s", version => {
    const input = fixture(); input.transferId = `aaaaaaaa-bbbb-${version}ccc-8ddd-eeeeeeeeeeee`;
    expect(normalizeCadBomTransferEnvelope(input).transferId).toBe(input.transferId);
  });
  it.each(["8", "9", "a", "b"])("accepts receiver UUID variant %s", variant => {
    const input = fixture(); input.transferId = `aaaaaaaa-bbbb-4ccc-${variant}ddd-eeeeeeeeeeee`;
    expect(normalizeCadBomTransferEnvelope(input).transferId).toBe(input.transferId);
  });
  it.each(["createdAt", "scannedAt"])("requires canonical UTC milliseconds for %s", key => {
    for (const value of ["2025-01-02T03:04:05Z", "2025-01-02T03:04:05.000+00:00", "2025-01-02", "not-time"]) {
      const input = fixture();
      if (key === "createdAt") input.createdAt = value; else input.workspace.scannedAt = value;
      expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("UTC");
    }
  });
  it.each([["partNo", 64], ["revision", 32], ["name", 255], ["type", 64], ["term", 64], ["source", 64], ["description", 4000]] as const)("checks part field %s at and beyond length %s", (field, max) => {
    const input = singlePart(); input.parts[0][field] = "x".repeat(max); seal(input);
    expect(normalizeCadBomTransferEnvelope(input).parts[0][field]).toHaveLength(max);
    input.parts[0][field] += "x";
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow(`${field} 不能超过`);
  });
  it("matches receiver UTF-16 length for multibyte strings", () => {
    const input = singlePart(); input.parts[0].name = "🙂".repeat(127); seal(input);
    expect(normalizeCadBomTransferEnvelope(input).parts[0].name).toHaveLength(254);
    input.parts[0].name += "🙂";
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("255");
  });
  it.each(["partNo", "revision", "name"] as const)("rejects empty required part field %s", field => {
    const input = singlePart(); input.parts[0][field] = " ";
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow(`${field} 不能为空`);
  });
  it("checks BOM key, name, description and item identity lengths", () => {
    const input = fixture(); input.boms[0].name = "n".repeat(100); input.boms[0].description = "d".repeat(4000); seal(input);
    expect(normalizeCadBomTransferEnvelope(input).boms[0].name).toHaveLength(100);
    input.boms[0].name += "x"; expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("name 不能超过");
    input.boms[0].name = "n"; input.boms[0].description += "x"; expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("description 不能超过");
    input.boms[0].description = ""; input.boms[0].bomKey = "wrong@A"; expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("partNo@revision");
    input.boms[0].bomKey = "k".repeat(65); expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("bomKey 不能超过");
    input.boms[0].bomKey = "META-HOST@A"; input.boms[0].items[0].partNo = "p".repeat(65); expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("partNo 不能超过");
    input.boms[0].items[0].partNo = "META-CHILD"; input.boms[0].items[0].revision = "r".repeat(33); expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("revision 不能超过");
  });
  it.each(["__proto__", "white space", "a".repeat(65)])("rejects unsafe attribute key %s", key => {
    const input = fixture(); input.parts[0].attributes = { [key]: "text" };
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("键不安全");
  });
  it("accepts 64 safe attributes with 512-character values and refuses overflow/non-string", () => {
    const input = fixture(); input.parts[0].attributes = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`K${index}`, "v".repeat(512)])); seal(input);
    expect(Object.keys(normalizeCadBomTransferEnvelope(input).parts[1].attributes)).toHaveLength(64);
    input.parts[0].attributes.extra = ""; expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("64 项");
    delete input.parts[0].attributes.extra; input.parts[0].attributes.K0 += "x"; expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("512");
    input.parts[0].attributes = { invalid: 1 } as unknown as Record<string, string>; expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("必须是字符串");
  });
  it("retains safe punctuation/64-character attribute keys without changing object prototypes", () => {
    const input = fixture(); input.parts[0].attributes = { ["k".repeat(64)]: "max-key", "a.b-c:d": "punctuation", constructor: "ordinary-data" }; seal(input);
    const result = normalizeCadBomTransferEnvelope(input).parts[1].attributes;
    expect(result["k".repeat(64)]).toBe("max-key");
    expect(result["a.b-c:d"]).toBe("punctuation");
    expect(result.constructor).toBe("ordinary-data");
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
  it.each([["zero", 0], ["negative", -1], ["fractional", 1.5], ["over-int32", 2_147_483_648], ["unsafe", Number.MAX_SAFE_INTEGER + 1], ["not-finite", NaN], ["infinite", Infinity], ["string", "2"]])("rejects invalid direct quantity: %s", (_label, qty) => {
    const input = fixture(); section(input, "item").qty = qty;
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow(/qty|非有限数字/u);
  });
  it.each([1, 2_147_483_647])("accepts direct quantity boundary %s without recursive multiplication", qty => {
    const input = fixture(); input.boms[0].items[0].qty = qty; seal(input);
    expect(normalizeCadBomTransferEnvelope(input).boms[0].items[0].qty).toBe(qty);
  });
  it.each(["parts", "boms", "items"])("rejects duplicate identity in %s", name => {
    const input = fixture();
    if (name === "parts") input.parts.push(input.parts[0]);
    else if (name === "boms") input.boms.push(input.boms[0]);
    else input.boms[0].items.push(input.boms[0].items[0]);
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("重复");
  });
  it.each(["host", "child"])("requires referenced %s identity in parts", name => {
    const input = fixture(); input.parts.splice(name === "host" ? 0 : 1, 1);
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow(name === "host" ? "主件" : "子件");
  });
  it("retains receiver cycle semantics; source-building quality gate is a separate migration", () => {
    const input = fixture(); input.boms[0].items = [item("META-HOST")]; seal(input);
    expect(normalizeCadBomTransferEnvelope(input).boms[0].items[0].partNo).toBe("META-HOST");
  });
  it.each(["empty-parts", "parts-over-limit", "boms-over-limit", "empty-items", "items-over-limit", "attachments"])("rejects collection boundary %s before hashing", name => {
    const input = fixture();
    if (name === "empty-parts") input.parts = [];
    if (name === "parts-over-limit") input.parts = Array(10_001).fill(part());
    if (name === "boms-over-limit") input.boms = Array(2001).fill(bom());
    if (name === "empty-items") input.boms[0].items = [];
    if (name === "items-over-limit") input.boms[0].items = Array(1001).fill(item());
    if (name === "attachments") section(input, "envelope").attachments = [{}];
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow(CadBomTransferValidationError);
  });
  it.each(["parts", "boms", "items"])("accepts collection upper bound for %s", name => {
    const input = fixture();
    if (name === "parts") {
      input.parts = Array.from({ length: 10_000 }, (_, index) => part(`META-${index}`)); input.boms = [];
    } else if (name === "boms") {
      input.parts = [part("META-CHILD"), ...Array.from({ length: 2000 }, (_, index) => part(`META-${index}`))];
      input.boms = Array.from({ length: 2000 }, (_, index) => bom(`META-${index}`));
    } else {
      input.parts = [part(), ...Array.from({ length: 1000 }, (_, index) => part(`META-${index}`))];
      input.boms[0].items = Array.from({ length: 1000 }, (_, index) => item(`META-${index}`));
    }
    seal(input);
    const result = normalizeCadBomTransferEnvelope(input);
    expect(name === "parts" ? result.parts.length : name === "boms" ? result.boms.length : result.boms[0].items.length).toBe(name === "parts" ? 10_000 : name === "boms" ? 2000 : 1000);
  });
  it("bounds normalized canonical UTF-8 bytes, not character count", () => {
    const input = singlePart();
    input.parts = Array.from({ length: 1000 }, (_, index) => ({ ...part(`META-${index}`), description: "圆".repeat(3000) }));
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("8 MiB");
    expect(() => canonicalCadBomTransferJson("圆".repeat(Math.ceil(CAD_BOM_TRANSFER_MAX_BYTES / 3)))).toThrow("8 MiB");
  });
  it("rejects a large shared direct-object matrix before allocating normalized copies", () => {
    const input = fixture();
    const sharedItem = { ...item(), attributes: Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`K${index}`, "v".repeat(512)])) };
    const sharedBom = { ...bom(), items: Array(1000).fill(sharedItem) };
    input.boms = Array(2000).fill(sharedBom);
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("8 MiB");
  });
  it("rejects cycles and excessive nesting in direct unknown input before normalization", () => {
    const cyclic = fixture(); section(cyclic, "part").attributes = { self: cyclic };
    expect(() => normalizeCadBomTransferEnvelope(cyclic)).toThrow("循环对象");
    const deep = fixture(); let value: unknown = "text";
    for (let index = 0; index < 40; index += 1) value = { nested: value };
    section(deep, "part").attributes = value;
    expect(() => normalizeCadBomTransferEnvelope(deep)).toThrow("32 层");
  });
  it("explicitly caps pre-trim direct-object bytes even when trimming would shrink the payload", () => {
    const input = fixture(); input.parts[0].description = " ".repeat(CAD_BOM_TRANSFER_MAX_BYTES);
    // The existing hash would match if description were silently trimmed to empty.
    expect(() => normalizeCadBomTransferEnvelope(input)).toThrow("8 MiB");
  });
});

describe("historical CAD BOM import byte snapshot", () => {
  it("preserves BOM, CRLF, formatting and old producer/transfer identity/hash without rewriting", () => {
    const input = fixture(); input.parts[0].name = "独立元数据🙂"; seal(input);
    const text = `\uFEFF${JSON.stringify(input, null, 2).replaceAll("\n", "\r\n")}\r\n`;
    const bytes = new Uint8Array(Buffer.from(text, "utf8"));
    const parsed = parseCadBomTransferEnvelope(bytes);
    expect(parsed.originalBytes).toEqual(bytes);
    expect(parsed.envelope.producer).toEqual({ id: "kt-auto-cad", version: "0.2.0" });
    expect(parsed.envelope.transferId).toBe(input.transferId);
    expect(parsed.envelope.payloadHash).toBe(input.payloadHash);
    bytes.fill(0); parsed.originalBytes.fill(0);
    expect(Buffer.from(parsed.originalBytes).toString("utf8")).toBe(text);
    expect(Object.isFrozen(parsed.envelope.parts[0].attributes)).toBe(true);
    expect(Object.isFrozen(parsed.envelope.boms[0].items)).toBe(true);
    expect(Object.isFrozen(parsed.envelope.producer)).toBe(true);
  });
  it("accepts lossless string input and returns copies of exact UTF-8 bytes", () => {
    const text = `${JSON.stringify(fixture())}\n`;
    const parsed = parseCadBomTransferEnvelope(text);
    expect(Buffer.from(parsed.originalBytes).toString("utf8")).toBe(text);
    expect(parsed.originalBytes).not.toBe(parsed.originalBytes);
  });
  it("accepts original input exactly at 8 MiB and rejects one byte more even if payload is small", () => {
    const text = JSON.stringify(fixture());
    const bounded = `${text}${" ".repeat(CAD_BOM_TRANSFER_MAX_BYTES - Buffer.byteLength(text, "utf8"))}`;
    expect(parseCadBomTransferEnvelope(bounded).originalBytes.byteLength).toBe(CAD_BOM_TRANSFER_MAX_BYTES);
    expect(() => parseCadBomTransferEnvelope(`${bounded} `)).toThrow("原始 transfer envelope 超过 8 MiB");
  });
  it.each([["root", '{"schema":1,"schema":2}'], ["escaped-equivalent", '{"schema":1,"sch\\u0065ma":2}'], ["nested", '{"attributes":{"X":"first","\\u0058":"second"}}']])("rejects ambiguous duplicate JSON keys: %s", (_label, text) => {
    expect(() => parseCadBomTransferEnvelope(text)).toThrow("重复字段");
  });
  it("does not mistake quoted braces, colons or escaped quotes for keys", () => {
    const input = fixture(); input.parts[0].description = 'Text { "schema": 2 }, "quote\\", [ ]'; seal(input);
    expect(parseCadBomTransferEnvelope(JSON.stringify(input)).envelope.parts[1].description).toBe(input.parts[0].description);
  });
  it("rejects invalid UTF-8, lossy string surrogates and malformed JSON", () => {
    expect(() => parseCadBomTransferEnvelope(new Uint8Array([123, 34, 255, 34, 125]))).toThrow("有效 UTF-8");
    expect(() => parseCadBomTransferEnvelope('"\uD800"')).toThrow("无损编码");
    expect(() => parseCadBomTransferEnvelope('{"unterminated":')).toThrow("有效 JSON");
  });
  it("rejects deeply nested JSON iteratively instead of overflowing the call stack", () => {
    expect(() => parseCadBomTransferEnvelope(`${"[".repeat(10_000)}0${"]".repeat(10_000)}`)).toThrow("32 层");
  });
  it("bounds canonical depth and refuses cyclic/non-JSON/prototype/accessor inputs", () => {
    let nested: unknown = 0; for (let index = 0; index < 40; index += 1) nested = [nested];
    expect(() => canonicalCadBomTransferJson(nested)).toThrow("32 层");
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => canonicalCadBomTransferJson(cyclic)).toThrow("循环对象");
    for (const value of [NaN, Infinity, undefined, Symbol("not-json"), new Date()]) {
      expect(() => canonicalCadBomTransferJson(value)).toThrow(CadBomTransferValidationError);
    }
    expect(() => canonicalCadBomTransferJson({ get unsafe() { throw new Error("must not run"); } })).toThrow("访问器属性");
  });
});
