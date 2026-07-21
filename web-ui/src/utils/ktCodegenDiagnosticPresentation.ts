import {
  KT_CODEGEN_BLOCK_PRESENTATIONS,
  type KtCodegenDiagnostic,
} from "@phoenix-wing/kt-codegen";

const blockPresentationByKey = new Map<string, (typeof KT_CODEGEN_BLOCK_PRESENTATIONS)[number]>(
  KT_CODEGEN_BLOCK_PRESENTATIONS.map((presentation) => [presentation.key, presentation]),
);

export function ktCodegenDiagnosticLocation(diagnostic: KtCodegenDiagnostic): string {
  const location = diagnostic.path;
  if (!location?.file) return location?.field ?? "";
  return `${location.file}${typeof location.row === "number" ? `:${location.row + 1}` : ""}${typeof location.column === "number" ? `:${location.column + 1}` : ""}`;
}

/** 使用 Wing 结构化 marker；不得从本地化 message 反向解析控制符身份。 */
export function ktCodegenDiagnosticMarkerContext(diagnostic: KtCodegenDiagnostic): string {
  const marker = diagnostic.marker;
  if (!marker) return "";
  const presentation = blockPresentationByKey.get(marker.blockKey);
  const block = presentation?.title ?? marker.blockKey;
  const boundary = marker.boundary
    ? ` · 截断于 ${marker.boundary.kind.toUpperCase()} 行 ${marker.boundary.line}`
    : "";
  return `${block} · ${marker.kind.toUpperCase()} · ${marker.classId}${boundary}`;
}
