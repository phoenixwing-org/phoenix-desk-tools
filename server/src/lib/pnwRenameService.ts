import fs from "node:fs";
import path from "node:path";
import { pnwCreateDb } from "phoenix-wing/db/pnwDbAdapter";
import { patchFcstdXlinkAttributes } from "./fcstdReferenceLabelService.js";
import { patchBomLinkLabels, refreshBomXrefsForHosts } from "./pnwBomXrefService.js";

export type RenameLog = {
  id: number;
  old_repo_rel_path: string;
  new_repo_rel_path: string;
  old_filename: string;
  new_filename: string;
  old_basename: string;
  new_basename: string;
  created_at: string;
};

export type RefScanPayload = {
  rename_log_id: number | null;
  old_basename?: string;
  new_basename?: string;
  transitive?: boolean;
  host_count: number;
  direct_host_count?: number;
  hit_count: number;
  pending_hit_count?: number;
  hosts: Array<{
    host_repo_rel_path: string;
    host_filename: string;
    hit_count: number;
    depth?: number;
    usage_kind?: "direct" | "indirect" | string;
    via_chain?: string[];
    hits: Array<{
      id: number;
      matched_text: string;
      proposed_text: string;
      status: string;
    }>;
  }>;
};

type RenameStore = {
  version: number;
  next_id: number;
  entries: RenameLog[];
};

const STORE_VERSION = 1;
const RENAME_LOG_BASENAME = "rename-logs.json";

function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function pathDisplay(p: string): string {
  return p ? path.normalize(p) : "";
}

function workspaceOk(root: string): boolean {
  try {
    return Boolean(root) && fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

function normalizeRelPath(raw: unknown): string {
  let rel = String(raw || "").trim().replace(/\\/g, "/");
  while (rel.startsWith("./")) rel = rel.slice(2);
  rel = rel.replace(/^\/+/, "");
  if (!rel || rel.split("/").includes("..") || path.isAbsolute(rel)) {
    throw new Error(`Invalid workspace-relative path: ${String(raw || "")}`);
  }
  return rel;
}

function resolveRel(workspaceRoot: string, rawRel: unknown): { rel: string; abs: string } {
  if (!workspaceOk(workspaceRoot)) throw new Error("Workspace is not configured");
  const rel = normalizeRelPath(rawRel);
  const abs = path.resolve(workspaceRoot, rel);
  const back = path.relative(workspaceRoot, abs);
  if (back.startsWith("..") || path.isAbsolute(back)) {
    throw new Error(`Path escapes workspace: ${rel}`);
  }
  return { rel, abs };
}

function validateFilename(raw: unknown): string {
  const filename = String(raw || "").trim();
  if (!filename) throw new Error("Target filename is required");
  if (filename.includes("/") || filename.includes("\\")) throw new Error("Target filename must not contain path separators");
  if (filename === "." || filename === ".." || filename.includes("..")) throw new Error("Target filename must not contain '..'");
  if (/[<>:"|?*\x00-\x1F]/.test(filename)) throw new Error("Target filename contains characters not allowed on Windows");
  if (filename.length > 255) throw new Error("Target filename is too long");
  return filename;
}

function storePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".phoenix", RENAME_LOG_BASENAME);
}

function emptyStore(): RenameStore {
  return { version: STORE_VERSION, next_id: 1, entries: [] };
}

function readStore(workspaceRoot: string): RenameStore {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(workspaceRoot), "utf8"));
    const entries = Array.isArray(raw.entries) ? raw.entries : [];
    const maxId = entries.reduce((n: number, entry: any) => Math.max(n, Number(entry.id || 0)), 0);
    return {
      version: Number(raw.version || STORE_VERSION),
      next_id: Math.max(Number(raw.next_id || 1), maxId + 1),
      entries,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(workspaceRoot: string, store: RenameStore): void {
  const file = storePath(workspaceRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

function addLog(workspaceRoot: string, entry: Omit<RenameLog, "id" | "created_at">): RenameLog {
  const store = readStore(workspaceRoot);
  const log: RenameLog = { id: store.next_id, created_at: utcNowIso(), ...entry };
  store.next_id += 1;
  store.entries.unshift(log);
  writeStore(workspaceRoot, store);
  return log;
}

export function listRenameLogs(workspaceRoot: string, opts: { limit?: number; rel?: string } = {}) {
  const file = workspaceRoot ? storePath(workspaceRoot) : "";
  if (!workspaceOk(workspaceRoot)) {
    return { database_path: file, database_path_display: pathDisplay(file), entries: [] };
  }
  const relFilter = opts.rel ? normalizeRelPath(opts.rel) : "";
  const limit = Math.max(1, Math.min(200, Number(opts.limit || 50)));
  const entries = readStore(workspaceRoot).entries
    .filter((entry) => !relFilter || entry.old_repo_rel_path === relFilter || entry.new_repo_rel_path === relFilter)
    .slice(0, limit);
  return { database_path: file, database_path_display: pathDisplay(file), entries };
}

export function getRenameLog(workspaceRoot: string, id: number): RenameLog | null {
  if (!workspaceOk(workspaceRoot)) return null;
  return readStore(workspaceRoot).entries.find((entry) => entry.id === id) || null;
}

export function executeDiskFileRename(workspaceRoot: string, rel: string, body: any = {}) {
  const oldPath = resolveRel(workspaceRoot, rel);
  if (!fs.existsSync(oldPath.abs) || !fs.statSync(oldPath.abs).isFile()) {
    throw new Error(`File does not exist: ${oldPath.rel}`);
  }
  const oldFilename = path.basename(oldPath.rel);
  const newFilename = validateFilename(body.filename ?? body.new_filename);
  if (newFilename === oldFilename) throw new Error("Target filename is the same as the current filename");
  const dirRel = path.posix.dirname(oldPath.rel);
  const newRel = dirRel === "." ? newFilename : `${dirRel}/${newFilename}`;
  const newPath = resolveRel(workspaceRoot, newRel);
  if (fs.existsSync(newPath.abs)) throw new Error(`Target file already exists: ${newRel}`);

  fs.renameSync(oldPath.abs, newPath.abs);

  const log = addLog(workspaceRoot, {
    old_repo_rel_path: oldPath.rel,
    new_repo_rel_path: newRel,
    old_filename: oldFilename,
    new_filename: newFilename,
    old_basename: oldFilename,
    new_basename: newFilename,
  });

  return {
    rel_path: newRel,
    filename: newFilename,
    map_updated: false,
    attrs_saved: false,
    rename_log_id: log.id,
    rename_log: log,
  };
}

type RenameEdge = {
  host_repo_rel_path: string;
  xlink_file_attr: string;
  target_basename: string;
  target_repo_rel_path: string | null;
  resolve_status: string;
  link_label: string;
  rule_label: string;
  target_asset_label: string;
};

type RenameTerms = {
  logId: number | null;
  log: RenameLog | null;
  oldBasename: string;
  newBasename: string;
  oldTargetRel: string;
  newTargetRel: string;
  excludeRel: string;
};

function cleanRel(raw: unknown): string {
  if (!String(raw || "").trim()) return "";
  try {
    return normalizeRelPath(raw);
  } catch {
    return "";
  }
}

function loadRenameEdges(workspaceRoot: string): RenameEdge[] {
  const filename = path.join(workspaceRoot, ".phoenix", "phoenix-workspace.sqlite");
  if (!workspaceOk(workspaceRoot) || !fs.existsSync(filename)) return [];
  const db = pnwCreateDb(filename);
  try {
    const table = db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='phoenix_cad_bom_xref'",
    );
    if (!table) return [];
    return db.all<RenameEdge>(
      `SELECT host_repo_rel_path, xlink_file_attr, target_basename,
              target_repo_rel_path, resolve_status, link_label, rule_label,
              target_asset_label
       FROM phoenix_cad_bom_xref
       ORDER BY host_repo_rel_path, xlink_file_attr`,
    ).map((edge) => ({
      ...edge,
      host_repo_rel_path: cleanRel(edge.host_repo_rel_path),
      target_repo_rel_path: edge.target_repo_rel_path ? cleanRel(edge.target_repo_rel_path) : null,
    }));
  } finally {
    db.close();
  }
}

function filenameFrom(value: unknown): string {
  return path.posix.basename(String(value || "").replace(/\\/g, "/").trim());
}

function nameMatches(actualFilename: string, requested: string): boolean {
  const actual = filenameFrom(actualFilename).toLowerCase();
  const term = filenameFrom(requested).toLowerCase();
  if (!actual || !term) return false;
  if (actual === term) return true;
  return actual.replace(/\.fcstd$/i, "") === term.replace(/\.fcstd$/i, "");
}

function replacementFilename(actualFilename: string, requested: string): string {
  const actual = filenameFrom(actualFilename);
  let next = filenameFrom(requested);
  if (!next) return actual;
  if (/\.fcstd$/i.test(actual) && !/\.fcstd$/i.test(next)) next += ".FCStd";
  return next;
}

function replaceRelFilename(rel: string, filename: string): string {
  const normalized = cleanRel(rel);
  const dir = path.posix.dirname(normalized);
  return dir === "." ? filename : `${dir}/${filename}`;
}

function preferredXlinkAttr(hostRel: string, targetRel: string): string {
  const hostDir = path.posix.dirname(cleanRel(hostRel));
  return path.posix.relative(hostDir === "." ? "" : hostDir, cleanRel(targetRel)) || filenameFrom(targetRel);
}

function replaceAttrFilename(oldAttr: string, nextFilename: string): string {
  const normalized = String(oldAttr || "").replace(/\\/g, "/");
  const oldFilename = filenameFrom(normalized);
  return normalized.slice(0, normalized.length - oldFilename.length) + nextFilename;
}

function resolveRenameTerms(workspaceRoot: string, body: any = {}): RenameTerms {
  const logId = Number(body.rename_log_id || body.renameLogId || 0) || null;
  const log = logId ? getRenameLog(workspaceRoot, logId) : null;
  if (logId && !log) throw new Error(`Rename log not found: ${logId}`);
  const oldBasename = String(
    body.old_basename || body.oldBasename || log?.old_filename || log?.old_basename || "",
  ).trim();
  if (!oldBasename) throw new Error("old_basename or rename_log_id is required");
  const newBasename = String(
    body.new_basename || body.newBasename || log?.new_filename || log?.new_basename || oldBasename,
  ).trim() || oldBasename;
  const oldTargetRel = cleanRel(
    body.old_repo_rel_path || body.oldRepoRelPath || body.target_repo_rel || body.targetRepoRel || log?.old_repo_rel_path,
  );
  let newTargetRel = cleanRel(body.new_repo_rel_path || body.newRepoRelPath || log?.new_repo_rel_path);
  if (!newTargetRel && oldTargetRel) {
    newTargetRel = replaceRelFilename(
      oldTargetRel,
      replacementFilename(filenameFrom(oldTargetRel), newBasename),
    );
  }
  const excludeRel = cleanRel(body.exclude_repo_rel || body.excludeRepoRel || log?.new_repo_rel_path);
  return { logId, log, oldBasename, newBasename, oldTargetRel, newTargetRel, excludeRel };
}

function edgeMatchesName(edge: RenameEdge, name: string): boolean {
  return nameMatches(edge.target_basename, name) || nameMatches(filenameFrom(edge.xlink_file_attr), name);
}

function directEdgesForRename(edges: RenameEdge[], terms: RenameTerms): RenameEdge[] {
  return edges.filter((edge) => (
    edge.host_repo_rel_path
    && edge.host_repo_rel_path !== terms.excludeRel
    && edgeMatchesName(edge, terms.oldBasename)
  ));
}

function labelEdgesForRename(edges: RenameEdge[], terms: RenameTerms): RenameEdge[] {
  const targetPaths = new Set([terms.oldTargetRel, terms.newTargetRel].filter(Boolean));
  return edges.filter((edge) => {
    if (!edge.host_repo_rel_path || edge.host_repo_rel_path === terms.excludeRel) return false;
    if (edge.target_repo_rel_path && targetPaths.has(edge.target_repo_rel_path)) return true;
    return edgeMatchesName(edge, terms.oldBasename) || edgeMatchesName(edge, terms.newBasename);
  });
}

function proposedAttr(edge: RenameEdge, terms: RenameTerms): string {
  const actualFilename = filenameFrom(edge.xlink_file_attr || edge.target_basename);
  const nextFilename = replacementFilename(actualFilename, terms.newBasename);
  let targetRel = terms.newTargetRel;
  if (!targetRel && edge.target_repo_rel_path) {
    targetRel = nameMatches(filenameFrom(edge.target_repo_rel_path), terms.oldBasename)
      ? replaceRelFilename(edge.target_repo_rel_path, nextFilename)
      : edge.target_repo_rel_path;
  }
  return targetRel
    ? preferredXlinkAttr(edge.host_repo_rel_path, targetRel)
    : replaceAttrFilename(edge.xlink_file_attr, nextFilename);
}

function parentMap(edges: RenameEdge[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!edge.target_repo_rel_path || !["resolved", "ambiguous", "self"].includes(edge.resolve_status)) continue;
    const target = cleanRel(edge.target_repo_rel_path);
    const host = cleanRel(edge.host_repo_rel_path);
    if (!target || !host) continue;
    if (!out.has(target)) out.set(target, new Set());
    out.get(target)!.add(host);
  }
  return out;
}

function buildScanPayload(
  edges: RenameEdge[],
  directEdges: RenameEdge[],
  terms: RenameTerms,
  transitive: boolean,
): RefScanPayload {
  const hitsByHost = new Map<string, RefScanPayload["hosts"][number]["hits"]>();
  let hitId = 1;
  for (const edge of directEdges) {
    const host = cleanRel(edge.host_repo_rel_path);
    if (!hitsByHost.has(host)) hitsByHost.set(host, []);
    const proposed = proposedAttr(edge, terms);
    hitsByHost.get(host)!.push({
      id: hitId++,
      matched_text: edge.xlink_file_attr,
      proposed_text: proposed,
      status: proposed === edge.xlink_file_attr.replace(/\\/g, "/") ? "ok" : "pending",
    });
  }

  const hosts: RefScanPayload["hosts"] = [...hitsByHost.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([host, hits]) => ({
      host_repo_rel_path: host,
      host_filename: filenameFrom(host),
      hit_count: hits.length,
      depth: 0,
      usage_kind: "direct",
      via_chain: [],
      hits,
    }));

  if (transitive) {
    const parents = parentMap(edges);
    const visited = new Set(hosts.map((host) => host.host_repo_rel_path));
    const queue: Array<{ host: string; depth: number; via: string[] }> = [];
    for (const direct of hosts) {
      for (const parent of parents.get(direct.host_repo_rel_path) || []) {
        queue.push({ host: parent, depth: 1, via: [direct.host_repo_rel_path] });
      }
    }
    while (queue.length) {
      const item = queue.shift()!;
      if (visited.has(item.host)) continue;
      visited.add(item.host);
      hosts.push({
        host_repo_rel_path: item.host,
        host_filename: filenameFrom(item.host),
        hit_count: 0,
        depth: item.depth,
        usage_kind: "indirect",
        via_chain: item.via,
        hits: [],
      });
      for (const parent of parents.get(item.host) || []) {
        queue.push({ host: parent, depth: item.depth + 1, via: [item.host, ...item.via] });
      }
    }
  }

  const hitCount = hosts.reduce((sum, host) => sum + host.hit_count, 0);
  const pending = hosts.reduce(
    (sum, host) => sum + host.hits.filter((hit) => hit.status === "pending").length,
    0,
  );
  return {
    rename_log_id: terms.logId,
    old_basename: terms.oldBasename,
    new_basename: terms.newBasename,
    transitive,
    host_count: hosts.length,
    direct_host_count: hitsByHost.size,
    hit_count: hitCount,
    pending_hit_count: pending,
    hosts,
  };
}

export function analyzeRenameReferences(workspaceRoot: string, body: any = {}): RefScanPayload {
  const terms = resolveRenameTerms(workspaceRoot, body);
  const edges = loadRenameEdges(workspaceRoot);
  return buildScanPayload(edges, directEdgesForRename(edges, terms), terms, body.transitive !== false);
}

function selectedDirectHosts(
  scan: RefScanPayload,
  rawSelected: unknown,
  requirePending: boolean,
): { hosts: Set<string>; unknown: string[] } {
  const selected = [...new Set((Array.isArray(rawSelected) ? rawSelected : []).map(cleanRel).filter(Boolean))];
  if (!selected.length) throw new Error("At least one host must be selected");
  const byHost = new Map(scan.hosts.map((host) => [cleanRel(host.host_repo_rel_path), host]));
  const direct = new Set<string>();
  const unknown: string[] = [];
  for (const rel of selected) {
    const host = byHost.get(rel);
    if (!host) {
      unknown.push(rel);
      continue;
    }
    const ownMatches = requirePending
      ? host.hits.some((hit) => hit.status === "pending" && hit.proposed_text !== hit.matched_text)
      : host.hits.length > 0;
    if (ownMatches) direct.add(rel);
    for (const chainRel of host.via_chain || []) {
      const chainHost = byHost.get(cleanRel(chainRel));
      if (!chainHost) continue;
      const chainMatches = requirePending
        ? chainHost.hits.some((hit) => hit.status === "pending" && hit.proposed_text !== hit.matched_text)
        : chainHost.hits.length > 0;
      if (chainMatches) direct.add(cleanRel(chainRel));
    }
  }
  return { hosts: direct, unknown };
}

function completedScan(scan: RefScanPayload, appliedHosts: Set<string>): RefScanPayload {
  const hosts = scan.hosts.map((host) => ({
    ...host,
    hits: host.hits.map((hit) => (
      appliedHosts.has(cleanRel(host.host_repo_rel_path)) && hit.status === "pending"
        ? { ...hit, status: "applied" }
        : hit
    )),
  }));
  return {
    ...scan,
    hosts,
    pending_hit_count: hosts.reduce((sum, host) => sum + host.hits.filter((hit) => hit.status === "pending").length, 0),
  };
}

function fallbackRuleLabel(edge: RenameEdge): string {
  const explicit = String(edge.rule_label || edge.target_asset_label || "").trim();
  if (explicit) return explicit;
  return filenameFrom(edge.target_basename || edge.target_repo_rel_path).replace(/\.fcstd$/i, "");
}

function applyRenameLabels(
  workspaceRoot: string,
  body: any,
  terms: RenameTerms,
  edges: RenameEdge[],
) {
  const labelScope = body.label_scope === "host_all" ? "host_all" : "incoming";
  const selected: string[] = [
    ...new Set<string>(
      (Array.isArray(body.host_repo_rel_paths) ? body.host_repo_rel_paths : [])
        .map((value: unknown) => cleanRel(value))
        .filter(Boolean),
    ),
  ];
  if (!selected.length) throw new Error("At least one host must be selected");
  const matchingEdges = labelEdgesForRename(edges, terms);
  const labelScan = buildScanPayload(edges, matchingEdges, terms, body.transitive !== false);
  let hostSet: Set<string>;
  const failed: Array<{ host_repo_rel_path: string; error: string }> = [];
  if (labelScope === "host_all") {
    hostSet = new Set(selected);
  } else {
    const expanded = selectedDirectHosts(labelScan, selected, false);
    hostSet = expanded.hosts;
    failed.push(...expanded.unknown.map((host) => ({ host_repo_rel_path: host, error: "No matching XLink host found" })));
  }

  const sourceEdges = labelScope === "host_all"
    ? edges.filter((edge) => hostSet.has(cleanRel(edge.host_repo_rel_path)))
    : matchingEdges.filter((edge) => hostSet.has(cleanRel(edge.host_repo_rel_path)));
  const patches = sourceEdges.map((edge) => ({
    host_repo_rel: cleanRel(edge.host_repo_rel_path),
    xlink_file_attr: edge.xlink_file_attr,
    link_label: fallbackRuleLabel(edge),
  })).filter((patch) => patch.link_label);
  const patched = patches.length
    ? patchBomLinkLabels(workspaceRoot, patches)
    : { label_patches: 0, applied_hosts: [], failed: [], label_changes: [] };
  failed.push(...(patched.failed || []).map((item: any) => ({
    host_repo_rel_path: cleanRel(item.host_repo_rel),
    error: String(item.error || "Label patch failed"),
  })));
  return {
    rename_log_id: terms.logId,
    old_basename: terms.oldBasename,
    new_basename: terms.newBasename,
    applied_hosts: (patched.applied_hosts || []).map(cleanRel),
    failed,
    xlink_patches: 0,
    label_patches: Number(patched.label_patches || 0),
    label_changes: patched.label_changes || [],
    scan: labelScan,
  };
}

export function applyRenameCorrections(workspaceRoot: string, body: any = {}) {
  const terms = resolveRenameTerms(workspaceRoot, body);
  const edges = loadRenameEdges(workspaceRoot);
  if (Boolean(body.labels_only || body.labelsOnly)) {
    return applyRenameLabels(workspaceRoot, body, terms, edges);
  }

  const scan = buildScanPayload(edges, directEdgesForRename(edges, terms), terms, body.transitive !== false);
  const selected = selectedDirectHosts(scan, body.host_repo_rel_paths, true);
  const failed: Array<{ host_repo_rel_path: string; error: string }> = selected.unknown.map((host) => ({
    host_repo_rel_path: host,
    error: "No pending XLink hit found",
  }));
  const appliedHosts: string[] = [];
  let xlinkPatches = 0;

  for (const hostRel of selected.hosts) {
    const host = scan.hosts.find((item) => cleanRel(item.host_repo_rel_path) === hostRel);
    const replacements = Object.fromEntries(
      (host?.hits || [])
        .filter((hit) => hit.status === "pending" && hit.proposed_text !== hit.matched_text)
        .map((hit) => [hit.matched_text, hit.proposed_text]),
    );
    if (!Object.keys(replacements).length) continue;
    try {
      const { abs } = resolveRel(workspaceRoot, hostRel);
      if (!/\.fcstd$/i.test(abs)) throw new Error("XLink host must be an FCStd file");
      const result = patchFcstdXlinkAttributes(abs, replacements);
      if (result.count < 1) throw new Error("No selected XLink file attribute was found; run analysis again");
      xlinkPatches += result.count;
      appliedHosts.push(hostRel);
    } catch (error: any) {
      failed.push({ host_repo_rel_path: hostRel, error: error.message || String(error) });
    }
  }
  if (appliedHosts.length) refreshBomXrefsForHosts(workspaceRoot, appliedHosts);
  return {
    rename_log_id: terms.logId,
    old_basename: terms.oldBasename,
    new_basename: terms.newBasename,
    applied_hosts: appliedHosts,
    failed,
    xlink_patches: xlinkPatches,
    label_patches: 0,
    label_changes: [],
    scan: completedScan(scan, new Set(appliedHosts)),
  };
}

export function loadRenameAnalysis(workspaceRoot: string, logId: number) {
  const log = getRenameLog(workspaceRoot, logId);
  if (!log) throw new Error(`Rename log not found: ${logId}`);
  return { rename_log: log, scan: analyzeRenameReferences(workspaceRoot, { rename_log_id: logId, transitive: true }) };
}

export function exportRenameReport(workspaceRoot: string, body: any = {}) {
  if (!workspaceOk(workspaceRoot)) throw new Error("Workspace is not configured");
  const outDir = path.join(workspaceRoot, ".phoenix");
  fs.mkdirSync(outDir, { recursive: true });
  const id = Number(body.rename_log_id || 0) || Date.now();
  const outPath = path.join(outDir, `rename-analysis-${id}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ ...body, exported_at: utcNowIso() }, null, 2), "utf8");
  return { report_path: outPath, report_path_display: pathDisplay(outPath) };
}

export function previewRenameUnsaved(baseline: Record<string, string>, current: Record<string, string>): any {
  const changed = Object.keys(baseline).some((k) => baseline[k] !== current[k]);
  return { has_unsaved_document_attrs: changed };
}
