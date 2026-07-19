export const FCSTD_MAP_SESSION_VERSION = 4;
export const FCSTD_MAP_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const FCSTD_MAP_KIND_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "fcstd", label: "FCStd" },
  { value: "markdown", label: "MD" },
  { value: "pdf", label: "PDF" },
  { value: "cad_exchange", label: "DXF/DWG" },
  { value: "image", label: "图片" },
] as const;

export type FcstdMapPageSize = (typeof FCSTD_MAP_PAGE_SIZE_OPTIONS)[number];
export type FcstdMapKindFilter = (typeof FCSTD_MAP_KIND_OPTIONS)[number]["value"];
export type FcstdMapStatusFilter = "all" | "present" | "missing";
export type FcstdMapPageSubTab = "index" | "settings";

export interface FcstdMapEntryViewInput {
  readonly repo_rel_path: string;
  readonly filename: string;
  readonly asset_kind: string;
  readonly PartNumber: string;
  readonly PartVersion: string;
  readonly TypeCode: string;
  readonly ModelSeries: string;
  readonly PartName: string;
  readonly label: string;
  readonly file_status: "present" | "missing";
}

export interface FcstdMapPageSessionState {
  readonly subTab: FcstdMapPageSubTab;
  readonly forceUpdatePartName: boolean;
  readonly statusFilter: FcstdMapStatusFilter;
  readonly kindFilter: FcstdMapKindFilter;
  readonly searchQuery: string;
  readonly pageOffset: number;
  readonly pageSize: FcstdMapPageSize;
}

export interface FcstdMapEntryQueryState {
  readonly pageOffset: number;
  readonly pageSize: FcstdMapPageSize;
  readonly statusFilter: FcstdMapStatusFilter;
  readonly kindFilter: FcstdMapKindFilter;
  readonly searchQuery: string;
}

const ASSET_KIND_LABELS: Readonly<Record<string, string>> = {
  fcstd: "FCStd",
  markdown: "MD",
  pdf: "PDF",
  cad_exchange: "DXF/DWG",
  image: "图片",
  other: "其他",
};

export function fcstdMapAssetKindLabel(row: FcstdMapEntryViewInput): string {
  return ASSET_KIND_LABELS[row.asset_kind] ?? row.asset_kind ?? "—";
}

export function fcstdMapStatusLabel(row: FcstdMapEntryViewInput): string {
  return row.file_status === "missing" ? "缺失" : "存在";
}

export function fcstdMapPartKeyLabel(row: FcstdMapEntryViewInput): string {
  if (!row.PartNumber || !row.PartVersion) return "";
  return `${row.PartNumber}.${row.PartVersion}`;
}

export function fcstdMapCanOpenFileDetail(row: FcstdMapEntryViewInput): boolean {
  return row.file_status === "present"
    && (row.asset_kind === "fcstd" || /\.fcstd$/iu.test(row.filename));
}

export function fcstdMapMetaCell(row: FcstdMapEntryViewInput): string {
  if (row.asset_kind && row.asset_kind !== "fcstd") return "—";
  return [row.PartNumber, row.PartVersion, row.TypeCode, row.ModelSeries, row.PartName, row.label]
    .filter(Boolean)
    .join(" · ");
}

export function fcstdMapRelativeDirectory(row: FcstdMapEntryViewInput): string {
  const path = row.repo_rel_path.replace(/\\/gu, "/").replace(/^\.\//u, "");
  const separator = path.lastIndexOf("/");
  if (separator < 0) return ".";
  return path.slice(0, separator) || ".";
}

export function fcstdMapCurrentPage(offset: number, pageSize: FcstdMapPageSize): number {
  return Math.floor(offset / pageSize) + 1;
}

export function fcstdMapPageEnd(offset: number, entryCount: number, total: number): number {
  return Math.min(offset + entryCount, total);
}

export function fcstdMapOffsetForPage(page: number, pageSize: FcstdMapPageSize): number {
  return (page - 1) * pageSize;
}

export function fcstdMapIsPageSize(value: unknown): value is FcstdMapPageSize {
  return typeof value === "number" && FCSTD_MAP_PAGE_SIZE_OPTIONS.includes(value as FcstdMapPageSize);
}

export function fcstdMapIsKindFilter(value: unknown): value is FcstdMapKindFilter {
  return FCSTD_MAP_KIND_OPTIONS.some((option) => option.value === value);
}

export function deriveFcstdMapEntryQuery(state: FcstdMapEntryQueryState) {
  return {
    offset: state.pageOffset,
    limit: state.pageSize,
    status: state.statusFilter,
    kind: state.kindFilter,
    search: state.searchQuery,
  };
}

export function serializeFcstdMapPageSession(state: FcstdMapPageSessionState) {
  return { v: FCSTD_MAP_SESSION_VERSION, ...state };
}

export function hydrateFcstdMapPageSession(
  snapshot: Readonly<Record<string, unknown>>,
  current: FcstdMapPageSessionState,
): FcstdMapPageSessionState | undefined {
  if (snapshot.v !== FCSTD_MAP_SESSION_VERSION && snapshot.v !== 3 && snapshot.v !== 2) return undefined;
  return {
    subTab: snapshot.subTab === "index" || snapshot.subTab === "settings" ? snapshot.subTab : current.subTab,
    forceUpdatePartName: typeof snapshot.forceUpdatePartName === "boolean"
      ? snapshot.forceUpdatePartName
      : current.forceUpdatePartName,
    statusFilter: snapshot.statusFilter === "all"
      || snapshot.statusFilter === "present"
      || snapshot.statusFilter === "missing"
      ? snapshot.statusFilter
      : current.statusFilter,
    kindFilter: fcstdMapIsKindFilter(snapshot.kindFilter) ? snapshot.kindFilter : current.kindFilter,
    searchQuery: snapshot.searchQuery == null ? current.searchQuery : String(snapshot.searchQuery),
    pageOffset: typeof snapshot.pageOffset === "number"
      ? Math.max(0, snapshot.pageOffset)
      : current.pageOffset,
    pageSize: fcstdMapIsPageSize(snapshot.pageSize) ? snapshot.pageSize : current.pageSize,
  };
}
