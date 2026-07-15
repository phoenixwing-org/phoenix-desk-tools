import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type CaaDialogOpenRequest = {
  id: number;
  workspaceRoot: string;
  catDlgRel: string;
  receivedAt: string;
};

type DirectOpenPayload = {
  workspaceRoot?: unknown;
  workspace?: unknown;
  file?: unknown;
  catDlg?: unknown;
  catDlgRel?: unknown;
};

type HandoffPayload = {
  protocol?: unknown;
  workspaceUri?: unknown;
  selectedFiles?: unknown;
};

const pending: CaaDialogOpenRequest[] = [];
let nextId = 1;

function localPathFromFileUri(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${field} 必填`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${field} 必须是 file: URI`);
  }
  if (url.protocol !== "file:") throw new Error(`${field} 仅支持 file: URI`);
  return path.resolve(fileURLToPath(url));
}

async function requireDirectory(raw: unknown): Promise<string> {
  const root = path.resolve(String(raw || "").trim());
  if (!String(raw || "").trim()) throw new Error("workspaceRoot 必填");
  try {
    if ((await fs.stat(root)).isDirectory()) return root;
  } catch {
    // Stable validation error below.
  }
  throw new Error(`工作空间目录不存在：${root}`);
}

async function normalizeOne(workspaceRoot: string, fileOrRel: unknown): Promise<Omit<CaaDialogOpenRequest, "id" | "receivedAt">> {
  const input = String(fileOrRel || "").trim();
  if (!input) throw new Error("file 或 catDlgRel 必填");
  const absolute = path.isAbsolute(input) ? path.resolve(input) : path.resolve(workspaceRoot, input);
  const relative = path.relative(workspaceRoot, absolute);
  if (!relative || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error(".CATDlg 必须位于工作空间内");
  }
  if (!/\.catdlg$/i.test(absolute)) throw new Error("仅支持 .CATDlg 文件");
  try {
    if (!(await fs.stat(absolute)).isFile()) throw new Error();
  } catch {
    throw new Error(`.CATDlg 文件不存在：${absolute}`);
  }
  return { workspaceRoot, catDlgRel: relative.replace(/\\/g, "/") };
}

/** Validate an HTTP/CLI handoff and append it to the single local UI consumer queue. */
export async function enqueueCaaDialogOpenPayload(
  raw: unknown,
  fallbackWorkspace = "",
): Promise<CaaDialogOpenRequest[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("请求体必须是对象");
  const payload = raw as DirectOpenPayload & HandoffPayload;
  const normalized: Array<Omit<CaaDialogOpenRequest, "id" | "receivedAt">> = [];

  if (payload.protocol === "phoenix-desk-tools.caa-dialog.v1") {
    const workspaceRoot = await requireDirectory(localPathFromFileUri(payload.workspaceUri, "workspaceUri"));
    if (!Array.isArray(payload.selectedFiles) || payload.selectedFiles.length === 0) {
      throw new Error("selectedFiles 至少需要一个文件");
    }
    for (const entry of payload.selectedFiles) {
      if (!entry || typeof entry !== "object") throw new Error("selectedFiles 项必须是对象");
      const file = localPathFromFileUri((entry as { uri?: unknown }).uri, "selectedFiles.uri");
      normalized.push(await normalizeOne(workspaceRoot, file));
    }
  } else {
    const workspaceRoot = await requireDirectory(
      payload.workspaceRoot || payload.workspace || fallbackWorkspace,
    );
    normalized.push(await normalizeOne(
      workspaceRoot,
      payload.file || payload.catDlg || payload.catDlgRel,
    ));
  }

  const now = new Date().toISOString();
  const requests = normalized.map((item) => ({ ...item, id: nextId++, receivedAt: now }));
  pending.push(...requests);
  if (pending.length > 100) pending.splice(0, pending.length - 100);
  return requests;
}

/** List pending requests without consuming them; the UI acknowledges only after opening succeeds. */
export function listCaaDialogOpenRequests(): CaaDialogOpenRequest[] {
  return [...pending];
}

export function acknowledgeCaaDialogOpenRequests(ids: readonly number[]): number[] {
  const wanted = new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0));
  if (!wanted.size) return [];
  const acknowledged: number[] = [];
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const request = pending[index];
    if (request && wanted.has(request.id)) {
      acknowledged.push(request.id);
      pending.splice(index, 1);
    }
  }
  return acknowledged.reverse();
}

export function clearCaaDialogOpenRequestsForTests(): void {
  pending.splice(0);
  nextId = 1;
}
