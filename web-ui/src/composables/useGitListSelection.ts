import { onUnmounted, ref, watch, type Ref } from "vue";

export const GIT_LIST_SELECTION_KEY = Symbol("gitListSelection");

export type GitListSelectionContext = {
  isSelected: (path: string) => boolean;
  onRowClick: (e: MouseEvent, path: string) => void;
  resolveActionPaths: (path: string) => string[];
};

const DRAG_THRESHOLD_PX = 4;

type RowRect = { path: string; top: number; bottom: number };

function rectsIntersect(
  a: { top: number; bottom: number; left: number; right: number },
  b: { top: number; bottom: number },
) {
  return a.top < b.bottom && a.bottom > b.top;
}

export function useGitListSelection(rowPaths: Ref<string[]>) {
  const selectedPaths = ref<Set<string>>(new Set());
  const anchorPath = ref<string | null>(null);
  const marquee = ref<{ left: number; top: number; width: number; height: number } | null>(null);

  let dragStart: { x: number; y: number; containerTop: number; rowRects: RowRect[] } | null = null;
  let suppressNextClick = false;

  function syncSelectionWithRows() {
    const allowed = new Set(rowPaths.value);
    const next = new Set([...selectedPaths.value].filter((p) => allowed.has(p)));
    if (next.size !== selectedPaths.value.size) selectedPaths.value = next;
    if (anchorPath.value && !allowed.has(anchorPath.value)) anchorPath.value = null;
  }

  watch(rowPaths, syncSelectionWithRows, { immediate: true });

  function isSelected(path: string) {
    return selectedPaths.value.has(path);
  }

  function selectOnly(path: string) {
    selectedPaths.value = new Set([path]);
    anchorPath.value = path;
  }

  function togglePath(path: string) {
    const next = new Set(selectedPaths.value);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    selectedPaths.value = next;
    anchorPath.value = path;
  }

  function selectRange(fromPath: string, toPath: string) {
    const paths = rowPaths.value;
    const i = paths.indexOf(fromPath);
    const j = paths.indexOf(toPath);
    if (i < 0 || j < 0) {
      selectOnly(toPath);
      return;
    }
    const [start, end] = i <= j ? [i, j] : [j, i];
    selectedPaths.value = new Set(paths.slice(start, end + 1));
    anchorPath.value = toPath;
  }

  function onRowClick(e: MouseEvent, path: string) {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      togglePath(path);
      return;
    }
    if (e.shiftKey && anchorPath.value) {
      selectRange(anchorPath.value, path);
      return;
    }
    selectOnly(path);
  }

  function clearSelection() {
    selectedPaths.value = new Set();
    anchorPath.value = null;
  }

  function resolveActionPaths(path: string): string[] {
    if (selectedPaths.value.size > 1 && selectedPaths.value.has(path)) {
      return [...selectedPaths.value];
    }
    return [path];
  }

  function collectRowRects(container: HTMLElement): RowRect[] {
    return [...container.querySelectorAll<HTMLElement>(".git-file-row[data-path]")].map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        path: el.dataset.path ?? "",
        top: rect.top,
        bottom: rect.bottom,
      };
    }).filter((r) => r.path);
  }

  function finishDrag(e: PointerEvent) {
    if (!dragStart) return;
    const { x: x0, y: y0, rowRects } = dragStart;
    dragStart = null;
    marquee.value = null;
    document.body.style.removeProperty("user-select");

    if (Math.hypot(e.clientX - x0, e.clientY - y0) < DRAG_THRESHOLD_PX) {
      return;
    }
    suppressNextClick = true;

    const top = Math.min(y0, e.clientY);
    const bottom = Math.max(y0, e.clientY);
    const band = { top, bottom, left: 0, right: 99999 };
    const hits = rowRects.filter((r) => rectsIntersect(band, r)).map((r) => r.path);
    selectedPaths.value = new Set(hits);
    anchorPath.value = hits.at(-1) ?? null;
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragStart) return;
    const { x: x0, y: y0, containerTop } = dragStart;
    const left = Math.min(x0, e.clientX);
    const top = Math.min(y0, e.clientY) - containerTop;
    marquee.value = {
      left,
      top,
      width: Math.abs(e.clientX - x0),
      height: Math.abs(e.clientY - y0),
    };
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragStart) return;
    finishDrag(e);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  function onListPointerDown(e: PointerEvent, container: HTMLElement) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest(".git-row-actions, .git-icon-btn, button, a")) return;

    dragStart = {
      x: e.clientX,
      y: e.clientY,
      containerTop: container.getBoundingClientRect().top,
      rowRects: collectRowRects(container),
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  onUnmounted(() => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    document.body.style.removeProperty("user-select");
  });

  return {
    selectedPaths,
    selectedCount: () => selectedPaths.value.size,
    marquee,
    isSelected,
    onRowClick,
    onListPointerDown,
    resolveActionPaths,
    clearSelection,
  };
}
