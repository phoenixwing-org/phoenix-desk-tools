import { computed, onUnmounted, ref, watch } from "vue";

export type TableColumnDef = {
  key: string;
  label: string;
  width?: number;
  minWidth?: number;
  headerClass?: string;
};

export function useResizableTable(columns: () => TableColumnDef[]) {
  const widths = ref<Record<string, number>>({});

  function syncDefaults() {
    const defs = columns();
    const next = { ...widths.value };
    for (const col of defs) {
      if (next[col.key] == null) {
        next[col.key] = col.width ?? 120;
      }
    }
    widths.value = next;
  }

  watch(columns, syncDefaults, { immediate: true, deep: true });

  const totalWidth = computed(() =>
    Object.values(widths.value).reduce((sum, w) => sum + w, 0),
  );

  let active: { key: string; startX: number; startW: number; minW: number } | null = null;

  function onMove(e: MouseEvent) {
    if (!active) return;
    const delta = e.clientX - active.startX;
    widths.value = {
      ...widths.value,
      [active.key]: Math.max(active.minW, active.startW + delta),
    };
  }

  function onUp() {
    active = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  function onResizeStart(key: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const col = columns().find((c) => c.key === key);
    active = {
      key,
      startX: e.clientX,
      startW: widths.value[key] ?? col?.width ?? 120,
      minW: col?.minWidth ?? 48,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  onUnmounted(onUp);

  return { widths, totalWidth, onResizeStart };
}
