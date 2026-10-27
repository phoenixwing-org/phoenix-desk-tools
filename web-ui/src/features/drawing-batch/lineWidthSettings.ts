import type { DrawingLineWidths } from "./types";

export const DEFAULT_DRAWING_LINE_WIDTHS: Readonly<DrawingLineWidths> = Object.freeze({ contour_line_width_mm: 0.5, dimension_line_width_mm: 0.25 });

/** Data-only settings contract, shared by the API boundary and editor. */
export function drawingLineWidthError(value: unknown): string {
  const input = value as Partial<DrawingLineWidths> | null;
  for (const key of ["contour_line_width_mm", "dimension_line_width_mm"] as const) {
    const width = input?.[key];
    if (typeof width !== "number" || !Number.isFinite(width) || width <= 0 || width > 5) return "线宽须为大于 0 且不超过 5 mm 的有限数字。";
  }
  return input!.contour_line_width_mm! > input!.dimension_line_width_mm! ? "" : "轮廓线宽必须大于尺寸及界线线宽。";
}

export function parseDrawingLineWidths(value: unknown): DrawingLineWidths {
  const error = drawingLineWidthError(value);
  if (error) throw new Error(error);
  const input = value as DrawingLineWidths;
  return { contour_line_width_mm: input.contour_line_width_mm, dimension_line_width_mm: input.dimension_line_width_mm };
}
