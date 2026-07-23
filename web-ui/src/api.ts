import type { AppConfig, LauncherPrefs, ShellLayout, WorkspaceNavModules } from "./types/config";
import type { ModuleScope } from "./constants/moduleScope";
import type { GitChangesPayload, GitCommitResult, GitFileDiff, GitWorkspaceInfo } from "./types/gitWorkspace";
import type {
  KtCodegenParam,
  KtCodegenPlan,
  KtCodegenDiagnostic,
  KtCodegenTableData,
} from "@phoenix-wing/kt-codegen";
import { apiUrl, invokeTauri, isTauriRuntime } from "./utils/runtimeBridge";

export type TreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  kind?: string;
  children?: TreeNode[];
};

export type TreeResponse = {
  workspace: string;
  workspace_name: string;
  file_count: number;
  tree: TreeNode;
};

export type BomFields = {
  repo_rel_path: string;
  filename: string;
  PartNumber: string;
  PartVersion: string;
  TypeCode: string;
  ModelSeries: string;
  PartName: string;
  label: string;
};

export type BomKindFilters = {
  part: boolean;
  assembly: boolean;
  drawing: boolean;
};

export type BomApplyPrefs = {
  stored: {
    last_part_number: string;
    last_part_version: string;
    last_type_code: string;
    last_model_series: string;
  };
  recommended_fill: {
    PartNumber: string;
    PartVersion: string;
    TypeCode: string;
    ModelSeries: string;
  };
};

export type BomXrefCounts = {
  outgoing_count: number;
  direct_incoming_count: number;
};

export type BomPreview = {
  rel_path: string;
  fields: BomFields;
  source_note: string;
  abs_path_display: string;
  is_fcstd: boolean;
  document_kinds: {
    part: boolean;
    assembly: boolean;
    drawing: boolean;
    display: string;
    recommended_suffix: string;
  } | null;
  embedded_warning: string | null;
  file_size_bytes: number | null;
  file_size_display: string | null;
  bom_readonly?: boolean;
  bom_source_rel?: string | null;
  /** 打开文件时附带：出向 + 直接入向计数（单条 SQL） */
  xref_counts?: BomXrefCounts;
  /** 引用表尚未构建（不会在打开文件时自动全量重建） */
  xref_index_pending?: boolean;
};

function formatApiErrorDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "object" && item !== null && "msg" in item) {
          const loc =
            "loc" in item && Array.isArray((item as { loc: unknown }).loc)
              ? (item as { loc: unknown[] }).loc.join(".")
              : "";
          return loc ? `${loc}: ${String((item as { msg: unknown }).msg)}` : String((item as { msg: unknown }).msg);
        }
        return String(item);
      })
      .join("; ");
  }
  if (typeof detail === "object" && detail !== null) {
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }
  return String(detail);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && init.body !== "" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(apiUrl(url), { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  if (!res.ok) {
    const rawDetail =
      typeof data === "object" && data !== null && "detail" in data
        ? (data as { detail: unknown }).detail
        : res.statusText;
    const detail = formatApiErrorDetail(rawDetail);
    throw new ApiError(detail || `HTTP ${res.status}`, res.status, data);
  }
  return data as T;
}

export type OnboardingStatus = {
  workspace_ok: boolean;
  workspace_path: string;
  freecad_ok: boolean;
  index_scanned: boolean;
  last_scan_at: string;
};

export function fetchOnboardingStatus() {
  return jsonFetch<OnboardingStatus>("/api/onboarding/status");
}

export type PhoenixDatabaseStatus = {
  legacy_detected: boolean;
  needs_recreate: boolean;
  reasons: string[];
  old_tables_found: string[];
  legacy_file_exists: boolean;
  database_exists: boolean;
  database_path: string;
  legacy_database_path: string;
  database_filename: string;
  legacy_database_filename: string;
  legacy_database_filenames?: string[];
  expected_schema_version: number;
  schema_version: number | null;
  database_path_display: string;
};

export type PhoenixDatabaseRecreateResult = {
  status: string;
  removed_files: string[];
  database_path: string;
  schema_version: number;
  recreated_at: string;
};

export function fetchPhoenixDatabaseStatus() {
  return jsonFetch<PhoenixDatabaseStatus>("/api/phoenix/database/status");
}

export function recreatePhoenixDatabase() {
  return jsonFetch<PhoenixDatabaseRecreateResult>("/api/phoenix/database/recreate", {
    method: "POST",
  });
}

export function fetchAppConfig() {
  return jsonFetch<AppConfig>("/api/config/app");
}

export function fetchLauncherPrefs() {
  return jsonFetch<LauncherPrefs>("/api/config/launcher");
}

export function saveLauncherFreecad(path: string) {
  return jsonFetch<{ freecad_dir: string }>("/api/config/launcher/freecad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export function removeRecentWorkspace(path: string) {
  return jsonFetch<LauncherPrefs>("/api/config/launcher/recent/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export function addRecentWorkspace(path: string) {
  return jsonFetch<LauncherPrefs>("/api/config/launcher/recent/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export function pickWorkspaceDirectory(pathHint = "") {
  if (isTauriRuntime()) {
    return invokeTauri<{ cancelled: boolean; path: string }>("pick_workspace_directory", { pathHint });
  }
  return jsonFetch<{ cancelled: boolean; path: string }>(
    "/api/config/pick-workspace-directory",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path_hint: pathHint }),
    },
  );
}

export function pruneRecentWorkspaces() {
  return jsonFetch<LauncherPrefs & { pruned_count?: number }>(
    "/api/config/launcher/recent/prune",
    { method: "POST" },
  );
}

export type TestFixtureItem = {
  name: string;
  description: string;
  clone_url: string;
  enabled: boolean;
  checkout_path: string;
  checkout_exists: boolean;
  link_status?: string;
  link_detail?: string;
  symlink_path?: string;
  target_path: string;
};

export type TestFixturesPayload = {
  checkout_root: string;
  default_checkout_root: string;
  enabled: string[];
  repo_root: string;
  /** 仓库内置清单 JSON（随代码提交） */
  catalog_path?: string;
  catalog_kind?: string;
  user_prefs_path_hint?: string;
  items: TestFixtureItem[];
  sync_results?: Array<{ name: string; status: string; detail: string }>;
};

export function fetchTestFixtures() {
  return jsonFetch<TestFixturesPayload>("/api/test-fixtures");
}

export function updateTestFixturesPrefs(body: { checkout_root?: string; enabled: string[] }) {
  return jsonFetch<TestFixturesPayload>("/api/test-fixtures", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function syncTestFixtures(body?: { checkout_root?: string; enabled?: string[]; names?: string[] }) {
  return jsonFetch<TestFixturesPayload>("/api/test-fixtures/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export function resetLauncherFactory() {
  return jsonFetch<LauncherPrefs>("/api/config/launcher/reset-factory", {
    method: "POST",
  });
}

export function patchShellLayout(patch: Partial<ShellLayout>) {
  return jsonFetch<ShellLayout>("/api/config/launcher/shell-layout", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function patchNavModules(enabled: string[]) {
  return jsonFetch<{ enabled: string[] }>("/api/config/launcher/nav-modules", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export type ShellLogLine = { text: string; source: string };

export function fetchShellLog(after = 0) {
  return jsonFetch<{ lines: ShellLogLine[]; total: number }>(
    `/api/shell/log?after=${after}`,
  );
}

export function appendShellLog(text: string, source = "web") {
  return jsonFetch<{ total: number }>("/api/shell/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, source }),
  });
}

export function shutdownWebServer() {
  if (isTauriRuntime()) {
    return invokeTauri<{ status: string }>("shutdown_desktop");
  }
  return jsonFetch<{ status: string }>("/api/shutdown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function getWorkspace() {
  return jsonFetch<{ path: string; name: string }>("/api/workspace");
}

export function setWorkspace(path: string) {
  return jsonFetch<{ path: string; name: string; nav_modules?: WorkspaceNavModules }>(
    "/api/workspace",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    },
  );
}

export function closeWorkspaceApi() {
  return jsonFetch<{ status: string }>("/api/workspace", { method: "DELETE" });
}

export function fetchWorkspaceNavModules(path?: string) {
  const q = path?.trim() ? `?path=${encodeURIComponent(path.trim())}` : "";
  return jsonFetch<WorkspaceNavModules>(`/api/workspace/nav-modules${q}`);
}

export function patchWorkspaceNavModules(body: {
  path?: string;
  scope?: ModuleScope;
  enabled?: string[];
}) {
  return jsonFetch<WorkspaceNavModules>("/api/workspace/nav-modules", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type WorkbenchSessionResponse = {
  version: number;
  session: {
    version?: number;
    active_tab_id?: string;
    activeTabId?: string;
    tabs?: Array<Record<string, unknown>>;
  } | null;
  updated_at: string | null;
  database_path?: string;
  database_path_display?: string;
};

export function fetchWorkbenchSession() {
  return jsonFetch<WorkbenchSessionResponse>("/api/workbench/session");
}

export function saveWorkbenchSession(body: {
  version: number;
  active_tab_id: string;
  tabs: Array<Record<string, unknown>>;
}) {
  return jsonFetch<WorkbenchSessionResponse>("/api/workbench/session", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function fetchTree(opts: {
  fcstd?: boolean;
  sw?: boolean;
  cpp?: boolean;
  header?: boolean;
} = {}) {
  const q = new URLSearchParams({
    fcstd: (opts.fcstd ?? true) ? "true" : "false",
    sw: (opts.sw ?? false) ? "true" : "false",
    cpp: (opts.cpp ?? false) ? "true" : "false",
    header: (opts.header ?? false) ? "true" : "false",
  });
  return jsonFetch<TreeResponse>(`/api/tree?${q}`);
}

function bomBody(fields: Partial<BomFields>, extra: Record<string, unknown> = {}) {
  return {
    PartNumber: fields.PartNumber ?? "",
    PartVersion: fields.PartVersion ?? "",
    TypeCode: fields.TypeCode ?? "",
    ModelSeries: fields.ModelSeries ?? "",
    PartName: fields.PartName ?? "",
    label: fields.label ?? "",
    filename: fields.filename ?? "",
    ...extra,
  };
}

export function fetchBomPrefs() {
  return jsonFetch<BomApplyPrefs>("/api/cad/bom/prefs");
}

export function fetchBom(rel: string) {
  return jsonFetch<BomPreview>(`/api/cad/bom/file?rel=${encodeURIComponent(rel)}`);
}

export function saveBom(rel: string, fields: Partial<BomFields>) {
  return jsonFetch<{ status: string }>(`/api/cad/bom/file?rel=${encodeURIComponent(rel)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bomBody(fields)),
  });
}

export type BomFieldRecommendResult = {
  field: string;
  value: string;
  source_note: string;
  filled: boolean;
};

export function recommendBomField(
  rel: string,
  field: string,
  fields: Partial<BomFields>,
  kindFilters: BomKindFilters,
) {
  return jsonFetch<BomFieldRecommendResult>(
    `/api/cad/bom/recommend-field?rel=${encodeURIComponent(rel)}&field=${encodeURIComponent(field)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...bomBody(fields), kind_filters: kindFilters }),
    },
  );
}

export function recommendBomFieldsAll(
  rel: string,
  fields: Partial<BomFields>,
  kindFilters: BomKindFilters,
) {
  return jsonFetch<{
    results: Record<string, BomFieldRecommendResult>;
    filled_keys: string[];
  }>(`/api/cad/bom/recommend-all-fields?rel=${encodeURIComponent(rel)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...bomBody(fields), kind_filters: kindFilters }),
  });
}

export function fillRecommendedValues(rel: string, fields: Partial<BomFields>) {
  return jsonFetch<{ fields: BomFields; filled_keys: string[] }>(
    `/api/cad/bom/fill-recommended-values?rel=${encodeURIComponent(rel)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bomBody(fields)),
    },
  );
}

export function fillBomFromEmbedded(
  rel: string,
  fields: Partial<BomFields>,
  kindFilters: BomKindFilters,
) {
  return jsonFetch<{ fields: BomFields; document_kinds?: BomPreview["document_kinds"] }>(
    `/api/cad/bom/fill-from-embedded?rel=${encodeURIComponent(rel)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...bomBody(fields), kind_filters: kindFilters }),
    },
  );
}

export function fillBomFromFilename(rel: string) {
  return jsonFetch<{ fields: BomFields }>(
    `/api/cad/bom/fill-from-filename?rel=${encodeURIComponent(rel)}`,
    { method: "POST" },
  );
}

export function applyLabelFormula(
  rel: string,
  fields: Partial<BomFields>,
  fillEmptyFromPrefs = true,
) {
  return jsonFetch<{ fields: BomFields; label: string; filled_keys: string[] }>(
    `/api/cad/bom/apply-label-formula?rel=${encodeURIComponent(rel)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...bomBody(fields), fill_empty_from_prefs: fillEmptyFromPrefs }),
    },
  );
}

export function fetchBomDocumentKinds(rel: string) {
  return jsonFetch<{ document_kinds: NonNullable<BomPreview["document_kinds"]> }>(
    `/api/cad/bom/document-kinds?rel=${encodeURIComponent(rel)}`,
  );
}

export function recommendFilename(
  rel: string,
  fields: Partial<BomFields>,
  opts: {
    kindFilters: BomKindFilters;
    originalFilename?: string;
    baseline?: Partial<BomFields>;
  },
) {
  return jsonFetch<{
    recommended_filename: string;
    fields: BomFields;
    suffix: string;
    filled_keys: string[];
    hint_text: string;
    matches_disk_name: boolean;
    document_kinds?: BomPreview["document_kinds"];
  }>(`/api/cad/bom/recommend-filename?rel=${encodeURIComponent(rel)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...bomBody(fields),
      kind_filters: opts.kindFilters,
      original_filename: opts.originalFilename ?? fields.filename ?? "",
      fill_empty_from_prefs: true,
    }),
  });
}

export function renameBomFile(
  rel: string,
  fields: Partial<BomFields>,
  baseline: Partial<BomFields>,
  opts?: { writeAttrsFirst?: boolean },
) {
  return jsonFetch<{
    rel_path: string;
    filename: string;
    map_updated: boolean;
    attrs_saved?: boolean;
  }>(`/api/cad/bom/rename?rel=${encodeURIComponent(rel)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...bomBody(fields),
      baseline: bomBody(baseline),
      write_attrs_first: Boolean(opts?.writeAttrsFirst),
    }),
  });
}

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

export type RefHitHost = {
  host_repo_rel_path: string;
  host_filename: string;
  hit_count: number;
  depth?: number;
  usage_kind?: "direct" | "indirect" | string;
  via_chain?: string[];
  hits: Array<{
    id?: number;
    matched_text: string;
    proposed_text: string;
    status: string;
  }>;
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
  hosts: RefHitHost[];
};

export type RenameLogsPayload = {
  database_path: string;
  database_path_display: string;
  entries: RenameLog[];
};

export function fetchFileRenameContext(rel: string) {
  return jsonFetch<{ rel_path: string; preview: BomPreview }>(
    `/api/file-rename/context?rel=${encodeURIComponent(rel)}`,
  );
}

export function executeFileRename(
  rel: string,
  fields: Partial<BomFields>,
  baseline: Partial<BomFields>,
  opts?: { writeAttrsFirst?: boolean },
) {
  return jsonFetch<{
    rel_path: string;
    filename: string;
    map_updated: boolean;
    attrs_saved?: boolean;
    rename_log_id?: number;
    rename_log?: RenameLog;
  }>(`/api/file-rename/rename?rel=${encodeURIComponent(rel)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...bomBody(fields),
      baseline: bomBody(baseline),
      write_attrs_first: Boolean(opts?.writeAttrsFirst),
    }),
  });
}

export function scanFileRenameRefs(body: {
  rename_log_id?: number;
  old_basename?: string;
  new_basename?: string;
  persist?: boolean;
}) {
  return jsonFetch<RefScanPayload>("/api/file-rename/scan-refs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function applyFileRenameRefs(
  hostRepoRelPaths: string[],
  opts: {
    renameLogId?: number;
    oldBasename?: string;
    newBasename?: string;
    targetRepoRel?: string;
    transitive?: boolean;
    labelsOnly?: boolean;
    labelScope?: "incoming" | "host_all";
  },
) {
  return applyRenameAnalysisCorrections(hostRepoRelPaths, opts);
}

export function fetchRenameLogs(limit = 50, rel?: string) {
  const q = new URLSearchParams({ limit: String(limit) });
  const path = (rel ?? "").trim();
  if (path) q.set("rel", path);
  return jsonFetch<RenameLogsPayload>(`/api/cad/rename/logs?${q.toString()}`);
}

export function analyzeRenameReferences(body: {
  rename_log_id?: number;
  old_basename?: string;
  new_basename?: string;
  old_repo_rel_path?: string;
  target_repo_rel?: string;
  new_repo_rel_path?: string;
  transitive?: boolean;
  persist?: boolean;
}) {
  return jsonFetch<RefScanPayload>("/api/cad/rename/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type ReferenceLabelChange = {
  host_repo_rel?: string;
  xlink_file_attr: string;
  old_label: string;
  new_label: string;
};

export function applyRenameAnalysisCorrections(
  hostRepoRelPaths: string[],
  opts: {
    renameLogId?: number;
    oldBasename?: string;
    newBasename?: string;
    excludeRepoRel?: string;
    targetRepoRel?: string;
    transitive?: boolean;
    labelsOnly?: boolean;
    labelScope?: "incoming" | "host_all";
  },
) {
  return jsonFetch<{
    rename_log_id: number | null;
    old_basename?: string;
    new_basename?: string;
    applied_hosts: string[];
    failed: Array<{ host_repo_rel_path: string; error: string }>;
    xlink_patches: number;
    label_patches?: number;
    label_changes?: ReferenceLabelChange[];
    scan: RefScanPayload;
  }>("/api/cad/rename/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rename_log_id: opts.renameLogId,
      old_basename: opts.oldBasename,
      new_basename: opts.newBasename,
      exclude_repo_rel: opts.excludeRepoRel,
      target_repo_rel: opts.targetRepoRel,
      transitive: opts.transitive,
      labels_only: opts.labelsOnly ?? false,
      label_scope: opts.labelScope ?? "incoming",
      host_repo_rel_paths: hostRepoRelPaths,
    }),
  });
}

export function applyReferenceLabelCorrections(
  hostRepoRelPaths: string[],
  opts: Omit<Parameters<typeof applyRenameAnalysisCorrections>[1], "labelsOnly" | "labelScope"> & {
    labelScope?: "incoming" | "host_all";
  },
) {
  return applyRenameAnalysisCorrections(hostRepoRelPaths, {
    ...opts,
    labelsOnly: true,
    labelScope: opts.labelScope ?? "incoming",
  });
}

export function loadRenameAnalysis(renameLogId: number) {
  return jsonFetch<{ rename_log: RenameLog; scan: RefScanPayload }>(
    `/api/cad/rename/load?rename_log_id=${renameLogId}`,
  );
}

export function exportRenameAnalysisReport(body: {
  scan: RefScanPayload;
  rename_log_id?: number;
  note?: string;
}) {
  return jsonFetch<{ report_path: string; report_path_display: string }>(
    "/api/cad/rename/export-report",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scan: body.scan,
        rename_log_id: body.rename_log_id,
        note: body.note,
      }),
    },
  );
}

export type FcstdMapEntry = {
  repo_rel_path: string;
  filename: string;
  asset_kind: string;
  PartNumber: string;
  PartVersion: string;
  TypeCode: string;
  ModelSeries: string;
  PartName: string;
  label: string;
  file_status: "present" | "missing";
  last_seen_at: string;
};

export type FcstdMapStats = {
  total_entries: number;
  present: number;
  missing: number;
  unique_filenames: number;
  duplicate_filename_kinds: number;
  cad_file_count: number;
  fcstd_file_count: number;
  markdown_file_count: number;
  pdf_file_count: number;
  cad_exchange_file_count: number;
  image_file_count: number;
};

export type FcstdMapPayload = {
  database_path: string;
  database_path_display: string;
  map_path: string;
  map_path_display: string;
  exists: boolean;
  prefs: { force_update_part_name: boolean };
  last_scan_at: string;
  /** 历史字段，固定为 ``.``（工作空间根） */
  scan_root: string;
  stats: FcstdMapStats;
  entries: FcstdMapEntry[];
  scan_log?: string;
  bom_xref?: BomXrefMeta & { scan_id?: number };
};

export function fetchFcstdMap() {
  return jsonFetch<FcstdMapPayload>("/api/cad/fcstd-map");
}

export type FcstdMapEntriesPayload = {
  offset: number;
  limit: number;
  total: number;
  count: number;
  entries: FcstdMapEntry[];
  debug_sql: string;
};

export function fetchFcstdMapEntries(opts?: {
  offset?: number;
  limit?: number;
  status?: "all" | "present" | "missing";
  kind?: string;
  search?: string;
}) {
  const q = new URLSearchParams();
  if (opts?.offset != null) q.set("offset", String(opts.offset));
  if (opts?.limit != null) q.set("limit", String(opts.limit));
  if (opts?.status && opts.status !== "all") q.set("status", opts.status);
  if (opts?.kind && opts.kind !== "all") q.set("kind", opts.kind);
  if (opts?.search?.trim()) q.set("search", opts.search.trim());
  const qs = q.toString();
  return jsonFetch<FcstdMapEntriesPayload>(`/api/cad/fcstd-map/entries${qs ? `?${qs}` : ""}`);
}

export function saveFcstdMapPrefs(force_update_part_name?: boolean) {
  return jsonFetch<{ force_update_part_name: boolean }>("/api/cad/fcstd-map/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force_update_part_name }),
  });
}

export function scanFcstdMap(force_update_part_name?: boolean) {
  return jsonFetch<FcstdMapPayload>("/api/cad/fcstd-map/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force_update_part_name }),
  });
}

export function purgeMissingFcstdMap() {
  return jsonFetch<FcstdMapPayload & { purge_deleted?: number }>("/api/cad/fcstd-map/purge-missing", {
    method: "POST",
  });
}

export function startFcstdMapScan(forceUpdatePartName = false, scopeWorksetId?: string) {
  return jsonFetch<{ scan_id: string; phase: string }>(
    "/api/cad/fcstd-map/scan/start",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        force_update_part_name: forceUpdatePartName,
        scope_workset_id: scopeWorksetId || null,
      }),
    },
  );
}

export type ScanProgressPayload = {
  scan_id: string;
  phase: string;
  step: number;
  status: string;
  cancelled: boolean;
  error: string;
  total_cad_files: number;
  total_fcstd_files: number;
  walk: { total: number; processed: number; percent: number };
  bom: {
    total: number;
    processed: number;
    skipped: number;
    failed: number;
    current_file: string;
    percent: number;
    errors: Array<{ rel: string; error: string }>;
  };
  xref: {
    total: number;
    processed: number;
    skipped: number;
    failed: number;
    current_file: string;
    percent: number;
    errors: Array<{ rel: string; error: string }>;
  };
};

export function fetchFcstdMapScanProgress(scanId: string) {
  return jsonFetch<ScanProgressPayload>(
    `/api/cad/fcstd-map/scan/progress?scan_id=${encodeURIComponent(scanId)}`,
  );
}

export function cancelFcstdMapScan(scanId: string) {
  return jsonFetch<{ cancelled: boolean }>(
    `/api/cad/fcstd-map/scan/cancel?scan_id=${encodeURIComponent(scanId)}`,
    { method: "POST" },
  );
}

export type ScanHistoryEntry = {
  scan_uuid: string;
  status: string;
  phase: string;
  scanned_at: string;
  started_at?: string;
  finished_at?: string;
  stats: Record<string, unknown>;
};

export function fetchFcstdMapScanHistory(limit = 20) {
  return jsonFetch<{ scans: ScanHistoryEntry[] }>(
    `/api/cad/fcstd-map/scan/history?limit=${limit}`,
  );
}

export type ScanResumePayload = {
  active: boolean;
  scan_id?: string;
  source?: "memory" | "db";
  progress?: ScanProgressPayload | null;
};

export function fetchFcstdMapScanResume() {
  return jsonFetch<ScanResumePayload>("/api/cad/fcstd-map/scan/resume");
}

export function exportFcstdMapJson() {
  return jsonFetch<{ path: string; path_display: string }>("/api/cad/fcstd-map/export-json", {
    method: "POST",
  });
}

export type BomXrefMeta = {
  edge_count: number;
  host_count: number;
  last_bom_xref_at?: string;
  target_resolved?: number;
  target_ambiguous?: number;
  target_missing?: number;
  database_path?: string;
  database_path_display?: string;
};

export type BomXrefEdge = {
  id: number;
  host_repo_rel_path: string;
  host_file_asset_id: number;
  xlink_file_attr: string;
  target_basename: string;
  target_repo_rel_path: string | null;
  target_file_asset_id: number | null;
  resolve_status: string;
  ref_kind: string;
  detail?: unknown;
  /** 装配树中该引用的 Label（Link.Label / 链接标签） */
  link_label?: string;
  /** 目标文件的规则显示名（同步后的期望名；多件同目标时可能带 .001 序号） */
  rule_label?: string;
  label_mismatch?: boolean;
};

export function fetchBomXrefMeta() {
  return jsonFetch<BomXrefMeta>("/api/cad/bom/xref/meta");
}

export type BomXrefHost = {
  host_repo_rel_path: string;
  depth: number;
  usage_kind: "direct" | "indirect";
  via_chain: string[];
  direct_refs?: BomXrefEdge[];
};

export function fetchBomXrefIncoming(opts: {
  rel?: string;
  basename?: string;
  limit?: number;
  transitive?: boolean;
}) {
  const q = new URLSearchParams();
  if (opts.rel) q.set("rel", opts.rel);
  if (opts.basename) q.set("basename", opts.basename);
  if (opts.limit != null) q.set("limit", String(opts.limit));
  if (opts.transitive === false) q.set("transitive", "false");
  const qs = q.toString();
  return jsonFetch<{
    query: { repo_rel?: string; basename?: string; transitive?: boolean };
    count: number;
    direct_count?: number;
    refs: BomXrefEdge[];
    hosts: BomXrefHost[];
  }>(`/api/cad/bom/xref/incoming${qs ? `?${qs}` : ""}`);
}

export function fetchBomXrefOutgoing(rel: string, limit?: number, refreshDisk = false) {
  const q = new URLSearchParams({ rel });
  if (limit != null) q.set("limit", String(limit));
  if (!refreshDisk) q.set("refresh_disk", "false");
  return jsonFetch<{
    host_repo_rel_path: string;
    count: number;
    label_mismatch_count?: number;
    refs: BomXrefEdge[];
  }>(
    `/api/cad/bom/xref/outgoing?${q}`,
  );
}

/** 文件详情「引用」Tab：入向 + 出向一次返回（懒加载） */
export type FileDetailXrefsPayload = {
  rel: string;
  index_pending?: boolean;
  incoming: {
    count: number;
    direct_count: number;
    hosts: BomXrefHost[];
  };
  outgoing: {
    count: number;
    label_mismatch_count?: number;
    refs: BomXrefEdge[];
  };
};

export function fetchBomXrefCounts(rel: string) {
  return jsonFetch<BomXrefCounts & { index_pending?: boolean }>(
    `/api/cad/bom/xref/counts?rel=${encodeURIComponent(rel)}`,
  );
}

export function fetchFileDetailXrefs(opts: {
  rel: string;
  limit?: number;
  transitive?: boolean;
  refreshDisk?: boolean;
  scope?: "both" | "outgoing" | "incoming";
}) {
  const q = new URLSearchParams({ rel: opts.rel });
  if (opts.limit != null) q.set("limit", String(opts.limit));
  if (opts.scope) q.set("scope", opts.scope);
  if (opts.transitive) q.set("transitive", "true");
  if (opts.refreshDisk) q.set("refresh_disk", "true");
  return jsonFetch<FileDetailXrefsPayload>(`/api/file-detail/xrefs?${q}`);
}

export type BomXrefRefreshHostResult = {
  host_repo_rel_path: string;
  recursive: boolean;
  hosts_refreshed: number;
  hosts: string[];
  outgoing_count: number;
  outgoing_missing: number;
  outgoing_ambiguous: number;
  outgoing_resolved: number;
  updated_hosts?: number;
  edge_count?: number;
  log?: string;
};

export function refreshBomXrefHostIndex(body: {
  host_repo_rel: string;
  recursive?: boolean;
  max_hosts?: number;
}) {
  return jsonFetch<BomXrefRefreshHostResult>("/api/cad/bom/xref/refresh-host-index", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 异步启动单文件引用索引重建，返回 {scan_id} */
export function startBomXrefRebuild(body: {
  host_repo_rel: string;
  recursive?: boolean;
  max_hosts?: number;
}) {
  return jsonFetch<{ scan_id: string }>("/api/cad/bom/xref/refresh-host-index/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 轮询异步重建进度 */
export function fetchBomXrefRebuildProgress(scanId: string) {
  const params = new URLSearchParams({ scan_id: scanId });
  return jsonFetch<ScanProgressPayload>(`/api/cad/bom/xref/refresh-host-index/progress?${params}`);
}

/** 取消正在运行的异步重建 */
export function cancelBomXrefRebuild(scanId: string) {
  const params = new URLSearchParams({ scan_id: scanId });
  return jsonFetch<{ ok: boolean }>(`/api/cad/bom/xref/refresh-host-index/cancel?${params}`, { method: "POST" });
}

export type AssemblyBomHostRow = {
  host_repo_rel_path: string;
  filename: string;
  part_number: string;
  part_version: string;
  part_key: string;
  TypeCode: string;
  ModelSeries: string;
  PartName: string;
  label: string;
  ref_count: number;
  missing_count: number;
  ambiguous_count: number;
  /** 直接引用本文件的宿主数（bom_xref） */
  incoming_host_count: number;
  file_role: string;
};

export type BomTargetUsageStats = {
  target_repo_rel_path: string;
  direct_incoming_host_count: number;
  bom_occurrence_count: number;
  bom_root_count: number;
  occurrences: {
    root_host_repo_rel_path: string;
    tree_path: string;
    host_repo_rel_path: string;
    link_label: string;
  }[];
};

export function fetchBomTargetUsageStats(rel: string) {
  const q = new URLSearchParams({ rel });
  return jsonFetch<BomTargetUsageStats>(`/api/cad/bom/xref/usage-stats?${q}`);
}

export function fetchAssemblyBomHosts(search?: string) {
  const q = new URLSearchParams();
  if (search?.trim()) q.set("search", search.trim());
  const qs = q.toString();
  return jsonFetch<{
    count: number;
    hosts: AssemblyBomHostRow[];
    filter?: { assembly_only?: boolean; exclude_drawings?: boolean; note?: string };
  }>(`/api/cad/bom/xref/assembly-hosts${qs ? `?${qs}` : ""}`);
}

export function fetchBomXrefEdges(opts?: { offset?: number; limit?: number; search?: string }) {
  const q = new URLSearchParams();
  if (opts?.offset != null) q.set("offset", String(opts.offset));
  if (opts?.limit != null) q.set("limit", String(opts.limit));
  if (opts?.search?.trim()) q.set("search", opts.search.trim());
  const qs = q.toString();
  return jsonFetch<{
    offset: number;
    limit: number;
    total: number;
    count: number;
    refs: BomXrefEdge[];
  }>(`/api/cad/bom/xref/edges${qs ? `?${qs}` : ""}`);
}

export function rebuildBomXrefs() {
  return jsonFetch<
    BomXrefMeta & {
      scan_id?: number;
      log?: string;
      host_files_scanned?: number;
      hosts_with_xlink?: number;
      hosts_without_xlink?: number;
    }
  >("/api/cad/bom/xref/rebuild", { method: "POST" });
}

export type PartKeyEntry = {
  id: number;
  part_number: string;
  part_version: string;
  part_key: string;
  TypeCode: string;
  ModelSeries: string;
  PartName: string;
  label: string;
  notes: string;
  status: "active" | "obsolete" | string;
  file_count: number;
  present_count: number;
  missing_count: number;
  /** 首个 present 关联文件路径，供目录页标签链到文件详情 */
  primary_repo_rel?: string;
  created_at: string;
  updated_at: string;
};

export type PartKeyFile = {
  id: number;
  repo_rel_path: string;
  filename: string;
  asset_kind?: string;
  PartNumber: string;
  PartVersion: string;
  TypeCode: string;
  ModelSeries: string;
  PartName: string;
  label: string;
  file_status: "present" | "missing";
  file_role: string;
  link_notes: string;
  link_status: "active" | "obsolete" | string;
  linked_at: string;
  last_seen_at: string;
  updated_at: string;
};

export type PartKeysPayload = {
  database_path: string;
  database_path_display: string;
  exists: boolean;
  entries: PartKeyEntry[];
  _native?: "node";
  stats: {
    total_keys: number;
    total_files: number;
    obsolete_keys: number;
  };
};

export type PartKeyDetail = PartKeyEntry & {
  files: PartKeyFile[];
};

export function fetchPartKeys() {
  return jsonFetch<PartKeysPayload>("/api/cad/parts");
}

export type PartKeyInfer = {
  rel: string;
  filename: string;
  part_number: string;
  part_version: string;
  part_key: string;
  source: "filename" | "index" | "filename+index";
  in_catalog: boolean;
};

export function inferPartKeyFromPath(rel: string) {
  return jsonFetch<PartKeyInfer>(`/api/cad/parts/infer?rel=${encodeURIComponent(rel)}`);
}

export function fetchPartKeyDetail(partNumber: string, partVersion: string) {
  return jsonFetch<PartKeyDetail>(
    `/api/cad/parts/${encodeURIComponent(partNumber)}/${encodeURIComponent(partVersion)}`,
  );
}

export type AssemblyXrefInstance = {
  xlink_file_attr: string;
  link_label: string;
};

export type AssemblyTreeNode = {
  id: string;
  host_repo_rel: string;
  repo_rel_path: string;
  basename: string;
  resolve_status: string;
  xlink_file_attr: string;
  part_number: string;
  part_version: string;
  part_key: string;
  TypeCode: string;
  ModelSeries: string;
  PartName: string;
  label: string;
  /** 装配内引用实例 Label（当前树中名称） */
  link_label: string;
  link_labels: string[];
  xref_instances: AssemblyXrefInstance[];
  /** 目标文件的规则显示名 */
  rule_label?: string;
  ref_count: number;
  file_role: string;
  children: AssemblyTreeNode[];
};

export type LinkLabelPatch = {
  host_repo_rel: string;
  xlink_file_attr: string;
  link_label: string;
};

export function patchLinkLabels(patches: LinkLabelPatch[]) {
  return jsonFetch<{
    label_patches: number;
    applied_hosts: string[];
    failed: { host_repo_rel: string; error: string }[];
    label_changes?: ReferenceLabelChange[];
  }>("/api/cad/bom/xref/patch-labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patches }),
  });
}

export type AssemblyTreePayload = {
  host_repo_rel_path: string;
  mode: "first" | "full";
  node_count: number;
  nodes: AssemblyTreeNode[];
};

export function fetchAssemblyTreeByHost(
  hostRel: string,
  full: boolean,
  refreshDisk = false,
) {
  const params = new URLSearchParams({
    host_rel: hostRel,
    full: full ? "true" : "false",
  });
  if (refreshDisk) params.set("refresh_disk", "true");
  return jsonFetch<AssemblyTreePayload>(`/api/cad/bom/xref/assembly-tree?${params}`);
}

export function fetchPartAssemblyTree(
  partNumber: string,
  partVersion: string,
  hostRel: string,
  full: boolean,
) {
  const params = new URLSearchParams({
    host_rel: hostRel,
    full: full ? "true" : "false",
  });
  return jsonFetch<AssemblyTreePayload>(
    `/api/cad/parts/${encodeURIComponent(partNumber)}/${encodeURIComponent(partVersion)}/assembly-tree?${params}`,
  );
}

export function patchPartKey(
  partNumber: string,
  partVersion: string,
  patch: Partial<Pick<PartKeyEntry, "TypeCode" | "ModelSeries" | "PartName" | "label" | "notes" | "status">>,
) {
  return jsonFetch<PartKeyDetail>(
    `/api/cad/parts/${encodeURIComponent(partNumber)}/${encodeURIComponent(partVersion)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
}

export function patchPartFileLink(
  partNumber: string,
  partVersion: string,
  fileAssetId: number,
  patch: Partial<Pick<PartKeyFile, "file_role" | "link_notes" | "link_status">>,
) {
  return jsonFetch<PartKeyDetail>(
    `/api/cad/parts/${encodeURIComponent(partNumber)}/${encodeURIComponent(partVersion)}/files/${fileAssetId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
}

export type XlinkFixPrefs = {
  batch_dir: string;
  dry_run: boolean;
  all_in_dir: boolean;
};

export type XlinkFixIssueRow = {
  host_repo_rel: string;
  host_filename: string;
  host_display: string;
  old_path: string;
  new_path: string;
  target_file: string;
  target_display: string;
  verdict: string;
  note: string;
  count: number;
  status: "fixable" | "not_found" | "fixed_manual";
  basename?: string;
  part_number?: string;
  part_version?: string;
  part_key?: string;
};

export type XlinkFixOverrideResult = {
  patches: number;
  new_path: string;
  host_repo_rel: string;
  old_path: string;
  target_repo_rel: string;
  target_display: string;
  unchanged?: boolean;
};

export type XlinkFixStats = {
  host_count: number;
  hosts_with_issues: number;
  issue_count: number;
  fixable_count: number;
  not_found_count: number;
  skipped_count: number;
  total_changes: number;
};

export type XlinkFixResult = {
  exit_code: number;
  log: string;
  prefs: XlinkFixPrefs;
  batch_dir_display: string;
  map_path_display: string;
  schema?: number;
  dry_run?: boolean;
  total_changes?: number;
  report_path?: string;
  skipped?: string[];
  files?: unknown[];
  issue_rows?: XlinkFixIssueRow[];
  stats?: XlinkFixStats;
};

export function fetchXlinkPrefs() {
  return jsonFetch<XlinkFixPrefs>("/api/cad/xlink-fix/prefs");
}

export function saveXlinkPrefs(prefs: Partial<XlinkFixPrefs>) {
  return jsonFetch<XlinkFixPrefs>("/api/cad/xlink-fix/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export function analyzeXlinkFix(opts: Pick<Partial<XlinkFixPrefs>, "batch_dir" | "all_in_dir"> = {}) {
  return jsonFetch<XlinkFixResult>("/api/cad/xlink-fix/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export function runXlinkFix(opts: Partial<XlinkFixPrefs> = {}) {
  return jsonFetch<XlinkFixResult>("/api/cad/xlink-fix/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export function applyXlinkFixOverride(body: {
  host_repo_rel: string;
  old_path: string;
  target_repo_rel: string;
}) {
  return jsonFetch<XlinkFixOverrideResult>("/api/cad/xlink-fix/apply-override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type XlinkFixCandidateFile = {
  id: number;
  repo_rel_path: string;
  filename: string;
  part_number: string;
  part_version: string;
  part_key: string;
  file_status: string;
};

export type XlinkFixCandidatesPayload = {
  basename: string;
  part_number: string;
  part_version: string;
  part_key: string;
  files: XlinkFixCandidateFile[];
};

export function fetchXlinkFixCandidates(opts: {
  basename: string;
  part_number?: string;
  part_version?: string;
  /** 排除宿主自身（文件详情改链接时传当前 FCStd） */
  exclude_repo_rel?: string;
}) {
  const params = new URLSearchParams({ basename: opts.basename });
  if (opts.part_number) params.set("part_number", opts.part_number);
  if (opts.part_version) params.set("part_version", opts.part_version);
  if (opts.exclude_repo_rel?.trim()) params.set("exclude_repo_rel", opts.exclude_repo_rel.trim());
  return jsonFetch<XlinkFixCandidatesPayload>(`/api/cad/xlink-fix/candidates?${params}`);
}

export type PartDedupPrefs = {
  extension: string;
  code_len: number;
  ver_len: number;
  check_code: boolean;
  check_version: boolean;
  code_must_be_digit: boolean;
  scan_dir: string;
};

export type PartDedupGroup = {
  label: string;
  paths: string[];
  paths_display?: string[];
  code?: string;
  version?: string;
  csv_fc?: string;
};

export type PartDedupScanResult = {
  file_count: number;
  extension: string;
  scan_display: string;
  summary: string;
  prefs: PartDedupPrefs;
  stats: { name_dup: number; code_dup: number; ver_dup: number };
  results: {
    name_dup: PartDedupGroup[];
    code_dup: PartDedupGroup[];
    ver_dup: PartDedupGroup[];
  };
};

export function fetchPartDedupPrefs() {
  return jsonFetch<PartDedupPrefs>("/api/cad/part-dedup/prefs");
}

export function savePartDedupPrefs(prefs: Partial<PartDedupPrefs>) {
  return jsonFetch<PartDedupPrefs>("/api/cad/part-dedup/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export function scanPartDedup(opts: Partial<PartDedupPrefs> = {}) {
  return jsonFetch<PartDedupScanResult>("/api/cad/part-dedup/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export function exportPartDedupCsv(results?: PartDedupScanResult["results"]) {
  return jsonFetch<{ path: string; path_display: string }>("/api/cad/part-dedup/export-csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(results ? { results } : {}),
  });
}

export type KtCodegenDocumentFormat = "legacy-v4-json" | "legacy-17-column-csv";

export type KtCodegenDocumentSummary = {
  path: string;
  file_name: string;
  format: KtCodegenDocumentFormat;
  class_name: string;
  item_count: number;
  diagnostic_count: number;
};

export type KtCodegenHostDocument = KtCodegenDocumentSummary & {
  kind: "kt.codegen.host-document";
  schema_version: 1;
  fingerprint: string;
  file_signature: string;
  document_revision: number;
  encoding: "utf8" | "utf8-bom" | "gbk";
  param: KtCodegenParam;
  table: KtCodegenTableData;
  diagnostics: KtCodegenDiagnostic[];
};

export type KtCodegenDocumentsPayload = {
  workspace: string;
  documents: KtCodegenDocumentSummary[];
  scanned_file_count: number;
  truncated: boolean;
  cache_hit_count: number;
  files_read: number;
  config_snapshot_bytes: number;
  config_scan_byte_limit_reached: boolean;
};

export type KtCodegenPreflightPayload = {
  plan: KtCodegenPlan;
  plan_fingerprint: string;
  safe_to_apply: boolean;
  reused: boolean;
  created_at: string;
  indexed_file_count: number;
  candidate_file_count: number;
  source_scan_truncated: boolean;
  source_scan_byte_limit_reached: boolean;
  source_snapshot_bytes: number;
  source_cache_hits: number;
  source_files_read: number;
  source_file_signatures: Record<string, string>;
  source_file_fingerprints: Record<string, string>;
  source_candidates: KtCodegenSourceCandidateSummary[];
  source_candidates_truncated: boolean;
};

export type KtCodegenAppliedFile = {
  path: string;
  encoding: "utf8" | "utf8-bom" | "gbk";
  eol: "lf" | "crlf";
  region_count: number;
  bytes_before: number;
  bytes_after: number;
  fingerprint_before: string;
  fingerprint_after: string;
};

export type KtCodegenApplyPayload = {
  kind: "kt.codegen.apply-result";
  schema_version: 1;
  applied_at: string;
  plan_fingerprint: string;
  region_count: number;
  /** 逐区域真实写回结果；旧 Server 可能暂未提供。 */
  region_outcomes?: Array<{
    region_id: string;
    change: "updated" | "unchanged" | "not-applied";
  }>;
  files: KtCodegenAppliedFile[];
  diagnostics: KtCodegenDiagnostic[];
  verified: true;
};

export type KtCodegenSourceCandidateSummary = {
  path: string;
  fingerprint: string;
  encoding: "utf8" | "utf8-bom" | "gbk";
  eol: "lf" | "crlf";
  marker_line: number;
};

export type KtCodegenSourcePreviewPayload = {
  path: string;
  fingerprint: string;
  file_signature: string;
  expected_fingerprint: string;
  stale: boolean;
  encoding: "utf8" | "utf8-bom" | "gbk";
  eol: "lf" | "crlf";
  focus_start_line: number;
  focus_end_line: number;
  from_line: number;
  to_line: number;
  lines: Array<{ number: number; text: string; focus: boolean }>;
};

export type KtCodegenFileStatePayload = {
  path: string;
  exists: boolean;
  file_signature: string;
  fingerprint: string;
  changed: boolean;
};

export type KtCodegenFileStatesPayload = {
  files: KtCodegenFileStatePayload[];
  changed_count: number;
};

export function fetchKtCodegenDocuments(options?: { signal?: AbortSignal }) {
  return jsonFetch<KtCodegenDocumentsPayload>("/api/code/codegen/documents", {
    signal: options?.signal,
  });
}

export function openKtCodegenDocument(path: string) {
  return jsonFetch<KtCodegenHostDocument>("/api/code/codegen/open", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function fetchKtCodegenDocumentState(body: {
  path: string;
  expected_file_signature: string;
  expected_fingerprint: string;
}, options?: { signal?: AbortSignal }) {
  return jsonFetch<KtCodegenFileStatePayload>("/api/code/codegen/document-state", {
    method: "POST",
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

export function fetchKtCodegenSourceStates(files: Array<{
  path: string;
  expected_file_signature: string;
  expected_fingerprint: string;
}>, options?: { signal?: AbortSignal }) {
  return jsonFetch<KtCodegenFileStatesPayload>("/api/code/codegen/source-states", {
    method: "POST",
    body: JSON.stringify({ files }),
    signal: options?.signal,
  });
}

export function saveKtCodegenDocument(body: {
  path: string;
  fingerprint: string;
  param: KtCodegenParam;
  table: KtCodegenTableData;
}) {
  return jsonFetch<KtCodegenHostDocument>("/api/code/codegen/document", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function runKtCodegenPreflight(body: {
  param: KtCodegenParam;
  table: KtCodegenTableData;
  block_keys: string[];
}, options?: { signal?: AbortSignal }) {
  return jsonFetch<KtCodegenPreflightPayload>("/api/code/codegen/preflight", {
    method: "POST",
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

export function applyKtCodegenPlan(body: {
  param: KtCodegenParam;
  table: KtCodegenTableData;
  block_keys: string[];
  expected_plan_fingerprint: string;
}) {
  return jsonFetch<KtCodegenApplyPayload>("/api/code/codegen/apply", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchKtCodegenSourcePreview(body: {
  path: string;
  start_line: number;
  end_line: number;
  expected_fingerprint: string;
  context_lines?: number;
}, options?: { signal?: AbortSignal }) {
  return jsonFetch<KtCodegenSourcePreviewPayload>("/api/code/codegen/source-preview", {
    method: "POST",
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

export type CodeIndexStats = {
  source?: number;
  config?: number;
  doc?: number;
  resource?: number;
  total?: number;
};

export type CodeIndexEntry = {
  repo_rel_path: string;
  filename: string;
  asset_kind: string;
  file_ext: string;
  file_status: "present" | "missing" | string;
  size_bytes: number;
  text_encoding: string;
  last_seen_at?: string | null;
};

export type CodeIndexPayload = {
  workspace_path: string;
  workspace_path_display: string;
  last_scan_at?: string | null;
  stats?: CodeIndexStats | null;
  file_count: number;
  present_count: number;
  kind_labels: Record<string, string>;
  kinds: string[];
  builtin_extensions?: string[];
  extra_extensions?: string[];
  summary?: string;
  scan_id?: number;
};

export type CodeIndexExtensionCandidate = {
  ext: string;
  count: number;
};

export type CodeIndexExtensionDiscovery = {
  builtin_extensions: string[];
  extra_extensions: string[];
  candidates: CodeIndexExtensionCandidate[];
};

export type CodeIndexEntriesPayload = {
  entries: CodeIndexEntry[];
  total: number;
  limit: number;
  offset: number;
};

export type CodeIndexCatDlgEntry = {
  repo_rel_path: string;
  filename: string;
  size_bytes: number;
  last_seen_at?: string | null;
};

export type CodeIndexCatDlgPayload = {
  workspace_path: string;
  workspace_path_display: string;
  last_scan_at?: string | null;
  indexed: boolean;
  count: number;
  entries: CodeIndexCatDlgEntry[];
};

export function fetchCodeIndex() {
  return jsonFetch<CodeIndexPayload>("/api/code/index");
}

export function fetchCodeIndexCatDlg() {
  return jsonFetch<CodeIndexCatDlgPayload>("/api/code/index/catdlg");
}

export type CodeIndexSearchMode = "contains" | "filename";

export function fetchCodeIndexEntries(opts?: {
  offset?: number;
  limit?: number;
  status?: "all" | "present" | "missing";
  kind?: string;
  q?: string;
  searchMode?: CodeIndexSearchMode;
}) {
  const params = new URLSearchParams();
  if (opts?.offset != null) params.set("offset", String(opts.offset));
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  if (opts?.status && opts.status !== "all") params.set("status", opts.status);
  if (opts?.kind && opts.kind !== "all") params.set("kind", opts.kind);
  if (opts?.q?.trim()) params.set("q", opts.q.trim());
  if (opts?.searchMode && opts.searchMode !== "contains") {
    params.set("search_mode", opts.searchMode);
  }
  const qs = params.toString();
  return jsonFetch<CodeIndexEntriesPayload>(`/api/code/index/entries${qs ? `?${qs}` : ""}`);
}

export function scanCodeIndex(opts?: { adoptExtensions?: string[] }) {
  const body =
    opts?.adoptExtensions?.length
      ? { adopt_extensions: opts.adoptExtensions }
      : {};
  return jsonFetch<CodeIndexPayload>("/api/code/index/scan", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchCodeIndexExtensionDiscovery() {
  return jsonFetch<CodeIndexExtensionDiscovery>("/api/code/index/extension-discovery");
}

export function saveCodeIndexExtraExtensions(extensions: string[]) {
  return jsonFetch<{ extra_extensions: string[] }>("/api/code/index/extra-extensions", {
    method: "PUT",
    body: JSON.stringify({ extensions }),
  });
}

export function purgeMissingCodeIndex() {
  return jsonFetch<CodeIndexPayload & { purge_deleted?: number }>("/api/code/index/purge-missing", {
    method: "POST",
  });
}

export function exportCodeIndexJson() {
  return jsonFetch<{ path: string; path_display: string }>("/api/code/index/export-json", {
    method: "POST",
  });
}

export type ReorderMembersSelfTestCase = {
  id: string;
  pass: boolean;
  message: string;
  skipped?: boolean;
};

export type ReorderMembersSelfTestPayload = {
  ok: boolean;
  ran: number;
  passed: number;
  failed: number;
  skipped: number;
  summary: string;
  cases: ReorderMembersSelfTestCase[];
};

export function runReorderMembersSelfTest() {
  return jsonFetch<ReorderMembersSelfTestPayload>("/api/code/reorder-members/self-test", {
    method: "POST",
  });
}

export type ReorderMembersPrefs = {
  workspace_path: string;
  workspace_path_display: string;
  include_cpp: boolean;
  include_header: boolean;
  sort_members: boolean;
  verbose: boolean;
  kevin_system_code_mode: "merge_strip" | "keep_markers" | "off";
  last_selected: string[];
  ignore_file: string;
  ignore_file_display: string;
  ignore_file_exists: boolean;
  ignore_patterns: string[];
};

export type ReorderMembersEntry = {
  name: string;
  kind: "dir" | "file";
  source_file_count: number;
};

export type ReorderMembersTopLevelResponse = {
  workspace_path: string;
  workspace_path_display: string;
  entries: ReorderMembersEntry[];
  ignored: Array<{ name: string; kind: string; reason: string }>;
  ignore_file: string;
  ignore_file_display: string;
  ignore_file_exists: boolean;
  ignore_patterns: string[];
};

export type ReorderMembersRunResult = {
  ok: boolean;
  log: string;
  lines: string[];
  summary?: string;
  dry_run: boolean;
  cpp_changed?: number;
  hdr_changed?: number;
  files_scanned?: number;
  changed_files?: string[];
  item_results?: Array<{
    name: string;
    kind: string;
    cpp_changed: number;
    hdr_changed: number;
    files_scanned: number;
    changed_files?: string[];
  }>;
};

export function fetchReorderMembersPrefs() {
  return jsonFetch<ReorderMembersPrefs>("/api/code/reorder-members/prefs");
}

export function saveReorderMembersPrefs(prefs: Partial<ReorderMembersPrefs>) {
  return jsonFetch<ReorderMembersPrefs>("/api/code/reorder-members/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export function fetchReorderMembersTopLevel() {
  return jsonFetch<ReorderMembersTopLevelResponse>("/api/code/reorder-members/top-level");
}

export type ReorderMembersResolveResult = {
  workspace_path: string;
  resolved_files: string[];
  total: number;
};

export function resolveReorderMembersScope(body: { repo_rel_paths: string[] }) {
  return jsonFetch<ReorderMembersResolveResult>("/api/code/reorder-members/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function runReorderMembers(
  body: Partial<ReorderMembersPrefs> & {
    targets?: string[];
    repo_rel_paths?: string[];
    dry_run?: boolean;
  },
) {
  return jsonFetch<ReorderMembersRunResult>("/api/code/reorder-members/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// --- 壳层 Git 插件 (/api/git/*) ---

export function fetchGitInfo() {
  return jsonFetch<GitWorkspaceInfo>("/api/git/info");
}

export function fetchGitChanges() {
  return jsonFetch<GitChangesPayload>("/api/git/changes");
}

export function fetchGitDiff(path: string, scope: "worktree" | "staged" = "worktree") {
  const q = new URLSearchParams({ path, scope });
  return jsonFetch<GitFileDiff>(`/api/git/diff?${q}`);
}

export function initGitRepo() {
  return jsonFetch<{ ok: boolean; git_root: string; git_root_display: string }>("/api/git/init", {
    method: "POST",
  });
}

export function stageGitPaths(paths: string[]) {
  return jsonFetch<{ staged: string[] }>("/api/git/stage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
}

export function restoreGitPaths(
  paths: string[],
  scope: "worktree" | "staged" | "untracked" = "worktree",
) {
  return jsonFetch<{ restored: string[]; scope: string }>("/api/git/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths, scope }),
  });
}

export function commitGitRepo(message: string) {
  return jsonFetch<GitCommitResult>("/api/git/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
}

export type StepBatchPrefs = {
  step_dir: string;
  out_dir: string;
  skip_existing: boolean;
  view_fit: string;
  use_inbox_bridge: boolean;
  step_recursive: boolean;
};

export type StepBatchPreview = {
  step_dir_display: string;
  top_level: number;
  deep_total: number;
  batch_count: number;
  recursive: boolean;
  prefs: StepBatchPrefs;
};

export function fetchStepBatchPrefs() {
  return jsonFetch<StepBatchPrefs>("/api/cad/step-batch/prefs");
}

export function saveStepBatchPrefs(prefs: Partial<StepBatchPrefs>) {
  return jsonFetch<StepBatchPrefs>("/api/cad/step-batch/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export function previewStepBatch(opts: Partial<StepBatchPrefs> = {}) {
  return jsonFetch<StepBatchPreview>("/api/cad/step-batch/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export function runStepBatch(opts: Partial<StepBatchPrefs> = {}) {
  return jsonFetch<{
    exit_code: number;
    log: string;
    ok_count: number | null;
    skip_count: number | null;
    fail_count: number | null;
    total_count: number | null;
    out_dir_display: string;
    report_display: string;
    prefs: StepBatchPrefs;
  }>("/api/cad/step-batch/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export type SwStepPrefs = {
  source_dir: string;
  out_step_dir: string;
  recursive_scan: boolean;
  com_available: boolean;
  adapter_available: boolean;
  solidworks_registered: boolean | null;
  availability_code:
    | "ready"
    | "custom_adapter"
    | "unsupported_platform"
    | "adapter_missing"
    | "solidworks_not_registered";
  platform: string;
};

export function fetchSwStepPrefs() {
  return jsonFetch<SwStepPrefs>("/api/cad/sw-step/prefs");
}

export function saveSwStepPrefs(prefs: Partial<SwStepPrefs>) {
  return jsonFetch<SwStepPrefs>("/api/cad/sw-step/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export function previewSwStepExport(opts: Partial<SwStepPrefs> = {}) {
  return jsonFetch<{ source_display: string; model_count: number; prefs: SwStepPrefs }>(
    "/api/cad/sw-step/preview",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    },
  );
}

export function runSwStepExport(opts: Partial<SwStepPrefs> = {}) {
  return jsonFetch<{
    ok_count: number;
    failed_count: number;
    failed: { path: string; error: string }[];
    log: string;
    out_display: string;
    prefs: SwStepPrefs;
  }>("/api/cad/sw-step/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export type ProcessDirSuggestion = {
  name: string;
  kind: string;
  reason: string;
  repo_rel_path: string;
  suggested_pattern: string;
};

export type CodeIgnorePrefs = {
  workspace_path: string;
  workspace_path_display: string;
  ignore_preset: string;
  ignore_presets: Array<{ id: string; label: string; patterns: string[] }>;
  custom_ignore: string[];
  ignore_file: string;
  ignore_file_display: string;
  ignore_file_exists: boolean;
  legacy_ignore_sources: Array<{ filename: string; patterns: string[] }>;
  ignore_builtin: string[];
  ignore_file_patterns: string[];
  ignore_custom_patterns: string[];
  ignore_patterns: string[];
  consumers: string[];
  process_dir_suggestions?: ProcessDirSuggestion[];
  process_dirs_auto_seeded?: string[];
  process_dirs_seeded?: boolean;
};

export function fetchCodeIgnorePrefs() {
  return jsonFetch<CodeIgnorePrefs>("/api/code/ignore/prefs");
}

export function fetchCodeIgnoreSuggestions() {
  return jsonFetch<{
    suggestions: ProcessDirSuggestion[];
    suggested_patterns: string[];
  }>("/api/code/ignore/suggestions");
}

export function saveCodeIgnorePrefs(prefs: Partial<CodeIgnorePrefs>) {
  return jsonFetch<CodeIgnorePrefs>("/api/code/ignore/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export type RenameLevel = "dir" | "file" | "text";

export type CodeRenamePrefs = {
  workspace_path: string;
  workspace_path_display: string;
  old: string;
  new: string;
  levels: RenameLevel[];
  scope: string;
  target_encoding: "utf-8" | "gbk";
  include_ignored: boolean;
  rescan_index: boolean;
  implemented: boolean;
};

export type CodeRenameHit = {
  hit_id: string;
  repo_rel_path: string;
  level: RenameLevel;
  hits: number;
  lines?: number[];
  encoding_in?: string;
  encoding_out?: string;
  status?: string;
  detail?: string;
  new_path?: string;
};

export type CodeRenameSummary = {
  dirs: number;
  files: number;
  text_files: number;
  total_hits: number;
  skipped: number;
};

export type CodeRenameResult = {
  ok: boolean;
  implemented: boolean;
  dry_run: boolean;
  message?: string;
  old: string;
  new: string;
  levels: RenameLevel[];
  scope: string;
  target_encoding: string;
  include_ignored: boolean;
  rescan_index: boolean;
  hits: CodeRenameHit[];
  summary: CodeRenameSummary;
  report_path?: string;
  report_path_display?: string;
  log?: string;
  lines?: string[];
};

export function fetchCodeRenamePrefs() {
  return jsonFetch<CodeRenamePrefs>("/api/code/rename/prefs");
}

export function saveCodeRenamePrefs(prefs: Partial<CodeRenamePrefs>) {
  return jsonFetch<CodeRenamePrefs>("/api/code/rename/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export function previewCodeRename(body: Partial<CodeRenamePrefs>) {
  return jsonFetch<CodeRenameResult>("/api/code/rename/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function applyCodeRename(body: Partial<CodeRenamePrefs> & { confirm_token?: string }) {
  return jsonFetch<CodeRenameResult>("/api/code/rename/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type WorksetEntry = {
  path: string;
  type: "file" | "dir";
};

export type FileWorkset = {
  id: string;
  name: string;
  /** 新格式：条目列表（含文件/目录类型） */
  entries?: WorksetEntry[];
  /** @deprecated 旧格式，已自动转为 entries */
  paths?: string[];
  source?: string;
  updated_at: string;
};

export type FileWorksetPayload = {
  version: number;
  worksets: FileWorkset[];
  workspace_path?: string;
  workspace_path_display?: string;
  path?: string;
  path_display?: string;
  storage?: string;
  legacy_json_path?: string;
};

export function fetchFileWorksets() {
  return jsonFetch<FileWorksetPayload>("/api/file-worksets");
}

export function saveFileWorksets(body: { worksets: FileWorkset[] }) {
  return jsonFetch<FileWorksetPayload>("/api/file-worksets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function pruneMissingFileWorksetPaths(body?: { workset_id?: string }) {
  return jsonFetch<FileWorksetPayload & { prune_removed?: number }>(
    "/api/file-worksets/prune-missing",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
  );
}

export type UuidKind = "uuid" | "guid32" | "suspicious";
export type UuidApplyStrategy = "map_per_value" | "fresh_per_hit";

export type CodeUuidHit = {
  hit_id: string;
  repo_rel_path: string;
  line: number;
  col: number;
  matched_text: string;
  uuid_normalized: string;
  kind: UuidKind;
  file_hits: number;
};

export type CodeUuidScanResult = {
  ok: boolean;
  implemented: boolean;
  message?: string;
  scan_id: string | null;
  scope: string;
  kinds: UuidKind[];
  hits: CodeUuidHit[];
  ignore_file_display?: string;
  ignore_file_exists?: boolean;
  ignore_file_patterns?: string[];
  ignore_custom_patterns?: string[];
  summary: {
    files_scanned: number;
    total_hits: number;
    unique_uuids: number;
  };
};

export type CodeUuidApplyResult = {
  ok: boolean;
  implemented: boolean;
  dry_run: boolean;
  message?: string;
  hit_ids: string[];
  strategy: UuidApplyStrategy;
  mappings: Array<{ old: string; new: string; hit_id: string }>;
  summary: {
    files_scanned: number;
    total_hits: number;
    unique_uuids: number;
    unique_new_uuids?: number;
  };
  report_path?: string;
  report_path_display?: string;
  log?: string;
  lines?: string[];
};

export function scanCodeUuids(body: {
  scope?: string;
  kinds?: UuidKind[];
  use_index_scope?: boolean;
  repo_rel_paths?: string[];
  include_ignored?: boolean;
} = {}) {
  return jsonFetch<CodeUuidScanResult>("/api/code/uuid/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function applyCodeUuids(body: {
  hit_ids: string[];
  strategy?: UuidApplyStrategy;
  dry_run?: boolean;
}) {
  return jsonFetch<CodeUuidApplyResult>("/api/code/uuid/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type UnitTestSuiteInfo = {
  id: string;
  label: string;
  description: string;
  module_count: number;
  modules: string[];
  backend: "vitest" | "runtime";
};

export type UnitTestCaseResult = {
  id: string;
  module: string;
  suite_id: string;
  class_name: string;
  method: string;
  status: "passed" | "failed" | "error" | "skipped";
  duration_ms: number;
  message: string;
  traceback: string;
};

export type UnitTestModuleSummary = {
  module: string;
  tests_run: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
};

export type UnitTestRunResult = {
  ok: boolean;
  suite_id: string;
  suite_label: string;
  duration_ms: number;
  summary: {
    tests_run: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
    modules: number;
    load_errors?: number;
    ignored?: number;
    cancelled?: number;
  };
  modules: UnitTestModuleSummary[];
  cases: UnitTestCaseResult[];
  failures: UnitTestCaseResult[];
};

export function fetchUnitTestSuites() {
  return jsonFetch<{ suites: UnitTestSuiteInfo[] }>("/api/unit-tests/suites");
}

export type UnitTestPlanCase = {
  id: string;
  class_name: string;
  method: string;
};

export type UnitTestPlanModule = {
  module: string;
  suite_id: string;
  backend?: "vitest" | "runtime";
  case_count: number;
  cases?: UnitTestPlanCase[];
};

export type UnitTestPlan = {
  suite_id: string;
  suite_label: string;
  total_modules: number;
  total_cases: number;
  ignored_cases: number;
  load_errors: string[];
  modules: UnitTestPlanModule[];
};

export function fetchUnitTestPlan(
  suites: string[],
  options?: UnitTestRunOptions & { include_case_details?: boolean },
) {
  return jsonFetch<UnitTestPlan>("/api/unit-tests/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      suites,
      exclude_cases: options?.exclude_cases,
      include_cases: options?.include_cases,
      include_modules: options?.include_modules,
      include_case_details: options?.include_case_details ?? false,
    }),
  });
}

export type UnitTestRunOptions = {
  exclude_cases?: string[];
  include_cases?: string[];
  /** Full module names (e.g. tests.test_code_index). Omit when all modules in selected suites should run. */
  include_modules?: string[];
};

export function runUnitTests(suites: string[], options?: UnitTestRunOptions) {
  return jsonFetch<UnitTestRunResult>("/api/unit-tests/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suites, ...options }),
  });
}

export type TestModuleCatalogEntry = {
  module_name: string;
  file_stem: string;
  suite_id: string;
  title: string;
  description_zh: string;
  doc_path: string | null;
  case_count: number;
};

export type TestCaseCatalogEntry = {
  full_id: string;
  case_key: string | null;
  module_name: string;
  class_name: string;
  method_name: string;
  suite_id: string;
  title: string;
  description_zh: string;
  summary?: string;
  docstring: string;
};

export function fetchTestModuleCatalog(modules?: string[]) {
  const params = new URLSearchParams();
  if (modules?.length) {
    for (const m of modules) params.append("modules", m);
  }
  const qs = params.toString();
  return jsonFetch<{ modules: Record<string, TestModuleCatalogEntry> }>(
    `/api/runtime-catalog/test-modules${qs ? `?${qs}` : ""}`,
  );
}

export function fetchTestCaseCatalog(caseIds?: string[]) {
  const params = new URLSearchParams();
  if (caseIds?.length) {
    for (const id of caseIds) params.append("ids", id);
  }
  const qs = params.toString();
  return jsonFetch<{ cases: Record<string, TestCaseCatalogEntry> }>(
    `/api/runtime-catalog/test-cases${qs ? `?${qs}` : ""}`,
  );
}

export type UnitTestStreamEvent =
  | {
      type: "start";
      run_id?: string;
      suite_id: string;
      suite_label: string;
      total_modules: number;
      total_cases: number;
      modules: string[];
      load_errors: string[];
      ignored_cases?: number;
      ignored?: Array<{ id: string; method: string; module: string; reason?: string }>;
    }
  | {
      type: "module_start";
      module: string;
      module_index: number;
      module_total: number;
      suite_id: string;
    }
  | {
      type: "case_start";
      id: string;
      module: string;
      suite_id: string;
      class_name: string;
      method: string;
    }
  | {
      type: "case_done";
      case: UnitTestCaseResult;
      completed: number;
      total: number;
    }
  | { type: "module_done"; module: string; summary: UnitTestModuleSummary }
  | { type: "done"; result: UnitTestRunResult }
  | { type: "cancelled"; result: UnitTestRunResult; completed: number; total: number }
  | { type: "error"; message: string };

export type UnitTestRunStreamOptions = UnitTestRunOptions & {
  signal?: AbortSignal;
};

export function cancelUnitTestRun(runId: string) {
  return jsonFetch<{ ok: boolean }>("/api/unit-tests/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_id: runId }),
  });
}

export async function runUnitTestsStream(
  suites: string[],
  onEvent: (event: UnitTestStreamEvent) => void,
  options?: UnitTestRunStreamOptions,
): Promise<UnitTestRunResult> {
  const signal = options?.signal;
  const body = {
    suites,
    exclude_cases: options?.exclude_cases,
    include_cases: options?.include_cases,
    include_modules: options?.include_modules,
  };
  const res = await fetch(apiUrl("/api/unit-tests/run/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const data = JSON.parse(text) as { detail?: unknown };
      if (data.detail != null) detail = String(data.detail);
    } catch {
      /* keep raw text */
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error("流式响应不可用");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const streamState: { finalResult: UnitTestRunResult | null } = { finalResult: null };

  const consumeEvent = (event: UnitTestStreamEvent) => {
    if (event.type === "error") {
      throw new Error(event.message);
    }
    onEvent(event);
    if (event.type === "done" || event.type === "cancelled") {
      streamState.finalResult = event.result;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          consumeEvent(JSON.parse(line) as UnitTestStreamEvent);
        }
        newline = buffer.indexOf("\n");
      }
    }

    const tail = buffer.trim();
    if (tail) {
      consumeEvent(JSON.parse(tail) as UnitTestStreamEvent);
    }
  } catch (e) {
    if (signal?.aborted) {
      if (streamState.finalResult) return streamState.finalResult;
      throw new Error("运行已终止");
    }
    throw e;
  }

  const finalResult = streamState.finalResult;
  if (!finalResult) {
    throw new Error("测试运行未返回结果");
  }
  return finalResult;
}
