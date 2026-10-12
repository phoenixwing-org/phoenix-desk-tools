import { jsonFetch } from "../../api";
import type { BomDeliveryPreview, BomDeliveryEnvelope, BomDeliveryReceipt } from "./types";

const MAX_BYTES = 8 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const previewId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = /^sha256:[0-9a-f]{64}$/;
function fail(label: string): never { throw new Error(`BOM 交付接口数据无效：${label}`); }
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(label);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) fail(`${label}字段`);
  return row;
}
function text(value: unknown, label: string, max = 4096, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || value.includes("\0")) fail(label);
  return value;
}
function stamp(value: unknown, label: string): string {
  const result = text(value, label, 32), at = Date.parse(result);
  if (!Number.isFinite(at) || new Date(at).toISOString() !== result) fail(label);
  return result;
}
function integer(value: unknown, label: string, max: number, min = 1): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) fail(label);
  return Number(value);
}
function attributes(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 64) fail("attributes");
  for (const [key, entry] of Object.entries(value)) { if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(key)) fail("attribute key"); text(entry, "attribute", 512, true); }
}
function envelope(value: unknown): BomDeliveryEnvelope {
  const row = object(value, ["schema", "schemaVersion", "transferId", "createdAt", "producer", "workspace", "payloadHash", "parts", "boms", "attachments"], "envelope");
  if (row.schema !== "phoenix-bom.transfer-envelope" || row.schemaVersion !== 1) fail("schema/version");
  if (!uuid.test(text(row.transferId, "transferId", 36)) || !hash.test(text(row.payloadHash, "payloadHash", 71))) fail("transfer identity/hash");
  stamp(row.createdAt, "createdAt");
  const producer = object(row.producer, ["id", "version"], "producer");
  if (producer.id !== "phoenix-desk-tools") fail("producer（不接受旧生产者伪装）"); text(producer.version, "producer version", 32);
  const ws = object(row.workspace, ["schemaVersion", "fingerprint", "scanId", "scannedAt"], "workspace");
  if (ws.schemaVersion !== 13 || !hash.test(text(ws.fingerprint, "fingerprint", 71)) || !uuid.test(text(ws.scanId, "scanId", 36)) || row.transferId !== ws.scanId) fail("workspace identity");
  stamp(ws.scannedAt, "scannedAt");
  if (!Array.isArray(row.parts) || !row.parts.length || row.parts.length > 10000 || !Array.isArray(row.boms) || row.boms.length > 2000 || !Array.isArray(row.attachments) || row.attachments.length) fail("bounded payload arrays");
  for (const part of row.parts) {
    const p = object(part, ["partNo", "revision", "name", "type", "term", "source", "description", "attributes"], "part");
    text(p.partNo, "partNo", 64); text(p.revision, "revision", 32); text(p.name, "name", 255);
    for (const key of ["type", "term", "source"]) text(p[key], key, 64, true);
    text(p.description, "description", 4000, true); attributes(p.attributes);
  }
  for (const bom of row.boms) {
    const b = object(bom, ["bomKey", "partNo", "revision", "name", "description", "items", "attributes"], "bom");
    text(b.bomKey, "bomKey", 64); text(b.partNo, "partNo", 64); text(b.revision, "revision", 32); text(b.name, "name", 100); text(b.description, "description", 4000, true); attributes(b.attributes);
    if (b.bomKey !== `${b.partNo}@${b.revision}`) fail("bomKey/PartKey");
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 1000) fail("direct items");
    for (const item of b.items) { const i = object(item, ["partNo", "revision", "qty", "attributes"], "item"); text(i.partNo, "item partNo", 64); text(i.revision, "item revision", 32); integer(i.qty, "direct qty", 2147483647); attributes(i.attributes); }
  }
  if (new TextEncoder().encode(JSON.stringify(row)).byteLength > MAX_BYTES) fail("envelope 超过 8 MiB");
  return row as unknown as BomDeliveryEnvelope;
}
export function safeSuggestedFilename(value: unknown): string {
  const name = text(value, "suggested_filename", 128);
  if (!/^phoenix-bom-[0-9a-f-]{36}\.json$/.test(name) || !uuid.test(name.slice(12, -5))) fail("仅允许安全 JSON 文件名");
  return name;
}
export function absoluteJsonTarget(value: unknown): string {
  const result = text(value, "绝对 JSON 目标路径", 8192);
  if (/[\u0000-\u001f]/.test(result) || !/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(result) || /[\\/]$/.test(result) || !/\.json$/i.test(result) || result.replaceAll("\\", "/").split("/").some(part => part === "." || part === "..")) fail("绝对 JSON 目标路径");
  return result;
}
export function joinOutputDirectory(directory: string, filename: string): string {
  const name = safeSuggestedFilename(filename), separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return absoluteJsonTarget(`${directory.replace(/[\\/]+$/, "")}${separator}${name}`);
}
export function validateBomDeliveryPreview(value: unknown): BomDeliveryPreview {
  const row = object(value, ["preview_id", "expires_at", "envelope", "bytes", "suggested_filename"], "preview");
  if (!previewId.test(text(row.preview_id, "preview_id", 36))) fail("preview_id"); stamp(row.expires_at, "expires_at");
  const data = envelope(row.envelope); integer(row.bytes, "bytes", MAX_BYTES);
  // Canonical key ordering cannot change UTF-8 byte length; this is a DTO size
  // sanity check only, never a client-generated publication payload or hash.
  if (row.bytes !== new TextEncoder().encode(JSON.stringify(data)).byteLength) fail("preview bytes/envelope");
  if (safeSuggestedFilename(row.suggested_filename) !== `phoenix-bom-${data.transferId}.json`) fail("suggested filename/transferId");
  return row as unknown as BomDeliveryPreview;
}
export function validateBomDeliveryReceipt(value: unknown): BomDeliveryReceipt {
  const outer = object(value, ["receipt"], "export"), row = object(outer.receipt, ["status", "targetPath", "transferId", "payloadHash", "bytes", "directorySync", "warnings"], "receipt");
  if (row.status !== "created" && row.status !== "existing") fail("receipt status");
  absoluteJsonTarget(row.targetPath);
  if (!uuid.test(text(row.transferId, "transferId", 36)) || !hash.test(text(row.payloadHash, "payloadHash", 71))) fail("receipt identity/hash");
  integer(row.bytes, "receipt bytes", MAX_BYTES);
  if (row.directorySync !== "synced" && row.directorySync !== "failed") fail("directorySync");
  if (!Array.isArray(row.warnings) || row.warnings.length > 100) fail("warnings"); row.warnings.forEach(entry => text(entry, "warning", 4096, true));
  return row as unknown as BomDeliveryReceipt;
}
function workspace(value: string) { return text(value, "workspace", 8192); }
function id(value: string) { if (!previewId.test(text(value, "preview_id", 36))) fail("preview_id"); return value; }
export async function previewBomDelivery(ws: string, signal?: AbortSignal): Promise<BomDeliveryPreview> {
  const root = workspace(ws), raw = await jsonFetch<unknown>("/api/cad/bom-delivery/preview", { method: "POST", body: JSON.stringify({ workspace: root }), signal });
  try { return validateBomDeliveryPreview(raw); }
  catch (error) {
    // A malformed response must not strand a valid provisioned server handle.
    const candidate = raw && typeof raw === "object" && "preview_id" in raw ? raw.preview_id : null;
    if (typeof candidate === "string" && previewId.test(candidate)) void releaseBomDelivery(root, candidate).catch(() => undefined);
    throw error;
  }
}
export async function exportBomDelivery(ws: string, preview: string, target: string, signal?: AbortSignal): Promise<BomDeliveryReceipt> {
  return validateBomDeliveryReceipt(await jsonFetch<unknown>("/api/cad/bom-delivery/export", { method: "POST", body: JSON.stringify({ workspace: workspace(ws), preview_id: id(preview), target_path: absoluteJsonTarget(target), confirmed: true }), signal }));
}
export async function releaseBomDelivery(ws: string, preview: string, signal?: AbortSignal): Promise<void> {
  const response = object(await jsonFetch<unknown>("/api/cad/bom-delivery/release", { method: "POST", body: JSON.stringify({ workspace: workspace(ws), preview_id: id(preview) }), signal }), ["released"], "release");
  if (response.released !== true) fail("released");
}
