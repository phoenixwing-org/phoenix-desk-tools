/** 侧栏纵向堆叠布局：顶区弹性、下方块固定高度；窗口缩小时先压主区，再等比压缩固定块。 */

export const SIDEBAR_RESIZER_H = 6;
export const SIDEBAR_MAIN_MIN_H = 120;
export const SIDEBAR_LOG_MIN_H = 80;
export const SIDEBAR_PROPS_MIN_H = 100;
export const SIDEBAR_PROPS_FOOTER_MIN_H = 100;
export const SIDEBAR_PROPS_MAIN_MIN_H = 80;
/** 侧栏总高低于此值时，固定块压到各自最小高度 */
export const SIDEBAR_TIGHT_THRESHOLD_H = 280;
export const SIDEBAR_FOOTER_COLLAPSED_H = 40;

export type SidebarStackInput = {
  totalHeightPx: number;
  /** 顶区（工作空间树 / Tab）是否显示 */
  showMain: boolean;
  showPropsWrap: boolean;
  showPropsMain: boolean;
  showPropsFooter: boolean;
  propsFooterExpanded: boolean;
  showLog: boolean;
  storedPropsHeightPx: number;
  storedLogHeightPx: number;
  storedPropsFooterHeightPx: number;
};

export type SidebarStackLayout = {
  /** 顶区 flex:1；为 false 时由 props / log 独占伸缩 */
  mainFlex: boolean;
  mainMinHeightPx: number;
  /** 下方块固定高度（mainFlex 时生效） */
  propsWrapHeightPx: number;
  propsWrapFlex: boolean;
  logHeightPx: number;
  logFlex: boolean;
  propsFooterHeightPx: number;
  propsStackResizer: boolean;
  scaled: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function countOuterResizers(showMain: boolean, showProps: boolean, showLog: boolean): number {
  let n = 0;
  if (showProps && (showMain || showLog)) n += 1;
  if (showLog && (showMain || showProps)) n += 1;
  return n;
}

function scaleFixedHeights(
  parts: { stored: number; min: number }[],
  budget: number,
): number[] {
  const storedSum = parts.reduce((s, p) => s + p.stored, 0);
  const minSum = parts.reduce((s, p) => s + p.min, 0);
  if (budget >= storedSum) return parts.map((p) => p.stored);
  if (budget <= minSum) return parts.map((p) => p.min);
  const scale = budget / storedSum;
  const out = parts.map((p) => Math.max(p.min, Math.floor(p.stored * scale)));
  const used = out.reduce((s, h) => s + h, 0);
  if (used < budget) {
    const idx = out.indexOf(Math.max(...out));
    out[idx] += budget - used;
  } else if (used > budget) {
    let over = used - budget;
    const order = [...out.keys()].sort((a, b) => out[b] - out[a]);
    for (const i of order) {
      const drop = Math.min(over, out[i] - parts[i].min);
      out[i] -= drop;
      over -= drop;
      if (!over) break;
    }
  }
  return out;
}

function resolvePropsFooter(
  propsWrapH: number,
  showFooter: boolean,
  expanded: boolean,
  showPropsMain: boolean,
  storedFooterPx: number,
): { footerH: number; stackResizer: boolean } {
  if (!showFooter) return { footerH: 0, stackResizer: false };
  if (!expanded) {
    return { footerH: SIDEBAR_FOOTER_COLLAPSED_H, stackResizer: false };
  }
  const maxFooter = propsWrapH - SIDEBAR_PROPS_MAIN_MIN_H - SIDEBAR_RESIZER_H;
  if (maxFooter < SIDEBAR_PROPS_FOOTER_MIN_H) {
    return {
      footerH: clamp(maxFooter, 0, storedFooterPx),
      stackResizer: showPropsMain && maxFooter > 0,
    };
  }
  const footerH = clamp(storedFooterPx, SIDEBAR_PROPS_FOOTER_MIN_H, maxFooter);
  return { footerH, stackResizer: showPropsMain };
}

/** 根据侧栏总高与持久化块高，解析实际展示高度（无循环依赖）。 */
export function resolveSidebarStackLayout(input: SidebarStackInput): SidebarStackLayout {
  const {
    totalHeightPx: totalH,
    showMain,
    showPropsWrap,
    showPropsMain,
    showPropsFooter,
    propsFooterExpanded,
    showLog,
    storedPropsHeightPx,
    storedLogHeightPx,
    storedPropsFooterHeightPx,
  } = input;

  const empty: SidebarStackLayout = {
    mainFlex: false,
    mainMinHeightPx: 0,
    propsWrapHeightPx: 0,
    propsWrapFlex: false,
    logHeightPx: 0,
    logFlex: false,
    propsFooterHeightPx: 0,
    propsStackResizer: false,
    scaled: false,
  };

  if (totalH <= 0) return empty;

  const resizerTotal = countOuterResizers(showMain, showPropsWrap, showLog) * SIDEBAR_RESIZER_H;

  // 无顶区：下方块之一或两者独占侧栏（保持旧行为：单块 flex，双块时上 flex 下固定）
  if (!showMain) {
    if (showPropsWrap && showLog) {
      let logH = clamp(storedLogHeightPx, SIDEBAR_LOG_MIN_H, totalH - SIDEBAR_RESIZER_H - SIDEBAR_PROPS_MIN_H);
      const propsBudget = totalH - logH - SIDEBAR_RESIZER_H;
      const propsH = Math.max(SIDEBAR_PROPS_MIN_H, propsBudget);
      const footer = resolvePropsFooter(
        propsH,
        showPropsFooter,
        propsFooterExpanded,
        showPropsMain,
        storedPropsFooterHeightPx,
      );
      return {
        mainFlex: false,
        mainMinHeightPx: 0,
        propsWrapHeightPx: propsH,
        propsWrapFlex: true,
        logHeightPx: logH,
        logFlex: false,
        propsFooterHeightPx: footer.footerH,
        propsStackResizer: footer.stackResizer,
        scaled: logH !== storedLogHeightPx,
      };
    }
    if (showPropsWrap) {
      const propsH = totalH;
      const footer = resolvePropsFooter(
        propsH,
        showPropsFooter,
        propsFooterExpanded,
        showPropsMain,
        storedPropsFooterHeightPx,
      );
      return {
        ...empty,
        propsWrapHeightPx: propsH,
        propsWrapFlex: true,
        propsFooterHeightPx: footer.footerH,
        propsStackResizer: footer.stackResizer,
      };
    }
    if (showLog) {
      return { ...empty, logHeightPx: totalH, logFlex: true };
    }
    return empty;
  }

  // 顶区 + 下方固定块
  let logH = showLog ? storedLogHeightPx : 0;
  let propsH = showPropsWrap ? storedPropsHeightPx : 0;
  let scaled = false;

  const fixedStored = () => (showLog ? logH : 0) + (showPropsWrap ? propsH : 0);
  let mainSpace = totalH - resizerTotal - fixedStored();

  if (mainSpace < SIDEBAR_MAIN_MIN_H) {
    scaled = true;
    mainSpace = SIDEBAR_MAIN_MIN_H;
    const budget = Math.max(0, totalH - resizerTotal - SIDEBAR_MAIN_MIN_H);
    const parts: { stored: number; min: number }[] = [];
    if (showPropsWrap) parts.push({ stored: propsH, min: SIDEBAR_PROPS_MIN_H });
    if (showLog) parts.push({ stored: logH, min: SIDEBAR_LOG_MIN_H });

    if (totalH < SIDEBAR_TIGHT_THRESHOLD_H && budget < parts.reduce((s, p) => s + p.min, 0)) {
      let i = 0;
      if (showPropsWrap) {
        propsH = parts[i].min;
        i += 1;
      }
      if (showLog) logH = parts[i]?.min ?? SIDEBAR_LOG_MIN_H;
    } else if (parts.length) {
      const heights = scaleFixedHeights(parts, budget);
      let i = 0;
      if (showPropsWrap) {
        propsH = heights[i];
        i += 1;
      }
      if (showLog) logH = heights[i] ?? SIDEBAR_LOG_MIN_H;
    }
  }

  const propsWrapH = showPropsWrap ? propsH : 0;
  const footer = resolvePropsFooter(
    propsWrapH,
    showPropsFooter,
    propsFooterExpanded,
    showPropsMain,
    storedPropsFooterHeightPx,
  );

  if (showLog && logH !== storedLogHeightPx) scaled = true;
  if (showPropsWrap && propsH !== storedPropsHeightPx) scaled = true;

  return {
    mainFlex: true,
    mainMinHeightPx: SIDEBAR_MAIN_MIN_H,
    propsWrapHeightPx: propsWrapH,
    propsWrapFlex: false,
    logHeightPx: showLog ? logH : 0,
    logFlex: false,
    propsFooterHeightPx: footer.footerH,
    propsStackResizer: footer.stackResizer,
    scaled,
  };
}

/** 拖拽属性区上沿：仅改属性块 stored 高度上限 */
export function maxStoredPropsHeightPx(
  totalHeightPx: number,
  showMain: boolean,
  showLog: boolean,
  storedLogHeightPx: number,
): number {
  const resizers = countOuterResizers(showMain, true, showLog) * SIDEBAR_RESIZER_H;
  const mainReserve = showMain ? SIDEBAR_MAIN_MIN_H : 0;
  const logReserve = showLog ? clamp(storedLogHeightPx, SIDEBAR_LOG_MIN_H, 4096) : 0;
  return Math.max(SIDEBAR_PROPS_MIN_H, totalHeightPx - resizers - mainReserve - logReserve);
}

/** 拖拽日志区上沿：仅改日志块 stored 高度上限 */
export function maxStoredLogHeightPx(
  totalHeightPx: number,
  showMain: boolean,
  showProps: boolean,
  storedPropsHeightPx: number,
): number {
  const resizers = countOuterResizers(showMain, showProps, true) * SIDEBAR_RESIZER_H;
  const mainReserve = showMain ? SIDEBAR_MAIN_MIN_H : 0;
  const propsReserve = showProps ? clamp(storedPropsHeightPx, SIDEBAR_PROPS_MIN_H, 4096) : 0;
  return Math.max(SIDEBAR_LOG_MIN_H, totalHeightPx - resizers - mainReserve - propsReserve);
}

export function maxStoredPropsFooterHeightPx(
  propsWrapHeightPx: number,
): number {
  const maxH = propsWrapHeightPx - SIDEBAR_PROPS_MAIN_MIN_H - SIDEBAR_RESIZER_H;
  return Math.max(SIDEBAR_PROPS_FOOTER_MIN_H, maxH);
}
