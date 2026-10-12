import { jsonFetch, type CadIndexDiagnostics } from "../../api";

export type CadIndexSearchRow = {
  repo_rel_path: string;
  filename: string;
  asset_kind: string | null;
  part_number: string | null;
  part_version: string | null;
  part_name: string | null;
  label: string | null;
};
export type CadIndexSearchResult = {
  source: "sqlite";
  query: string;
  rows: CadIndexSearchRow[];
  limit: number;
  limitReached: boolean;
  diagnostics: CadIndexDiagnostics;
};

export const fetchCadIndexSearch = (workspace: string, query: string) => jsonFetch<CadIndexSearchResult>(
  `/api/cad/index/search?workspace=${encodeURIComponent(workspace)}&q=${encodeURIComponent(query)}`,
);
