/** 防抖触发（属性 onChange → 写 workspace prefs 等） */
export function scheduleDebounced(fn: () => void, ms = 400): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  };
}
