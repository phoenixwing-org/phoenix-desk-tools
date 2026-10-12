import { createHash } from "node:crypto";

// Pure v1 boundary, not an export source builder, filesystem writer or transport.
export const CAD_BOM_TRANSFER_SCHEMA = "phoenix-bom.transfer-envelope" as const;
export const CAD_BOM_TRANSFER_SCHEMA_VERSION = 1 as const;
export const CAD_BOM_TRANSFER_MAX_BYTES = 8 * 1024 * 1024;
export const CAD_BOM_TRANSFER_PRODUCER_IDS = ["phoenix-desk-tools", "kt-auto-cad"] as const;
const MAX_JSON_DEPTH = 32;

export interface CadBomTransferPart {
  readonly partNo: string;
  readonly revision: string;
  readonly name: string;
  readonly type: string;
  readonly term: string;
  readonly source: string;
  readonly description: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface CadBomTransferItem {
  readonly partNo: string;
  readonly revision: string;
  readonly qty: number;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface CadBomTransferBom {
  readonly bomKey: string;
  readonly partNo: string;
  readonly revision: string;
  readonly name: string;
  readonly description: string;
  readonly items: readonly CadBomTransferItem[];
  readonly attributes: Readonly<Record<string, string>>;
}

export interface CadBomTransferEnvelope {
  readonly schema: typeof CAD_BOM_TRANSFER_SCHEMA;
  readonly schemaVersion: typeof CAD_BOM_TRANSFER_SCHEMA_VERSION;
  readonly transferId: string;
  readonly createdAt: string;
  readonly producer: {
    readonly id: typeof CAD_BOM_TRANSFER_PRODUCER_IDS[number];
    readonly version: string;
  };
  readonly workspace: {
    readonly schemaVersion: 13;
    readonly fingerprint: string;
    readonly scanId: string;
    readonly scannedAt: string;
  };
  readonly payloadHash: string;
  readonly parts: readonly CadBomTransferPart[];
  readonly boms: readonly CadBomTransferBom[];
  readonly attachments: readonly [];
}

export interface ParsedCadBomTransferEnvelope {
  readonly envelope: CadBomTransferEnvelope;
  /** Defensive byte copy on every access; never a reserialization of envelope. */
  readonly originalBytes: Uint8Array;
}

export class CadBomTransferValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CadBomTransferValidationError";
  }
}

function fail(message: string): never {
  throw new CadBomTransferValidationError(message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} 必须是对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} 必须是 JSON 对象`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, "value")) fail(`${label} 不接受访问器属性`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(input: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  if (Object.keys(input).some(key => !allowed.has(key))) fail(`${label} 包含未知字段`);
  if (keys.some(key => !Object.hasOwn(input, key))) fail(`${label} 缺少必需字段`);
}

function string(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string") fail(`${label} 必须是字符串`);
  const normalized = value.trim();
  if (!allowEmpty && !normalized) fail(`${label} 不能为空`);
  // Match the receiver's runtime UTF-16 length semantics, not code-point counting.
  if (normalized.length > max) fail(`${label} 不能超过 ${max} 个字符`);
  return normalized;
}

function timestamp(value: unknown, label: string): string {
  const raw = string(value, label, 32);
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== raw) {
    fail(`${label} 必须是 UTC ISO-8601 时间（含毫秒和 Z）`);
  }
  return raw;
}

function attributes(value: unknown, label: string): Readonly<Record<string, string>> {
  const input = object(value, label);
  const keys = Object.keys(input).sort();
  if (keys.length > 64) fail(`${label} 最多包含 64 项`);
  const result: Record<string, string> = {};
  for (const key of keys) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/u.test(key)) fail(`${label} 的键不安全`);
    result[key] = string(input[key], `${label}.${key}`, 512, true);
  }
  return Object.freeze(result);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function identity(part: { readonly partNo: string; readonly revision: string }): string {
  return `${part.partNo}@${part.revision}`;
}

function normalizePart(value: unknown, index: number): CadBomTransferPart {
  const label = `parts[${index}]`;
  const input = object(value, label);
  exactKeys(input, ["partNo", "revision", "name", "type", "term", "source", "description", "attributes"], label);
  return Object.freeze({
    partNo: string(input.partNo, `${label}.partNo`, 64),
    revision: string(input.revision, `${label}.revision`, 32),
    name: string(input.name, `${label}.name`, 255),
    type: string(input.type, `${label}.type`, 64, true),
    term: string(input.term, `${label}.term`, 64, true),
    source: string(input.source, `${label}.source`, 64, true),
    description: string(input.description, `${label}.description`, 4000, true),
    attributes: attributes(input.attributes, `${label}.attributes`),
  });
}

function normalizeItem(value: unknown, label: string): CadBomTransferItem {
  const input = object(value, label);
  exactKeys(input, ["partNo", "revision", "qty", "attributes"], label);
  if (!Number.isSafeInteger(input.qty) || Number(input.qty) <= 0 || Number(input.qty) > 2_147_483_647) {
    fail(`${label}.qty 必须是 1 到 2147483647 的整数`);
  }
  return Object.freeze({
    partNo: string(input.partNo, `${label}.partNo`, 64),
    revision: string(input.revision, `${label}.revision`, 32),
    qty: Number(input.qty),
    attributes: attributes(input.attributes, `${label}.attributes`),
  });
}

function normalizeBom(value: unknown, index: number): CadBomTransferBom {
  const label = `boms[${index}]`;
  const input = object(value, label);
  exactKeys(input, ["bomKey", "partNo", "revision", "name", "description", "items", "attributes"], label);
  const partNo = string(input.partNo, `${label}.partNo`, 64);
  const revision = string(input.revision, `${label}.revision`, 32);
  const bomKey = string(input.bomKey, `${label}.bomKey`, 64);
  if (bomKey !== identity({ partNo, revision })) fail(`${label}.bomKey 必须是 partNo@revision`);
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 1000) {
    fail(`${label}.items 必须包含 1 到 1000 项`);
  }
  const items = Array.from(input.items, (item, itemIndex) => normalizeItem(item, `${label}.items[${itemIndex}]`))
    .sort((left, right) => compare(identity(left), identity(right)));
  const seen = new Set<string>();
  for (const item of items) {
    const key = identity(item);
    if (seen.has(key)) fail(`${label}.items 包含重复零件`);
    seen.add(key);
  }
  return Object.freeze({
    bomKey, partNo, revision,
    name: string(input.name, `${label}.name`, 100),
    description: string(input.description, `${label}.description`, 4000, true),
    items: Object.freeze(items),
    attributes: attributes(input.attributes, `${label}.attributes`),
  });
}

/** v1 key ordering, array order and finite-number spelling; bounded for unknown input. */
export function canonicalCadBomTransferJson(value: unknown): string {
  const fragments: string[] = [];
  const active = new Set<object>();
  let bytes = 0;
  const append = (fragment: string): void => {
    bytes += Buffer.byteLength(fragment, "utf8");
    if (bytes > CAD_BOM_TRANSFER_MAX_BYTES) fail("transfer envelope 超过 8 MiB");
    fragments.push(fragment);
  };
  const visit = (entry: unknown, depth: number): void => {
    if (depth > MAX_JSON_DEPTH) fail("JSON 嵌套超过 32 层");
    if (entry === null || typeof entry === "boolean" || typeof entry === "string") {
      append(JSON.stringify(entry));
    } else if (typeof entry === "number") {
      if (!Number.isFinite(entry)) fail("canonical JSON 不接受非有限数字");
      append(JSON.stringify(entry));
    } else if (entry && typeof entry === "object") {
      if (active.has(entry)) fail("canonical JSON 不接受循环对象");
      active.add(entry);
      if (Array.isArray(entry)) {
        append("[");
        for (let index = 0; index < entry.length; index += 1) {
          if (index > 0) append(",");
          visit(entry[index], depth + 1);
        }
        append("]");
      } else {
        const record = object(entry, "canonical JSON");
        append("{");
        Object.keys(record).sort().forEach((key, index) => {
          if (index > 0) append(",");
          append(`${JSON.stringify(key)}:`);
          visit(record[key], depth + 1);
        });
        append("}");
      }
      active.delete(entry);
    } else fail("canonical JSON 只接受 JSON 值");
  };
  visit(value, 0);
  return fragments.join("");
}

export function cadBomTransferPayloadHash(value: Pick<CadBomTransferEnvelope, "parts" | "boms" | "attachments">): string {
  const payload = {
    parts: [...value.parts].sort((left, right) => compare(identity(left), identity(right))),
    boms: value.boms.map(bom => ({
      ...bom,
      items: [...bom.items].sort((left, right) => compare(identity(left), identity(right))),
    })).sort((left, right) => compare(left.bomKey, right.bomKey)),
    attachments: value.attachments,
  };
  return `sha256:${createHash("sha256").update(canonicalCadBomTransferJson(payload), "utf8").digest("hex")}`;
}

/** Receiver-v1 guards plus the explicit Desk/legacy producer allowlist. No source-graph construction. */
export function normalizeCadBomTransferEnvelope(value: unknown): CadBomTransferEnvelope {
  const input = object(value, "transfer envelope");
  exactKeys(input, ["schema", "schemaVersion", "transferId", "createdAt", "producer", "workspace", "payloadHash", "parts", "boms", "attachments"], "transfer envelope");
  if (input.schema !== CAD_BOM_TRANSFER_SCHEMA) fail("不支持的 transfer schema");
  if (input.schemaVersion !== CAD_BOM_TRANSFER_SCHEMA_VERSION) fail("不支持的 transfer schemaVersion");
  const transferId = string(input.transferId, "transferId", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(transferId)) {
    fail("transferId 必须是小写 UUID");
  }
  const producer = object(input.producer, "producer");
  exactKeys(producer, ["id", "version"], "producer");
  if (producer.id !== "phoenix-desk-tools" && producer.id !== "kt-auto-cad") fail("producer.id 不在允许列表");
  const workspace = object(input.workspace, "workspace");
  exactKeys(workspace, ["schemaVersion", "fingerprint", "scanId", "scannedAt"], "workspace");
  if (workspace.schemaVersion !== 13) fail("workspace.schemaVersion 必须是 13");
  const fingerprint = string(workspace.fingerprint, "workspace.fingerprint", 71);
  if (!/^sha256:[0-9a-f]{64}$/u.test(fingerprint)) fail("workspace.fingerprint 必须是 SHA-256");
  if (!Array.isArray(input.parts) || input.parts.length === 0 || input.parts.length > 10_000) {
    fail("parts 必须包含 1 到 10000 项");
  }
  if (!Array.isArray(input.boms) || input.boms.length > 2000) fail("boms 最多包含 2000 项");
  if (!Array.isArray(input.attachments) || input.attachments.length !== 0) fail("v1 attachments 必须为空数组");
  // Bound unknown direct-object input before copying its nested collections. This
  // intentionally also caps pre-trim bytes; historical text has the same raw cap.
  canonicalCadBomTransferJson(input);
  const parts = Array.from(input.parts, normalizePart).sort((left, right) => compare(identity(left), identity(right)));
  const partKeys = new Set<string>();
  for (const part of parts) {
    const key = identity(part);
    if (partKeys.has(key)) fail("parts 包含重复零件");
    partKeys.add(key);
  }
  const boms = Array.from(input.boms, normalizeBom).sort((left, right) => compare(left.bomKey, right.bomKey));
  const bomKeys = new Set<string>();
  for (const bom of boms) {
    if (bomKeys.has(bom.bomKey)) fail("boms 包含重复 BOM");
    bomKeys.add(bom.bomKey);
    if (!partKeys.has(identity(bom))) fail("BOM 主件不在 parts 中");
    for (const item of bom.items) {
      if (!partKeys.has(identity(item))) fail("BOM 子件不在 parts 中");
    }
  }
  const normalized: CadBomTransferEnvelope = Object.freeze({
    schema: CAD_BOM_TRANSFER_SCHEMA,
    schemaVersion: CAD_BOM_TRANSFER_SCHEMA_VERSION,
    transferId,
    createdAt: timestamp(input.createdAt, "createdAt"),
    producer: Object.freeze({ id: producer.id, version: string(producer.version, "producer.version", 32) }),
    workspace: Object.freeze({
      schemaVersion: 13,
      fingerprint,
      // Historical v1 scanId is opaque; source builders must enforce their own UUID/equality rule.
      scanId: string(workspace.scanId, "workspace.scanId", 64),
      scannedAt: timestamp(workspace.scannedAt, "workspace.scannedAt"),
    }),
    payloadHash: string(input.payloadHash, "payloadHash", 71),
    parts: Object.freeze(parts),
    boms: Object.freeze(boms),
    attachments: Object.freeze([]) as readonly [],
  });
  if (normalized.payloadHash !== cadBomTransferPayloadHash(normalized)) fail("payloadHash 与规范化 payload 不一致");
  canonicalCadBomTransferJson(normalized);
  return normalized;
}

// Lexical duplicate-key/depth preflight only. JSON.parse remains the syntax parser.
function assertUnambiguousJson(text: string): void {
  const stack: (Set<string> | null)[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < text.length && text[index] !== '"') {
        if (text[index] === "\\") index += 1;
        index += 1;
      }
      let next = index + 1;
      while (/^[\t\n\r ]$/u.test(text[next] ?? "")) next += 1;
      if (text[next] === ":" && stack.at(-1) instanceof Set) {
        const key = JSON.parse(text.slice(start, index + 1)) as string;
        const keys = stack.at(-1)!;
        if (keys.has(key)) fail("JSON 包含重复字段");
        keys.add(key);
      }
    } else if (char === "{" || char === "[") {
      stack.push(char === "{" ? new Set<string>() : null);
      if (stack.length > MAX_JSON_DEPTH) fail("JSON 嵌套超过 32 层");
    } else if (char === "}" || char === "]") stack.pop();
  }
}

/** Import snapshot: retain exact historical bytes/identity/hash, never auto-rewrite producer or payload. */
export function parseCadBomTransferEnvelope(source: string | Uint8Array): ParsedCadBomTransferEnvelope {
  const byteLength = typeof source === "string" ? Buffer.byteLength(source, "utf8") : source.byteLength;
  // Deliberately stricter than receiver v1's canonical-only cap: includes whitespace/newline/BOM.
  if (byteLength > CAD_BOM_TRANSFER_MAX_BYTES) fail("原始 transfer envelope 超过 8 MiB");
  const snapshot = typeof source === "string" ? new Uint8Array(Buffer.from(source, "utf8")) : Uint8Array.from(source);
  let text: string;
  try {
    // Retain a BOM in the snapshot, but treat it as an encoding marker when parsing JSON.
    text = new TextDecoder("utf-8", { fatal: true }).decode(snapshot);
    if (typeof source === "string" && new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(snapshot) !== source) {
      fail("原始文本不是可无损编码的 UTF-8");
    }
  } catch (error) {
    if (error instanceof CadBomTransferValidationError) throw error;
    fail("原始 transfer envelope 不是有效 UTF-8");
  }
  let value: unknown;
  try {
    assertUnambiguousJson(text);
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof CadBomTransferValidationError) throw error;
    fail("原始 transfer envelope 不是有效 JSON");
  }
  const envelope = normalizeCadBomTransferEnvelope(value);
  return Object.freeze({ envelope, get originalBytes() { return Uint8Array.from(snapshot); } });
}
