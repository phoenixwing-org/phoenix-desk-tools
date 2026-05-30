import type { AppConfig, LauncherPrefs, ShellLayout } from "./types/config";

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
  drawing_and_assembly: boolean;
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
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
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
    const detail =
      typeof data === "object" && data !== null && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : res.statusText;
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return data as T;
}

export function fetchAppConfig() {
  return jsonFetch<AppConfig>("/api/config/app");
}

export function fetchLauncherPrefs() {
  return jsonFetch<LauncherPrefs>("/api/config/launcher");
}

export function syncLauncherFromLegacy() {
  return jsonFetch<LauncherPrefs>("/api/config/launcher/sync-legacy", {
    method: "POST",
  });
}

export function saveLauncherFreecad(path: string) {
  return jsonFetch<{ freecad_dir: string }>("/api/config/launcher/freecad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export function patchShellLayout(patch: Partial<ShellLayout>) {
  return jsonFetch<ShellLayout>("/api/config/launcher/shell-layout", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function getWorkspace() {
  return jsonFetch<{ path: string; name: string }>("/api/workspace");
}

export function setWorkspace(path: string) {
  return jsonFetch<{ path: string; name: string }>("/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export function fetchTree(fcstd = true, sw = false) {
  const q = new URLSearchParams({
    fcstd: fcstd ? "true" : "false",
    sw: sw ? "true" : "false",
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
  return jsonFetch<BomApplyPrefs>("/api/bom/prefs");
}

export function fetchBom(rel: string) {
  return jsonFetch<BomPreview>(`/api/bom?rel=${encodeURIComponent(rel)}`);
}

export function saveBom(rel: string, fields: Partial<BomFields>) {
  return jsonFetch<{ status: string }>(`/api/bom?rel=${encodeURIComponent(rel)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bomBody(fields)),
  });
}

export function fillRecommendedValues(rel: string, fields: Partial<BomFields>) {
  return jsonFetch<{ fields: BomFields; filled_keys: string[] }>(
    `/api/bom/fill-recommended-values?rel=${encodeURIComponent(rel)}`,
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
    `/api/bom/fill-from-embedded?rel=${encodeURIComponent(rel)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...bomBody(fields), kind_filters: kindFilters }),
    },
  );
}

export function fillBomFromFilename(rel: string) {
  return jsonFetch<{ fields: BomFields }>(
    `/api/bom/fill-from-filename?rel=${encodeURIComponent(rel)}`,
    { method: "POST" },
  );
}

export function applyLabelFormula(
  rel: string,
  fields: Partial<BomFields>,
  fillEmptyFromPrefs = true,
) {
  return jsonFetch<{ fields: BomFields; label: string; filled_keys: string[] }>(
    `/api/bom/apply-label-formula?rel=${encodeURIComponent(rel)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...bomBody(fields), fill_empty_from_prefs: fillEmptyFromPrefs }),
    },
  );
}

export function fetchBomDocumentKinds(rel: string) {
  return jsonFetch<{ document_kinds: NonNullable<BomPreview["document_kinds"]> }>(
    `/api/bom/document-kinds?rel=${encodeURIComponent(rel)}`,
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
  }>(`/api/bom/recommend-filename?rel=${encodeURIComponent(rel)}`, {
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
) {
  return jsonFetch<{ rel_path: string; filename: string; map_updated: boolean }>(
    `/api/bom/rename?rel=${encodeURIComponent(rel)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...bomBody(fields),
        baseline: bomBody(baseline),
      }),
    },
  );
}

export type FcstdMapEntry = {
  repo_rel_path: string;
  filename: string;
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
  fcstd_file_count: number;
};

export type FcstdMapPayload = {
  database_path: string;
  database_path_display: string;
  map_path: string;
  map_path_display: string;
  exists: boolean;
  prefs: { scan_root: string };
  last_scan_at: string;
  scan_root: string;
  stats: FcstdMapStats;
  entries: FcstdMapEntry[];
  scan_log?: string;
};

export function fetchFcstdMap() {
  return jsonFetch<FcstdMapPayload>("/api/fcstd-map");
}

export function saveFcstdMapPrefs(scan_root: string) {
  return jsonFetch<{ scan_root: string }>("/api/fcstd-map/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scan_root }),
  });
}

export function scanFcstdMap(scan_root = "") {
  return jsonFetch<FcstdMapPayload>("/api/fcstd-map/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scan_root }),
  });
}

export function exportFcstdMapJson() {
  return jsonFetch<{ path: string; path_display: string }>("/api/fcstd-map/export-json", {
    method: "POST",
  });
}

export type XlinkFixPrefs = {
  batch_dir: string;
  dry_run: boolean;
  all_in_dir: boolean;
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
  skipped?: unknown[];
  files?: unknown[];
};

export function fetchXlinkPrefs() {
  return jsonFetch<XlinkFixPrefs>("/api/xlink-fix/prefs");
}

export function saveXlinkPrefs(prefs: Partial<XlinkFixPrefs>) {
  return jsonFetch<XlinkFixPrefs>("/api/xlink-fix/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export function runXlinkFix(opts: Partial<XlinkFixPrefs> = {}) {
  return jsonFetch<XlinkFixResult>("/api/xlink-fix/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
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
  return jsonFetch<PartDedupPrefs>("/api/part-dedup/prefs");
}

export function savePartDedupPrefs(prefs: Partial<PartDedupPrefs>) {
  return jsonFetch<PartDedupPrefs>("/api/part-dedup/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export function scanPartDedup(opts: Partial<PartDedupPrefs> = {}) {
  return jsonFetch<PartDedupScanResult>("/api/part-dedup/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export function exportPartDedupCsv(results?: PartDedupScanResult["results"]) {
  return jsonFetch<{ path: string; path_display: string }>("/api/part-dedup/export-csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(results ? { results } : {}),
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
  return jsonFetch<StepBatchPrefs>("/api/step-batch/prefs");
}

export function saveStepBatchPrefs(prefs: Partial<StepBatchPrefs>) {
  return jsonFetch<StepBatchPrefs>("/api/step-batch/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export function previewStepBatch(opts: Partial<StepBatchPrefs> = {}) {
  return jsonFetch<StepBatchPreview>("/api/step-batch/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

export function runStepBatch(opts: Partial<StepBatchPrefs> = {}) {
  return jsonFetch<{ exit_code: number; log: string; out_dir_display: string; prefs: StepBatchPrefs }>(
    "/api/step-batch/run",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    },
  );
}

export type SwStepPrefs = {
  source_dir: string;
  out_step_dir: string;
  recursive_scan: boolean;
  com_available: boolean;
  platform: string;
};

export function fetchSwStepPrefs() {
  return jsonFetch<SwStepPrefs>("/api/sw-step-export/prefs");
}

export function saveSwStepPrefs(prefs: Partial<SwStepPrefs>) {
  return jsonFetch<SwStepPrefs>("/api/sw-step-export/prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
}

export function previewSwStepExport(opts: Partial<SwStepPrefs> = {}) {
  return jsonFetch<{ source_display: string; model_count: number; prefs: SwStepPrefs }>(
    "/api/sw-step-export/preview",
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
  }>("/api/sw-step-export/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}
