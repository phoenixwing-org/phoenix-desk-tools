/** CAA 控件预览尺寸：TW/TH 为字符宽/行数，用于 Web 画布固有尺寸近似。 */

/** 对话框预览固定外框宽（px）；内部 Grid/控件按 100% 铺满。 */
export const CAA_DIALOG_PREVIEW_WIDTH_PX = 500;
export const CAA_GRID_EDIT_ROW_MIN_PX = 24;

export function caaCharWidthCh(tw: number | undefined): string | undefined {
  if (tw == null || tw <= 0) return undefined;
  return `${tw}ch`;
}

export function caaControlWidthStyle(tw: number | undefined): Record<string, string> | undefined {
  const width = caaCharWidthCh(tw);
  if (!width) return undefined;
  return { width, maxWidth: "100%" };
}

export function caaMultilistWidthStyle(
  tw: number | undefined,
  columnCount: number | undefined,
): Record<string, string> | undefined {
  const cols = columnCount ?? 0;
  if (tw == null || tw <= 0 || cols <= 0) return undefined;
  return { width: `${tw * cols}ch`, maxWidth: "100%" };
}

/** 预览模式下列/行模板：伸缩下标也按内容固有尺寸，不用 fr 撑满。 */
export function caaGridTrackTemplate(count: number): string {
  return Array.from({ length: Math.max(1, count) }, () => "auto").join(" ");
}

/** 对话框内铺满父宽时：ROWRES/COLRES 用 fr，其余 auto。 */
export function caaGridFillTrackTemplate(
  count: number,
  resizable: number[] | undefined,
): string {
  const res = resizable ?? [];
  return Array.from({ length: Math.max(1, count) }, (_, i) =>
    res.includes(i) ? "1fr" : "auto",
  ).join(" ");
}

/** 编辑模式下每行都有最小可拖拽/可观察高度，避免空行在 CSS Grid auto 轨道里塌缩。 */
export function caaGridEditRowTrackTemplate(
  count: number,
  resizable: number[] | undefined,
  fillParent: boolean,
): string {
  const res = resizable ?? [];
  return Array.from({ length: Math.max(1, count) }, (_, i) => {
    const track = fillParent && res.includes(i) ? "1fr" : "auto";
    return `minmax(${CAA_GRID_EDIT_ROW_MIN_PX}px, ${track})`;
  }).join(" ");
}
