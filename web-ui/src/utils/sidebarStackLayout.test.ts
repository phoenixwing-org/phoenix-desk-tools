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

  it("clamps fixed blocks to mins on very tight sidebar", () => {
    const layout = resolveSidebarStackLayout({
      ...base,
      totalHeightPx: 260,
    });
    expect(layout.propsWrapHeightPx).toBe(SIDEBAR_PROPS_MIN_H);
    expect(layout.logHeightPx).toBe(SIDEBAR_LOG_MIN_H);
    expect(layout.scaled).toBe(true);
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
});
