import { describe, expect, it } from "vitest";
import { shellPanelToggleTip } from "./shellPanelToggles";

describe("shellPanelToggleTip", () => {
  it("uses a contributed page Block label in its action copy", () => {
    expect(shellPanelToggleTip("pageBlock", {
      open: true,
      name: "CAA Block",
    })).toBe("CAA Block — 隐藏页面 Block");
  });

  it("keeps the generic label as a fallback", () => {
    expect(shellPanelToggleTip("pageBlock", { open: false, name: "  " }))
      .toBe("页面 Block — 显示页面 Block");
  });
});
