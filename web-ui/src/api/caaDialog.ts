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
  nlsKeys: Record<string, string>;
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

export interface CaaDialogGridPatch {
  nodeId: string;
  rowResizable?: number[];
  colResizable?: number[];
}

export async function saveCaaDialog(opts: {
  workspaceRoot: string;
  catDlgRel: string;
  patches: CaaDialogGridPatch[];
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
