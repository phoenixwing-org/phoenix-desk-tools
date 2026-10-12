import { describe, expect, it } from "vitest";
import {
  PDT_WORKBENCH_DISPLAY_PREFERENCES_KEY,
  pdtDefaultWorkbenchDisplayPreferences,
  pdtReadWorkbenchDisplayPreferences,
  pdtWithWorkbenchLayoutState,
  pdtWriteWorkbenchDisplayPreferences,
  pdtRevealWorkbenchBottom,
} from "./PdtWorkbenchDisplayPreferences";

function pdtMemoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

describe("PdtWorkbenchDisplayPreferences", () => {
  it("explicit output reveal opens only the hidden Bottom, preserving sizes and preferences", () => {
    const initial = pdtDefaultWorkbenchDisplayPreferences("dark");
    const hidden = pdtWithWorkbenchLayoutState(initial, {
      visibility: { primary: false, bottom: false, secondary: false },
      sizes: { primaryWidth: 340, secondaryWidth: 350, bottomHeight: 210 },
    });
    const before = JSON.stringify(hidden);
    const revealed = pdtRevealWorkbenchBottom(hidden);
    expect(revealed).toEqual({ ...hidden, layoutState: {
      ...hidden.layoutState,
      visibility: { primary: false, bottom: true, secondary: false },
    } });
    expect(JSON.stringify(hidden)).toBe(before);
    expect(pdtRevealWorkbenchBottom(revealed)).toBe(revealed);
  });
  it("用 Desk 默认值归一化损坏或不完整的 envelope", () => {
    const storage = pdtMemoryStorage({
      [PDT_WORKBENCH_DISPLAY_PREFERENCES_KEY]: JSON.stringify({
        version: 1,
        display: {
          presentation: "tree",
          ribbonAppearance: { mode: "compact", compact: { iconSize: 99 } },
          layoutState: { sizes: { primaryWidth: -1 } },
        },
      }),
    });

    const value = pdtReadWorkbenchDisplayPreferences(
      pdtDefaultWorkbenchDisplayPreferences("dark"),
      storage,
    );
    expect(value.presentation).toBe("tree");
    expect(value.colorScheme).toBe("dark");
    expect(value.ribbonAppearance.compact.iconSize).toBe(24);
    expect(value.layoutState.visibility).toEqual({ primary: true, bottom: true, secondary: true });
    expect(value.layoutState.sizes.primaryWidth).toBe(160);
  });

  it("写入版本化完整快照，而非依赖旧 UI 偏好字段", () => {
    const storage = pdtMemoryStorage();
    const display = pdtDefaultWorkbenchDisplayPreferences("light");
    pdtWriteWorkbenchDisplayPreferences(display, display, storage);

    const stored = JSON.parse(storage.getItem(PDT_WORKBENCH_DISPLAY_PREFERENCES_KEY) ?? "{}") as unknown;
    expect(stored).toMatchObject({ version: 1, display: { presentation: "ribbon" } });
  });

  it("接受 Wing 返还的完整 layout-state，保留其他显示偏好", () => {
    const initial = pdtDefaultWorkbenchDisplayPreferences();
    const updated = pdtWithWorkbenchLayoutState(
      initial,
      {
        visibility: { primary: false, bottom: true, secondary: true },
        sizes: { primaryWidth: 340, secondaryWidth: 300, bottomHeight: 210 },
      },
    );
    expect(updated.layoutState.visibility.primary).toBe(false);
    expect(updated.layoutState.sizes.primaryWidth).toBe(340);
    expect(updated.presentation).toBe(initial.presentation);
  });
});
