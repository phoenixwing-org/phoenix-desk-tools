import fs from "node:fs";
import path from "node:path";
import { pnwExtractXlinksFromDocumentXml } from "@phoenix-wing/cad-core";
import { cadPathExcludedFromDiscovery } from "../../lib/cadIndexScanScope.js";
import { fcstdFingerprint, readFcstdLightArchive, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import { reconcileFcstdPropertyCounts } from "../../lib/fcstdPropertyCounts.js";
import { fileStamp, indexFiles, relativeFile } from "./storage.js";

export interface GalleryScopeProof {
  version: 1;
  product: string;
  sources: Array<{ rel: string; stamp: string; hash: string; refs: string[] }>;
}
export interface GalleryScopeObservation {
  members: string[];
  sources: GalleryScopeProof["sources"];
  issues: Array<{ rel: string; message: string }>;
  complete: boolean;
}

const MAX_MEMBERS = 5000, MAX_REFS = 25000, MAX_PROOF_BYTES = 8 * 1024 * 1024, MAX_TEXT_BYTES = 4096;
const OUTSIDE_REFERENCE = "图册引用超出工作空间，不允许 .. 越界";
const hashPattern = /^[a-f0-9]{64}$/;
const stampPattern = /^\d+:\d+:-?\d+(?:\.\d+)?:-?\d+(?:\.\d+)?$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).sort().join(",") === expected.sort().join(",");
const boundedText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !value.includes("\0") && Buffer.byteLength(value) <= MAX_TEXT_BYTES;
const knownMissing = (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
const unsafeSourceMessage = (error: unknown) => error instanceof Error && error.message === "不处理符号链接"
  ? "符号链接不可用于图册范围" : "源文件不可安全访问，当前范围未确认";
function sourceRel(value: string): string {
  const rel = relativeFile(value);
  if (!/\.fcstd$/i.test(rel) || cadPathExcludedFromDiscovery(rel) || Buffer.byteLength(rel) > MAX_TEXT_BYTES) throw new Error("图册源路径不在默认 FCStd 范围内");
  return rel;
}
const scopeProduct = (value: string) => value ? sourceRel(value) : "";

function validatedProof(value: unknown, product: string): GalleryScopeProof | null {
  if (!record(value) || !keys(value, ["version", "product", "sources"]) || value.version !== 1 || value.product !== product
    || !Array.isArray(value.sources) || value.sources.length > MAX_MEMBERS) return null;
  const sources: GalleryScopeProof["sources"] = [], seen = new Set<string>();
  let references = 0;
  for (const source of value.sources) {
    if (!record(source) || !keys(source, ["rel", "stamp", "hash", "refs"]) || !boundedText(source.rel)
      || typeof source.stamp !== "string" || source.stamp.length > 256 || !stampPattern.test(source.stamp)
      || typeof source.hash !== "string" || !hashPattern.test(source.hash) || !Array.isArray(source.refs) || source.refs.length > MAX_MEMBERS) return null;
    try { if (sourceRel(source.rel) !== source.rel) return null; } catch { return null; }
    if (seen.has(source.rel) || (references += source.refs.length) > MAX_REFS || !source.refs.every(boundedText)) return null;
    seen.add(source.rel);
    sources.push({ rel: source.rel, stamp: source.stamp, hash: source.hash, refs: [...source.refs] });
  }
  return { version: 1, product, sources };
}

/** A cache hint for this exact scope, never a publication or Native authority. */
export function parseGalleryScopeProof(raw: string | undefined, product: string): GalleryScopeProof | null {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > MAX_PROOF_BYTES) return null;
  try { return validatedProof(JSON.parse(raw), scopeProduct(product)); } catch { return null; }
}
export function serializeGalleryScopeProof(proof: GalleryScopeProof): string {
  let value: GalleryScopeProof | null, serialized: string;
  try {
    value = validatedProof(proof, scopeProduct(proof.product));
    if (!value) throw new Error();
    serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > MAX_PROOF_BYTES) throw new Error();
  } catch { throw new Error("图册范围证明无效或超过安全上限"); }
  return serialized;
}

/** Lexical resolution only. A missing target is still returned for diagnosis. */
export function resolveGalleryReference(root: string, hostRel: string, file: string): string | null {
  const host = sourceRel(hostRel);
  if (!boundedText(file)) throw new Error("图册引用路径无效");
  const normalized = file.replace(/\\/g, "/");
  if (/^(?:\/|[A-Za-z][\w+.-]*:)/.test(normalized) || !/\.fcstd$/i.test(normalized)) throw new Error("图册引用必须是工作空间内的 FCStd 相对路径");
  const base = path.resolve(root), target = path.resolve(base, path.dirname(host), normalized);
  const relative = path.relative(base, target).replace(/\\/g, "/");
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(OUTSIDE_REFERENCE);
  if (cadPathExcludedFromDiscovery(relative)) return null;
  return sourceRel(relative);
}

function liveSource(root: string, rel: string): { filename: string; stamp: string } {
  const filename = safeFcstdPath(root, sourceRel(rel));
  if (!fs.lstatSync(filename).isFile()) throw new Error("图册源不是普通文件");
  return { filename, stamp: fileStamp(filename) };
}

/** Read-only membership observation, independent of shared thumbnail rows.
 * Matching independent proofs avoid opening CAD archives on ordinary GETs.
 * New/changed sources read only Document.xml, never thumbnail PNG members. */
export function observeGalleryScope(root: string, product: string, proof?: GalleryScopeProof | null): GalleryScopeObservation {
  const result: GalleryScopeObservation = { members: [], sources: [], issues: [], complete: true };
  const issue = (rel: string, message: string, incomplete = true) => {
    if (result.issues.length < MAX_REFS) result.issues.push({ rel, message });
    if (incomplete) result.complete = false;
  };
  let key: string, seeds: string[];
  try { key = scopeProduct(product); seeds = key ? [key] : indexFiles(root); }
  catch { issue("", "图册范围或 CAD 索引不可安全读取"); return result; }
  // Validate even host-supplied typed values: malformed hints cannot authorize
  // skipping the actual XML read. A legacy/missing proof simply falls back.
  const independent = proof ? validatedProof(proof, key) : null;
  const hints = new Map((independent?.sources || []).map(source => [source.rel, source]));
  const queue = [...new Set(seeds)], queued = new Set(queue), graph = new Map<string, string[]>();
  const observed = new Map<string, string>();
  if (queue.length > MAX_MEMBERS) { queue.length = MAX_MEMBERS; issue(key, "图册范围超过 5000 个文件安全上限"); }
  let totalRefs = 0, proofBytes = 128;
  for (let index = 0; index < queue.length; index++) {
    const rel = queue[index];
    let live: ReturnType<typeof liveSource>;
    try { live = liveSource(root, rel); }
    catch (error) {
      const missing = knownMissing(error);
      issue(rel, missing ? "源文件已缺失，已从当前图册范围排除" : unsafeSourceMessage(error), !missing); continue;
    }
    result.members.push(rel); observed.set(rel, live.stamp);
    let source: GalleryScopeProof["sources"][number];
    try {
      const hint = hints.get(rel);
      if (hint?.stamp === live.stamp) source = { ...hint, refs: [...hint.refs] };
      else {
        const archive = readFcstdLightArchive(live.filename);
        // Same structural check as the existing batch reader, without invoking
        // BOM/index semantic projection or using the returned patched XML.
        reconcileFcstdPropertyCounts(archive.xml);
        const semanticXml = archive.xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "");
        source = { rel, stamp: live.stamp, hash: fcstdFingerprint(archive.bytes), refs: pnwExtractXlinksFromDocumentXml(semanticXml).map(link => link.file) };
      }
      if (liveSource(root, rel).stamp !== live.stamp) throw new Error();
      if (source.refs.length > MAX_MEMBERS || !source.refs.every(boundedText) || (totalRefs += source.refs.length) > MAX_REFS) {
        issue(rel, "图册引用数量或路径超过安全上限"); continue;
      }
      proofBytes += Buffer.byteLength(JSON.stringify(source));
      if (proofBytes > MAX_PROOF_BYTES - MAX_TEXT_BYTES) { issue(rel, "图册范围证明超过安全上限"); continue; }
      result.sources.push(source);
    } catch { issue(rel, "Document.xml 无法安全读取或源文件在读取期间变化"); continue; }
    const targets: string[] = [];
    for (const file of source.refs) {
      let target: string | null;
      try { target = resolveGalleryReference(root, rel, file); }
      catch (error) { issue(rel, error instanceof Error && error.message === OUTSIDE_REFERENCE ? OUTSIDE_REFERENCE : "存在越界或无效的 FCStd 引用"); continue; }
      if (!target) continue;
      targets.push(target);
      if (key) {
        if (queued.has(target)) continue;
        if (queue.length >= MAX_MEMBERS) { issue(rel, "图册范围超过 5000 个文件安全上限"); continue; }
        queued.add(target); queue.push(target);
      } else {
        // Global scope contains only indexed seeds, but broken references must
        // still be visible without expanding or opening unindexed archives.
        try { liveSource(root, target); }
        catch (error) {
          const missing = knownMissing(error);
          issue(target, missing ? "引用文件已缺失，保留断链提示" : unsafeSourceMessage(error), !missing);
        }
      }
    }
    graph.set(rel, targets);
  }
  // A source checked early can disappear/change while another archive is read.
  // Such observations remain incomplete, and no stale source proof is emitted.
  const changed = new Set<string>(), missing = new Set<string>();
  for (const [rel, stamp] of observed) {
    try { if (liveSource(root, rel).stamp !== stamp) { changed.add(rel); issue(rel, "源文件在范围核验期间变化，请重新更新图册"); } }
    catch { changed.add(rel); missing.add(rel); issue(rel, "源文件在范围核验期间缺失或不可安全访问"); }
  }
  result.members = result.members.filter(rel => !missing.has(rel));
  result.sources = result.sources.filter(source => !changed.has(source.rel));
  const members = new Set(result.members), done = new Set<string>(), active = new Set<string>(), cycles = new Set<string>();
  for (const start of result.members) {
    const stack: Array<[string, boolean]> = [[start, false]];
    while (stack.length) {
      const [rel, exit] = stack.pop()!;
      if (exit) { active.delete(rel); done.add(rel); continue; }
      if (active.has(rel)) { if (!cycles.has(rel)) { cycles.add(rel); issue(rel, "文件引用存在循环，已去重停止展开", false); } continue; }
      if (done.has(rel) || !members.has(rel)) continue;
      active.add(rel); stack.push([rel, true]);
      for (const next of graph.get(rel) || []) stack.push([next, false]);
    }
  }
  return result;
}
