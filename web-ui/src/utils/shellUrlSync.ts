import type { WorkbenchTab } from "../types/workbench";

/** 从地址栏解析壳层深链（刷新 / 分享链接用） */
export type ShellUrlIntent =
  | { kind: "welcome" }
  | { kind: "config" }
  | { kind: "page"; pageId: string; rel?: string; renameLogId?: number; analyze?: boolean };

export function parseShellUrl(search = window.location.search): ShellUrlIntent | null {
  const params = new URLSearchParams(search);
  if (params.get("view") === "welcome") {
    return { kind: "welcome" };
  }
  const page = params.get("page")?.trim();
  if (!page) return null;
  if (page === "welcome") return { kind: "welcome" };
  if (page === "config") return { kind: "config" };

  const rel = params.get("rel")?.trim() || undefined;
  if (page === "bom_apply" && rel) {
    return { kind: "page", pageId: "bom_apply", rel };
  }
  if (page === "file_rename" && rel) {
    return { kind: "page", pageId: "file_rename", rel };
  }
  if (page === "rename_analysis" || (page === "file_rename" && params.get("rename_log_id"))) {
    const logRaw = params.get("rename_log_id")?.trim();
    const logId = logRaw ? Number(logRaw) : NaN;
    return {
      kind: "page",
      pageId: "rename_analysis",
      renameLogId: Number.isFinite(logId) ? logId : undefined,
      analyze: params.get("analyze") === "1",
    };
  }
  if (page === "part_key_detail") {
    const part = params.get("part")?.trim();
    if (part) return { kind: "page", pageId: "part_key_detail", rel: part };
  }
  return { kind: "page", pageId: page, rel };
}

/** 根据当前壳层状态生成 query（不含 pathname） */
export function buildShellSearchParams(opts: {
  showWelcome: boolean;
  activeTab: WorkbenchTab | undefined;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (opts.showWelcome) {
    params.set("view", "welcome");
    return params;
  }
  const tab = opts.activeTab;
  if (!tab) return params;

  const pageId = tab.pageId;
  params.set("page", pageId);

  const rel = (tab.contextKey || tab.subtitle || "").trim();
  if ((pageId === "file_detail" || pageId === "bom_apply") && rel) {
    params.set("rel", rel);
  }
  if (pageId === "part_key_detail" && rel) {
    params.set("part", rel);
  }
  return params;
}

export function replaceShellUrl(opts: {
  showWelcome: boolean;
  activeTab: WorkbenchTab | undefined;
}): void {
  if (typeof window === "undefined") return;
  const params = buildShellSearchParams(opts);
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  window.history.replaceState(null, "", next);
}
