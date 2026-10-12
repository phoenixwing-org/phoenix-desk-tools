import { createHash } from "node:crypto";
import { PNW_WORKSPACE_SCHEMA_VERSION } from "@phoenix-wing/workspace-schema";
import { PNW_CAD_INDEX_WRITE_PROTOCOL } from "@phoenix-wing/cad-contracts";
import { pnwCadIndexIncludesPath } from "@phoenix-wing/cad-core";
import { cadPathExcludedFromDiscovery } from "../../lib/cadIndexScanScope.js";
import {
  CAD_BOM_TRANSFER_SCHEMA,
  CAD_BOM_TRANSFER_SCHEMA_VERSION,
  CadBomTransferValidationError,
  cadBomTransferPayloadHash,
  canonicalCadBomTransferJson,
  normalizeCadBomTransferEnvelope,
  type CadBomTransferEnvelope,
  type CadBomTransferPart,
  type CadBomTransferBom,
} from "./envelope.js";

/** Schema-13 row projection only; callers own coherent reads, files and inventory. */
export interface CadBomSourceAsset {
  readonly id: number;
  readonly relativePath: string;
  readonly assetKind: string | null;
  readonly partNo: string | null;
  readonly revision: string | null;
  readonly typeCode: string | null;
  readonly modelSeries: string | null;
  readonly partName: string | null;
  readonly label: string | null;
  readonly fileStatus: string;
  readonly lastSeenAt: string | null;
  readonly bomJson: unknown;
}

export interface CadBomSourceReference {
  readonly id: number;
  readonly scanId: number;
  readonly hostAssetId: number;
  readonly hostRelativePath: string;
  readonly xlinkFile: string;
  readonly targetAssetId: number | null;
  readonly targetRelativePath: string | null;
  readonly targetPartNo: string | null;
  readonly targetRevision: string | null;
  readonly resolveStatus: string;
  readonly detailJson: unknown;
}

export interface CadBomSourceSnapshot {
  readonly schemaVersion: number;
  readonly scan: {
    readonly id: number;
    readonly scanUuid: string;
    readonly scannedAt: string;
    readonly status: string;
    readonly phase: string;
    readonly statsJson: unknown;
  };
  /** Includes historical missing and non-FCStd rows; they are never manufacturing parts. */
  readonly assets: readonly CadBomSourceAsset[];
  /** All xref rows, not just rows selected by scan_id. Wrong-scan rows must fail. */
  readonly references: readonly CadBomSourceReference[];
  /** Latest-scan COUNT(*) only, never recursive bom_line quantities. */
  readonly bomLineCount: number;
}

export interface CadBomSourceBuildOptions { readonly producerVersion: string }
export const CAD_BOM_SOURCE_FINGERPRINT_MAX_BYTES = 64 * 1024 * 1024;

function fail(message: string): never {
  throw new CadBomTransferValidationError(`BOM source 未通过质量门禁：${message}`);
}
function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail(`${label} 必须是安全整数`);
  return Number(value);
}
function nullableText(value: unknown, label: string): string {
  if (value === null) return "";
  if (typeof value !== "string") fail(`${label} 必须是字符串或 null`);
  return value.trim();
}
function jsonObject(value: unknown, label: string): Record<string, unknown> {
  let result: unknown = value;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > 8 * 1024 * 1024) fail(`${label} 超过 8 MiB`);
    try { result = JSON.parse(value); } catch { fail(`${label} 不是有效 JSON`); }
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) fail(`${label} 必须是 JSON 对象`);
  const prototype = Object.getPrototypeOf(result);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} 必须是 JSON 对象`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(result))) {
    if (!Object.hasOwn(descriptor, "value")) fail(`${label} 不接受访问器属性`);
  }
  return result as Record<string, unknown>;
}
function relativePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || /[\u0000-\u001f]/u.test(value)) fail(`${label} 不是安全相对路径`);
  let normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) fail(`${label} 不能是绝对路径`);
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (!normalized || normalized.split("/").some(segment => !segment || segment === "." || segment === "..")) {
    fail(`${label} 路径不能包含空段、. 或 ..`);
  }
  return normalized;
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function identity(value: { readonly partNo: string; readonly revision: string }): string { return `${value.partNo}@${value.revision}`; }
function edge(graph: Map<string, Set<string>>, host: string, target: string): void {
  const targets = graph.get(host) ?? new Set<string>(); targets.add(target); graph.set(host, targets);
  if (!graph.has(target)) graph.set(target, new Set());
}
function assertAcyclic(graph: ReadonlyMap<string, ReadonlySet<string>>, label: string): void {
  const degrees = new Map([...graph.keys()].map(key => [key, 0]));
  for (const targets of graph.values()) for (const target of targets) degrees.set(target, degrees.get(target)! + 1);
  const queue = [...degrees].filter(([, count]) => count === 0).map(([key]) => key);
  let processed = 0;
  for (let index = 0; index < queue.length; index += 1) {
    processed += 1;
    for (const target of graph.get(queue[index]) ?? []) {
      const next = degrees.get(target)! - 1; degrees.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  if (processed !== degrees.size) fail(`${label} 形成循环`);
}

type SourceAsset = {
  readonly row: CadBomSourceAsset;
  readonly path: string;
  readonly role: "model" | "drawing";
  readonly sourceHash: string;
  readonly partNo: string;
  readonly revision: string;
  readonly part: CadBomTransferPart | null;
};
type SemanticAsset = Omit<SourceAsset, "row">;
type SemanticReference = {
  readonly host: string;
  readonly target: string;
  readonly targetIdentity: string;
  readonly role: "physical" | "drawing_source";
  readonly quantity?: number;
};

function sourceFingerprint(assets: SemanticAsset[], references: SemanticReference[]): string {
  const hash = createHash("sha256"); let bytes = 0;
  const add = (text: string): void => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > CAD_BOM_SOURCE_FINGERPRINT_MAX_BYTES) fail("语义 source fingerprint 超过 64 MiB");
    hash.update(text, "utf8");
  };
  // Stream canonical object-key order; array ordering is deterministic, not DB row order.
  add('{"assets":[');
  assets.sort((left, right) => compare(left.path, right.path)).forEach((asset, index) => {
    if (index > 0) add(","); add(canonicalCadBomTransferJson(asset));
  });
  add('],"references":[');
  references.sort((left, right) => compare(left.host, right.host) || compare(left.target, right.target)
    || compare(left.role, right.role) || compare(left.targetIdentity, right.targetIdentity)
    || (left.quantity ?? 0) - (right.quantity ?? 0)).forEach((reference, index) => {
    if (index > 0) add(","); add(canonicalCadBomTransferJson(reference));
  });
  add('],"schemaVersion":13}');
  return `sha256:${hash.digest("hex")}`;
}

/** Pure completed-scan projection. This does not prove disk freshness or write/export anything. */
export function buildCadBomTransferFromSource(source: CadBomSourceSnapshot, options: CadBomSourceBuildOptions): CadBomTransferEnvelope {
  if (source.schemaVersion !== PNW_WORKSPACE_SCHEMA_VERSION) fail("要求工作空间 Schema 13");
  const scan = source.scan;
  integer(scan.id, "scan.id", 1);
  if (scan.status !== "done" || scan.phase !== "ts-light-index") fail("最新扫描不是完整 ts-light-index done 快照，请重新扫描");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(scan.scanUuid)) fail("scan_uuid 必须是小写 UUID");
  const milliseconds = Date.parse(scan.scannedAt);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== scan.scannedAt) fail("scanned_at 必须是 UTC ISO 时间（含毫秒和 Z）");
  if (!Array.isArray(source.assets) || !Array.isArray(source.references)) fail("assets/references 必须是数组");
  const stats = jsonObject(scan.statsJson, "stats_json");
  if (stats.source !== PNW_CAD_INDEX_WRITE_PROTOCOL) fail("扫描 protocol 不受支持，请重新扫描");
  for (const key of ["complete", "inventory_complete", "bom_complete"]) {
    if (Object.hasOwn(stats, key) && stats[key] !== true) fail(`stats.${key} 不是完整状态`);
  }
  const files = integer(stats.files, "stats.files");
  if (integer(stats.parsed_files, "stats.parsed_files") !== files || integer(stats.parse_failures, "stats.parse_failures") !== 0) fail("扫描存在解析失败或不完整统计");
  if (Object.hasOwn(stats, "failed_count") && integer(stats.failed_count, "stats.failed_count") !== 0) fail("扫描存在失败文件");
  if (integer(stats.references, "stats.references") !== source.references.length) fail("引用数量与完整扫描统计不一致");
  if (integer(stats.bom_lines, "stats.bom_lines") !== integer(source.bomLineCount, "bomLineCount")) fail("BOM 行数量与完整扫描统计不一致");

  const byId = new Map<number, SourceAsset>(), byPath = new Map<string, SourceAsset>();
  const partsByKey = new Map<string, CadBomTransferPart>();
  const semanticAssets: SemanticAsset[] = [];
  for (const row of source.assets) {
    if (typeof row.relativePath !== "string" || typeof row.fileStatus !== "string") fail("资产缺少路径或文件状态");
    if (!/\.fcstd$/iu.test(row.relativePath.replaceAll("\\", "/"))) continue;
    if (row.fileStatus === "missing" || row.fileStatus === "ignored") continue;
    const path = relativePath(row.relativePath, "asset.relativePath"), key = path.toLowerCase();
    // Shared writer exclusions retain historical rows. They do not join this scan.
    if (!pnwCadIndexIncludesPath(path) || cadPathExcludedFromDiscovery(path)) continue;
    if (row.fileStatus !== "present") fail("FCStd 资产存在错误状态，请重新扫描");
    integer(row.id, "asset.id", 1);
    if (byId.has(row.id) || byPath.has(key)) fail("重复资产 ID 或路径（含大小写/./别名）");
    if (row.lastSeenAt !== scan.scannedAt) fail("资产 last_seen_at 不属于当前完整扫描，请重新扫描");
    const metadata = jsonObject(row.bomJson, "bom_json");
    if (metadata.protocol !== PNW_CAD_INDEX_WRITE_PROTOCOL || metadata.version !== 1) fail("资产 snapshot protocol/version 不受支持，请重新扫描");
    if ((Object.hasOwn(metadata, "complete") && metadata.complete !== true)
      || (metadata.parse_error !== undefined && metadata.parse_error !== null && metadata.parse_error !== "")) fail("资产解析失败或 snapshot 不完整，请重新扫描");
    integer(metadata.size_bytes, "bom_json.size_bytes", 1); integer(metadata.mtime_ms, "bom_json.mtime_ms", 1);
    integer(metadata.document_xml_objects, "bom_json.document_xml_objects");
    if (typeof metadata.source_sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(metadata.source_sha256)) fail("资产缺少有效 source_sha256，请重新扫描");
    if (metadata.document_role !== "model" && metadata.document_role !== "drawing") fail("资产缺少真实 document_role，请重新扫描");
    const partNo = nullableText(row.partNo, "asset.partNo"), revision = nullableText(row.revision, "asset.revision");
    let part: CadBomTransferPart | null = null;
    if (metadata.document_role === "model") {
      if (!partNo || !revision) fail("模型缺少 PartNumber 或 Revision");
      part = Object.freeze({ partNo, revision,
        name: nullableText(row.partName, "asset.partName") || nullableText(row.label, "asset.label") || partNo,
        type: nullableText(row.typeCode, "asset.typeCode") || nullableText(row.assetKind, "asset.assetKind") || "CAD",
        term: nullableText(row.modelSeries, "asset.modelSeries"), source: "CAD", description: "", attributes: Object.freeze({}),
      });
      const partKey = identity(part), existing = partsByKey.get(partKey);
      if (existing && canonicalCadBomTransferJson(existing) !== canonicalCadBomTransferJson(part)) fail("同一 PartKey 的模型字段冲突");
      partsByKey.set(partKey, existing ?? part);
    }
    const asset: SourceAsset = { row, path, role: metadata.document_role, sourceHash: metadata.source_sha256, partNo, revision, part };
    byId.set(row.id, asset); byPath.set(key, asset);
    semanticAssets.push({ path, role: asset.role, sourceHash: asset.sourceHash, partNo, revision, part });
  }
  if (byId.size !== files) fail("当前 present FCStd 数量与完整扫描统计不一致");
  if (!partsByKey.size) fail("完整扫描中没有可交付模型零件");
  if (partsByKey.size > 10_000) fail("交付包最多包含 10000 个零件");

  const linesByHost = new Map<string, Map<string, number>>();
  const pathGraph = new Map<string, Set<string>>(), identityGraph = new Map<string, Set<string>>();
  const seenRefs = new Set<number>(), seenLinks = new Set<string>();
  const semanticReferences: SemanticReference[] = [];
  for (const reference of source.references) {
    integer(reference.id, "xref.id", 1);
    if (seenRefs.has(reference.id)) fail("重复 xref ID"); seenRefs.add(reference.id);
    if (reference.scanId !== scan.id) fail("xref 不属于最新完整扫描");
    integer(reference.hostAssetId, "xref.hostAssetId", 1);
    if (reference.resolveStatus !== "resolved") fail("存在未解析引用（包括图纸依赖）");
    integer(reference.targetAssetId, "xref.targetAssetId", 1);
    const hostPath = relativePath(reference.hostRelativePath, "xref.hostRelativePath"), targetPath = relativePath(reference.targetRelativePath, "xref.targetRelativePath");
    const host = byId.get(reference.hostAssetId), target = byId.get(reference.targetAssetId!);
    if (!host || !target || byPath.get(hostPath.toLowerCase()) !== host || byPath.get(targetPath.toLowerCase()) !== target) fail("xref 的资产 ID 与路径关系不一致");
    if (host === target) fail("引用路径不能自引用");
    if (nullableText(reference.targetPartNo, "xref.targetPartNo") !== target.partNo || nullableText(reference.targetRevision, "xref.targetRevision") !== target.revision) fail("xref 目标 PartKey 与资产身份不一致");
    if (typeof reference.xlinkFile !== "string" || !reference.xlinkFile.trim() || reference.xlinkFile.includes("\0")) fail("xref 缺少有效 xlink_file_attr");
    const linkKey = `${host.row.id}\0${reference.xlinkFile}`;
    if (seenLinks.has(linkKey)) fail("重复 host/xlink_file_attr，不能重复计数"); seenLinks.add(linkKey);
    const detail = jsonObject(reference.detailJson, "detail_json");
    if (detail.source !== PNW_CAD_INDEX_WRITE_PROTOCOL || (Object.hasOwn(detail, "complete") && detail.complete !== true)) fail("xref 不是完整扫描 protocol 快照，请重新扫描");
    if (detail.basic_bom === false) {
      if (detail.reference_role !== "drawing_source" || Object.hasOwn(detail, "quantity")) fail("图纸依赖必须明确 drawing_source 且没有 quantity");
      semanticReferences.push({ host: host.path, target: target.path, targetIdentity: identity(target), role: "drawing_source" });
      continue;
    }
    if (detail.basic_bom !== true || (detail.reference_role !== undefined && detail.reference_role !== "physical")) fail("物理引用缺少明确 basic_bom=true");
    if (host.role !== "model" || target.role !== "model" || !host.part || !target.part) fail("图纸不能作为物理 BOM 主件或子件");
    const quantity = integer(detail.quantity, "detail_json.quantity", 1);
    if (quantity > 2_147_483_647) fail("直接数量超过 v1 INT32 上限");
    const targetKey = identity(target.part), lines = linesByHost.get(host.path) ?? new Map<string, number>();
    const total = (lines.get(targetKey) ?? 0) + quantity;
    if (!Number.isSafeInteger(total) || total > 2_147_483_647) fail("合并直接数量超过 v1 INT32 上限");
    lines.set(targetKey, total); linesByHost.set(host.path, lines);
    edge(pathGraph, host.path, target.path); edge(identityGraph, identity(host.part), targetKey);
    semanticReferences.push({ host: host.path, target: target.path, targetIdentity: targetKey, role: "physical", quantity });
  }
  assertAcyclic(pathGraph, "物理路径引用"); assertAcyclic(identityGraph, "物理 PartKey 引用");

  const boms: CadBomTransferBom[] = [], hostKeys = new Set<string>();
  for (const [hostPath, lines] of [...linesByHost].sort(([left], [right]) => compare(left, right))) {
    const host = byPath.get(hostPath.toLowerCase())!.part!, bomKey = identity(host);
    if (hostKeys.has(bomKey)) fail("多个模型宿主映射到同一 BOM"); hostKeys.add(bomKey);
    boms.push({ bomKey, partNo: host.partNo, revision: host.revision, name: host.name.slice(0, 100), description: "", attributes: {},
      items: [...lines].sort(([left], [right]) => compare(left, right)).map(([key, qty]) => {
        const target = partsByKey.get(key)!; return { partNo: target.partNo, revision: target.revision, qty, attributes: {} };
      }),
    });
  }
  const payload = { parts: [...partsByKey.values()].sort((left, right) => compare(identity(left), identity(right))), boms: boms.sort((left, right) => compare(left.bomKey, right.bomKey)), attachments: [] as [] };
  const fingerprint = sourceFingerprint(semanticAssets, semanticReferences);
  return normalizeCadBomTransferEnvelope({ schema: CAD_BOM_TRANSFER_SCHEMA, schemaVersion: CAD_BOM_TRANSFER_SCHEMA_VERSION,
    transferId: scan.scanUuid, createdAt: scan.scannedAt, producer: { id: "phoenix-desk-tools", version: options.producerVersion },
    workspace: { schemaVersion: 13, fingerprint, scanId: scan.scanUuid, scannedAt: scan.scannedAt }, payloadHash: cadBomTransferPayloadHash(payload), ...payload,
  });
}
