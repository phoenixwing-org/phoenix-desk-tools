import type { CaaDialogIr } from "../types/caaDialogIr";
import type { CaaDialogListResponse } from "../types/caaDialogList";
import type { CaaFilePreviewPayload } from "../utils/caaRelatedFilePreview";

export type CaaHealthPayload = {
  ok: boolean;
  service?: string;
  port?: number;
  url?: string;
  proxyPath?: string;
};

export type CaaControlTypeCoverageRow = {
  type: string;
  count: number;
  dialog_count: number;
  known: boolean;
};

export type CaaControlTypeCoverage = {
  catalog_type_count: number;
  total_types: number;
  known_types: number;
  unknown_types: number;
  total_controls: number;
  unknown_controls: number;
  types: CaaControlTypeCoverageRow[];
  unknown: CaaControlTypeCoverageRow[];
};

export type CaaIndexStats = {
  dialogs?: number;
  total?: number;
  control_type_coverage?: CaaControlTypeCoverage;
};

export type CaaIndexListResult = CaaDialogListResponse & {
  indexed: boolean;
  indexFallback?: boolean;
  last_scan_at?: string | null;
  stats?: CaaIndexStats;
  summary?: string;
};

export async function fetchCaaHealth(): Promise<CaaHealthPayload> {
  const res = await fetch("/api/caa/health");
  if (!res.ok) throw new Error(`CAA health ${res.status}`);
  return res.json();
}

export async function fetchCaaDialogList(
  workspaceRoot: string,
  opts?: { rels?: string[]; includeDemo?: boolean },
): Promise<CaaDialogListResponse> {
  const res = await fetch("/api/caa/dialog/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceRoot,
      includeDemo: opts?.includeDemo ?? true,
      rels: opts?.rels,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? `list failed ${res.status}`);
  }
  return data as CaaDialogListResponse;
}

function filterDialogGroups(groups: CaaDialogListResponse["groups"], q?: string): CaaDialogListResponse["groups"] {
  const needle = q?.trim().toLowerCase();
  if (!needle) return groups;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.dialogName.toLowerCase().includes(needle) ||
          item.fileName.toLowerCase().includes(needle) ||
          item.groupKey.toLowerCase().includes(needle) ||
          item.catDlgRel.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

function countDialogGroups(groups: CaaDialogListResponse["groups"]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
}

async function fallbackCaaIndexGroups(workspaceRoot: string, q?: string): Promise<CaaIndexListResult> {
  const data = await fetchCaaDialogList(workspaceRoot, { includeDemo: false });
  const groups = filterDialogGroups(data.groups, q);
  const count = countDialogGroups(groups);
  return {
    workspaceRoot: data.workspaceRoot,
    count,
    groups,
    indexed: true,
    indexFallback: true,
    last_scan_at: null,
    summary: `CAA index API is unavailable; loaded ${count} .CATDlg from live scan`,
  };
}

export async function fetchCaaIndexGroups(
  q?: string,
  opts?: { fallbackWorkspaceRoot?: string },
): Promise<CaaIndexListResult> {
  const params = new URLSearchParams();
  if (q?.trim()) params.set("q", q.trim());
  const res = await fetch(`/api/caa/index/groups${params.toString() ? `?${params.toString()}` : ""}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallbackRoot = opts?.fallbackWorkspaceRoot?.trim();
    if (res.status === 404 && fallbackRoot) {
      return fallbackCaaIndexGroups(fallbackRoot, q);
    }
    throw new Error(data?.detail ?? data?.error ?? `caa index groups failed ${res.status}`);
  }
  return {
    workspaceRoot: "",
    count: Number(data.count ?? 0),
    groups: data.groups ?? [],
    indexed: Boolean(data.indexed),
    last_scan_at: data.last_scan_at ?? null,
    stats: data.stats,
  };
}

export async function scanCaaIndex(opts?: { fallbackWorkspaceRoot?: string }): Promise<CaaIndexListResult> {
  const res = await fetch("/api/caa/index/scan", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallbackRoot = opts?.fallbackWorkspaceRoot?.trim();
    if (res.status === 404 && fallbackRoot) {
      return fallbackCaaIndexGroups(fallbackRoot);
    }
    throw new Error(data?.detail ?? data?.error ?? `caa index scan failed ${res.status}`);
  }
  return {
    workspaceRoot: "",
    count: Number(data.count ?? 0),
    groups: data.groups ?? [],
    indexed: Boolean(data.indexed),
    last_scan_at: data.last_scan_at ?? null,
    summary: data.summary,
    stats: data.stats,
  };
}

export async function parseCaaDialogDemo(): Promise<CaaDialogIr> {
  const res = await fetch("/api/caa/dialog/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ demo: true }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? `parse failed ${res.status}`);
  }
  return data as CaaDialogIr;
}

export async function parseCaaDialog(opts: {
  workspaceRoot: string;
  catDlgRel: string;
  catNlsRel?: string;
  demo?: boolean;
}): Promise<CaaDialogIr> {
  const body = opts.demo
    ? { demo: true }
    : {
        workspaceRoot: opts.workspaceRoot,
        catDlgRel: opts.catDlgRel,
        catNlsRel: opts.catNlsRel,
      };
  const res = await fetch("/api/caa/dialog/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? `parse failed ${res.status}`);
  }
  return data as CaaDialogIr;
}

export async function saveCaaDialogNls(opts: {
  workspaceRoot: string;
  catNlsRel: string;
  entries: { key: string; value: string }[];
  sourceText?: string;
}): Promise<{ ok: boolean; sourceText: string; absPath: string }> {
  const res = await fetch("/api/caa/dialog/save-nls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? `save-nls failed ${res.status}`);
  }
  return data as { ok: boolean; sourceText: string; absPath: string };
}

export async function saveCaaDialog(opts: {
  workspaceRoot: string;
  catDlgRel: string;
  root: Record<string, unknown>;
}): Promise<{ ok: boolean; absPath: string }> {
  const res = await fetch("/api/caa/dialog/save-dialog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `save-dialog failed ${res.status}`);
  return data as { ok: boolean; absPath: string };
}

export async function writeCaaDialogFromIr(opts: {
  workspaceRoot: string;
  catDlgRel: string;
  ir: Record<string, unknown>;
  dryRun?: boolean;
}): Promise<CaaDialogWriteResult> {
  const res = await fetch("/api/caa/dialog/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `write dialog failed ${res.status}`);
  return data as CaaDialogWriteResult;
}

export type CaaDialogWriteValidation = {
  errors?: string[];
  warnings?: string[];
};

export type CaaDialogWritePreview = {
  catDlg?: { before: string; after: string };
  catNls?: { before: string; after: string };
  header?: { before: string; after: string };
  cpp?: { before: string; after: string };
};

export type CaaDialogWriteResult = {
  ok: boolean;
  dryRun?: boolean;
  catDlgRel?: string;
  catNlsRel?: string;
  headerRel?: string;
  cppRel?: string;
  absPath: string;
  bytes: number;
  changed: { catDlg: boolean; catNls: boolean; header?: boolean; cpp?: boolean };
  validation?: CaaDialogWriteValidation;
  preview?: CaaDialogWritePreview;
};

export async function fetchCaaDialogFilePreview(opts: {
  workspaceRoot: string;
  repoRelPath: string;
}): Promise<CaaFilePreviewPayload> {
  const res = await fetch("/api/caa/dialog/file-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? `file-preview failed ${res.status}`);
  }
  return data as CaaFilePreviewPayload;
}

// ── 模块目录 ──

export async function fetchCaaModuleDirs(workspaceRoot: string): Promise<{ dirs: string[] }> {
  const res = await fetch(`/api/caa/dialog/dirs?workspaceRoot=${encodeURIComponent(workspaceRoot)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `dirs failed ${res.status}`);
  return data as { dirs: string[] };
}

// ── 草稿 CRUD ──

export async function fetchCaaDrafts(workspaceRoot: string): Promise<{ drafts: Record<string, unknown>[] }> {
  const res = await fetch(`/api/caa/dialog/drafts?workspaceRoot=${encodeURIComponent(workspaceRoot)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `drafts failed ${res.status}`);
  return data as { drafts: Record<string, unknown>[] };
}

export async function saveCaaDraft(workspaceRoot: string, draft: Record<string, unknown>): Promise<{ ok: boolean; id: string }> {
  const res = await fetch("/api/caa/dialog/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot, draft }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `save-draft failed ${res.status}`);
  return data as { ok: boolean; id: string };
}

export async function deleteCaaDraft(workspaceRoot: string, id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/caa/dialog/drafts/${encodeURIComponent(id)}?workspaceRoot=${encodeURIComponent(workspaceRoot)}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `delete-draft failed ${res.status}`);
  return data as { ok: boolean };
}

export async function createCaaDialogFromIr(opts: {
  workspaceRoot: string;
  targetDirRel: string;
  dialogName: string;
  ir: Record<string, unknown>;
}): Promise<{ ok: boolean; catDlgRel: string; catNlsRel: string }> {
  const res = await fetch("/api/caa/dialog/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `create dialog failed ${res.status}`);
  return data as { ok: boolean; catDlgRel: string; catNlsRel: string };
}

// ── locale ──

export async function createCaaDialogLocaleNls(opts: {
  workspaceRoot: string;
  defaultCatNlsRel: string;
  localeDir?: string;
  nlsKeys?: Record<string, string>;
}): Promise<{
  ok: boolean;
  localeDir: string;
  catNlsRel: string;
  absPath: string;
  sourceText: string;
  nlsKeys: Record<string, string>;
}> {
  const res = await fetch("/api/caa/dialog/create-locale-nls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? `create-locale-nls failed ${res.status}`);
  }
  return data;
}
