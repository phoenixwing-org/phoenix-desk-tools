import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { fetchDrawingLineWidths, saveDrawingLineWidths } from "./api";
import { DEFAULT_DRAWING_LINE_WIDTHS, drawingLineWidthError, parseDrawingLineWidths } from "./lineWidthSettings";
import type { DrawingLineWidths } from "./types";

type Host = { invalidatePreviews(): void; reportError?(message: string): void };
/** Workspace settings only. Mount/hydration never reads or writes by itself. */
export function useDrawingLineWidths(workspace: Ref<string>, active: Readonly<Ref<boolean>>, blocked: Readonly<Ref<boolean>>, host: Host) {
  const contour = ref<number | undefined>(DEFAULT_DRAWING_LINE_WIDTHS.contour_line_width_mm);
  const dimension = ref<number | undefined>(DEFAULT_DRAWING_LINE_WIDTHS.dimension_line_width_mm);
  const saved = shallowRef<DrawingLineWidths | null>(null);
  const pending = ref<"load" | "save" | null>(null), error = ref(""), notice = ref("");
  let epoch = 0, editRevision = 0, disposed = false, request: AbortController | undefined;
  const input = () => ({ contour_line_width_mm: contour.value, dimension_line_width_mm: dimension.value });
  const validation = computed(() => drawingLineWidthError(input()));
  const dirty = computed(() => !saved.value || contour.value !== saved.value.contour_line_width_mm || dimension.value !== saved.value.dimension_line_width_mm);
  const canLoad = computed(() => !disposed && active.value && !!workspace.value && !blocked.value && !pending.value);
  const canSave = computed(() => canLoad.value && !validation.value && dirty.value);
  const current = (token: number, root: string) => !disposed && token === epoch && root === workspace.value && active.value;
  const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).slice(0, 800);
  function stop() {
    if (pending.value === "save") { error.value = "线宽保存结果未确认：请求已中断，不能据此判断未写入；返回后请读取配置核对。"; notice.value = ""; }
    epoch++; request?.abort(); request = undefined; pending.value = null;
  }
  function reset() { stop(); saved.value = null; contour.value = DEFAULT_DRAWING_LINE_WIDTHS.contour_line_width_mm; dimension.value = DEFAULT_DRAWING_LINE_WIDTHS.dimension_line_width_mm; error.value = ""; notice.value = ""; }
  watch([contour, dimension], () => { editRevision++; error.value = ""; notice.value = ""; }, { flush: "sync" });
  watch(workspace, reset, { flush: "sync" });
  watch(active, value => { if (!value) stop(); }, { flush: "sync" });
  onScopeDispose(() => { disposed = true; stop(); });

  async function load() {
    if (!canLoad.value) return;
    const root = workspace.value, token = epoch, revision = editRevision, controller = request = new AbortController();
    pending.value = "load"; error.value = ""; notice.value = "";
    try {
      const value = await fetchDrawingLineWidths(root, controller.signal);
      if (!current(token, root)) return;
      saved.value = value;
      if (revision === editRevision) { contour.value = value.contour_line_width_mm; dimension.value = value.dimension_line_width_mm; }
      notice.value = dirty.value ? "已读取保存值，保留读取期间的新输入；编辑值尚未保存。" : "已读取当前工作空间有效线宽；未修改 CAD。";
    } catch (cause) {
      if (!current(token, root)) return;
      error.value = `读取线宽失败：${message(cause)}`; host.reportError?.(error.value);
    } finally { if (current(token, root)) { pending.value = null; request = undefined; } }
  }
  async function save() {
    if (!canSave.value) return;
    const value = parseDrawingLineWidths(input()), root = workspace.value, token = epoch, controller = request = new AbortController();
    pending.value = "save"; error.value = ""; notice.value = "";
    try {
      const result = await saveDrawingLineWidths(root, value, controller.signal);
      if (!current(token, root)) return;
      saved.value = result; host.invalidatePreviews();
      notice.value = dirty.value ? "已保存提交时的线宽；当前输入另有未保存修改，请保存后重新预览。" : "当前工作空间线宽已保存；旧预览已清空，请重新预览。未修改 CAD。";
    } catch (cause) {
      if (!current(token, root)) return;
      host.invalidatePreviews();
      error.value = `线宽保存结果未确认：${message(cause)}；请读取配置核对，不要假定未写入。`; host.reportError?.(error.value);
    } finally { if (current(token, root)) { pending.value = null; request = undefined; } }
  }
  return { contour, dimension, saved, pending, error, notice, validation, dirty, canLoad, canSave, load, save };
}
