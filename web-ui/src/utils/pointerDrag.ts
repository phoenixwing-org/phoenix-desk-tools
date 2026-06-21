/** 侧栏/表格拖拽调节：pointer capture + Esc 取消，避免 mouseup 丢失后卡死 */
export function bindPointerDrag(
  e: PointerEvent,
  opts: {
    cursor?: string;
    onMove: (ev: PointerEvent) => void;
    onEnd: () => void;
  },
): void {
  if (e.button !== 0) return;
  const target = e.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  e.preventDefault();

  const cursor = opts.cursor ?? "col-resize";
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";

  try {
    target.setPointerCapture(e.pointerId);
  } catch {
    /* 部分环境不支持 */
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try {
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
    target.removeEventListener("pointermove", onPointerMove);
    target.removeEventListener("pointerup", finish);
    target.removeEventListener("pointercancel", finish);
    window.removeEventListener("blur", finish);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("mouseup", finish, true);
    opts.onEnd();
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    ev.preventDefault();
    opts.onMove(ev);
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") finish();
  };

  target.addEventListener("pointermove", onPointerMove);
  target.addEventListener("pointerup", finish);
  target.addEventListener("pointercancel", finish);
  window.addEventListener("blur", finish);
  document.addEventListener("keydown", onKeyDown, true);
  // 兜底：capture 失效时仍能收到 document mouseup
  document.addEventListener("mouseup", finish, true);
}
