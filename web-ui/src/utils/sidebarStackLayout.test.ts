import { describe, expect, it } from "vitest";
import {
  maxStoredLogHeightPx,
  maxStoredPropsHeightPx,
  resolveSidebarStackLayout,
  SIDEBAR_LOG_MIN_H,
  SIDEBAR_MAIN_MIN_H,
  SIDEBAR_PROPS_MIN_H,
} from "./sidebarStackLayout";

const base = {
  showMain: true,
  showPropsWrap: true,
  showPropsMain: true,
  showPropsFooter: false,
  propsFooterExpanded: true,
  showLog: true,
  storedPropsHeightPx: 220,
  storedLogHeightPx: 180,
  storedPropsFooterHeightPx: 120,
};

describe("resolveSidebarStackLayout", () => {
  it("keeps stored fixed heights when main has room", () => {
    const layout = resolveSidebarStackLayout({
      ...base,
      totalHeightPx: 800,
    });
    expect(layout.mainFlex).toBe(true);
    expect(layout.propsWrapHeightPx).toBe(220);
    expect(layout.logHeightPx).toBe(180);
    expect(layout.scaled).toBe(false);
  });

  it("shrinks fixed blocks when main would go below minimum", () => {
    const layout = resolveSidebarStackLayout({
      ...base,
      totalHeightPx: 500,
    });
    expect(layout.mainMinHeightPx).toBe(SIDEBAR_MAIN_MIN_H);
    expect(layout.propsWrapHeightPx).toBeLessThan(220);
    expect(layout.logHeightPx).toBeLessThan(180);
    expect(layout.scaled).toBe(true);
    const used =
      layout.propsWrapHeightPx +
      layout.logHeightPx +
      SIDEBAR_MAIN_MIN_H +
      6 * 2;
    expect(used).toBeLessThanOrEqual(500);
  });

  it("reserves a minimum for every coexisting main Block", () => {
    const layout = resolveSidebarStackLayout({
      ...base,
      totalHeightPx: 600,
      mainBlockCount: 2,
    });
    expect(layout.propsWrapHeightPx).toBeLessThan(220);
    expect(layout.logHeightPx).toBeLessThan(180);
    expect(layout.scaled).toBe(true);
    const used = layout.propsWrapHeightPx
      + layout.logHeightPx
      + SIDEBAR_MAIN_MIN_H * 2
      + 6 * 2;
    expect(used).toBeLessThanOrEqual(600);
  });

  it("clamps fixed blocks to mins on very tight sidebar", () => {
    const layout = resolveSidebarStackLayout({
      ...base,
      totalHeightPx: 260,
    });
    expect(layout.propsWrapHeightPx).toBe(SIDEBAR_PROPS_MIN_H);
    expect(layout.logHeightPx).toBe(SIDEBAR_LOG_MIN_H);
    expect(layout.mainMinHeightPx).toBe(68);
    expect(layout.scaled).toBe(true);
    expect(layout.propsWrapHeightPx + layout.logHeightPx + layout.mainMinHeightPx + 6 * 2)
      .toBeLessThanOrEqual(260);
  });

  it("shares the remaining height between multiple main Blocks in a tight sidebar", () => {
    const layout = resolveSidebarStackLayout({
      ...base,
      totalHeightPx: 260,
      mainBlockCount: 2,
    });
    expect(layout.mainMinHeightPx).toBe(34);
    expect(layout.propsWrapHeightPx + layout.logHeightPx + layout.mainMinHeightPx * 2 + 6 * 2)
      .toBeLessThanOrEqual(260);
  });

  it("does not overflow when fixed panels alone exceed an ultra-tight sidebar", () => {
    const layout = resolveSidebarStackLayout({
      ...base,
      totalHeightPx: 100,
      mainBlockCount: 2,
    });
    expect(layout.propsWrapHeightPx).toBeGreaterThanOrEqual(0);
    expect(layout.logHeightPx).toBeGreaterThanOrEqual(0);
    expect(layout.mainMinHeightPx).toBe(0);
    expect(layout.propsWrapHeightPx + layout.logHeightPx + 6 * 2).toBe(100);
  });

  it("never returns negative heights without a main Block", () => {
    const layout = resolveSidebarStackLayout({
      ...base,
      totalHeightPx: 100,
      showMain: false,
    });
    expect(layout.propsWrapHeightPx).toBeGreaterThanOrEqual(0);
    expect(layout.logHeightPx).toBeGreaterThanOrEqual(0);
    expect(layout.propsWrapHeightPx + layout.logHeightPx + 6).toBe(100);
  });

  it("keeps every reported height non-negative and within the available stack", () => {
    for (let totalHeightPx = 12; totalHeightPx <= 720; totalHeightPx += 7) {
      for (const showMain of [false, true]) {
        for (const showPropsWrap of [false, true]) {
          for (const showLog of [false, true]) {
            for (const mainBlockCount of showMain ? [1, 2, 3] : [0]) {
              const layout = resolveSidebarStackLayout({
                ...base,
                totalHeightPx,
                showMain,
                mainBlockCount,
                showPropsWrap,
                showLog,
              });
              const heights = [
                layout.mainMinHeightPx,
                layout.propsWrapHeightPx,
                layout.logHeightPx,
                layout.propsFooterHeightPx,
              ];
              expect(heights.every((height) => Number.isFinite(height) && height >= 0)).toBe(true);
              const visibleCount = Number(showMain) + Number(showPropsWrap) + Number(showLog);
              const resizers = Math.max(0, visibleCount - 1) * 6;
              const used = layout.mainMinHeightPx * mainBlockCount
                + layout.propsWrapHeightPx
                + layout.logHeightPx
                + resizers;
              expect(used).toBeLessThanOrEqual(totalHeightPx);
            }
          }
        }
      }
    }
  });
});

describe("maxStored*HeightPx", () => {
  it("props drag max reserves main min and log stored", () => {
    const max = maxStoredPropsHeightPx(600, true, true, 180);
    expect(max).toBe(600 - SIDEBAR_MAIN_MIN_H - 180 - 12);
  });

  it("log drag max reserves main min and props stored", () => {
    const max = maxStoredLogHeightPx(600, true, true, 220);
    expect(max).toBe(600 - SIDEBAR_MAIN_MIN_H - 220 - 12);
  });

  it("drag maxima reserve every visible main Block", () => {
    expect(maxStoredPropsHeightPx(720, true, true, 180, 2))
      .toBe(720 - SIDEBAR_MAIN_MIN_H * 2 - 180 - 12);
    expect(maxStoredLogHeightPx(720, true, true, 220, 2))
      .toBe(720 - SIDEBAR_MAIN_MIN_H * 2 - 220 - 12);
  });
});
