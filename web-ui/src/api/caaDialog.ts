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
