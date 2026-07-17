import { describe, expect, it } from "vitest";
import { resolveWorkbenchBottomPanelHeight } from "./workbenchBottomPanelLayout";

const bounds = {
  hostHeight: 720,
  minPanelHeight: 112,
  minPrimaryHeight: 260,
  layoutGap: 0,
  maxViewportHeight: 520,
};

describe("resolveWorkbenchBottomPanelHeight", () => {
  it("keeps the requested height inside the panel and primary-view bounds", () => {
    expect(resolveWorkbenchBottomPanelHeight(240, bounds)).toBe(240);
    expect(resolveWorkbenchBottomPanelHeight(40, bounds)).toBe(112);
    expect(resolveWorkbenchBottomPanelHeight(900, bounds)).toBe(460);
  });

  it("lets the panel shrink below its preferred minimum in a short host", () => {
    expect(resolveWorkbenchBottomPanelHeight(180, {
      ...bounds,
      hostHeight: 330,
    })).toBe(70);
  });

  it("normalizes non-finite values to the effective minimum", () => {
    expect(resolveWorkbenchBottomPanelHeight(Number.NaN, bounds)).toBe(112);
  });
});
