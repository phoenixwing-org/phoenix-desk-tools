export type GalleryRow = {
  rel: string; part_number: string; part_version: string; part_name: string; type_code: string;
  role: "part" | "assembly" | "drawing"; status: "ready" | "missing" | "error" | "stale";
  width: number; height: number; image_hash: string; source_stamp: string; source_hash: string;
  updated_at: string; message: string; refs: string[];
  bounding_box?: { x_mm: number; y_mm: number; z_mm: number } | null;
  dimension_message?: string;
};
export type GalleryIssue = { rel: string; message: string };
export type GalleryResult = { product: string; updated_at: string; rows: GalleryRow[]; issues: GalleryIssue[] };
export type GalleryJob = { id: string; product: string; state: "running" | "done" | "attention" | "failed"; completed: number; total: number; reused: number; current_rel: string; message: string };
