import {
  PNW_DEFAULT_WORKBENCH_DISPLAY_PREFERENCES,
  pnwNormalizeWorkbenchDisplayPreferences,
  type PnwColorScheme,
  type PnwWorkbenchLayoutState,
  type PnwWorkbenchDisplayPreferences,
} from "phoenix-wing";

export const PDT_WORKBENCH_DISPLAY_PREFERENCES_KEY =
  "phoenix-desk-tools.workbench.display-preferences.v1";

export interface PdtWorkbenchDisplayPreferencesV1 {
  readonly version: 1;
  readonly display: PnwWorkbenchDisplayPreferences;
}

interface PdtWorkbenchPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function pdtDefaultWorkbenchDisplayPreferences(
  colorScheme: PnwColorScheme = "light",
): PnwWorkbenchDisplayPreferences {
  return pnwNormalizeWorkbenchDisplayPreferences({
    ...PNW_DEFAULT_WORKBENCH_DISPLAY_PREFERENCES,
    colorScheme,
    layoutState: {
      visibility: { primary: true, bottom: true, secondary: true },
      sizes: {
        primaryWidth: 300,
        secondaryWidth: 300,
        bottomHeight: 190,
      },
    },
  });
}

function pdtBrowserStorage(): PdtWorkbenchPreferenceStorage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function pdtRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Desk 是工作台的 consumer：Wing 只提供纯数据归一化，保存位置由 Desk 选择。
 * 损坏、过期或半写入的快照都会回落到该 consumer 的显示默认值。
 */
export function pdtReadWorkbenchDisplayPreferences(
  fallback = pdtDefaultWorkbenchDisplayPreferences(),
  storage: PdtWorkbenchPreferenceStorage | undefined = pdtBrowserStorage(),
): PnwWorkbenchDisplayPreferences {
  if (!storage) return fallback;
  try {
    const record = pdtRecord(JSON.parse(
      storage.getItem(PDT_WORKBENCH_DISPLAY_PREFERENCES_KEY) ?? "null",
    ));
    return pnwNormalizeWorkbenchDisplayPreferences(
      record.version === 1 ? record.display : undefined,
      fallback,
    );
  } catch {
    return fallback;
  }
}

export function pdtWriteWorkbenchDisplayPreferences(
  display: PnwWorkbenchDisplayPreferences,
  fallback = pdtDefaultWorkbenchDisplayPreferences(),
  storage: PdtWorkbenchPreferenceStorage | undefined = pdtBrowserStorage(),
): void {
  if (!storage) return;
  try {
    const envelope = {
      version: 1,
      display: pnwNormalizeWorkbenchDisplayPreferences(display, fallback),
    } satisfies PdtWorkbenchDisplayPreferencesV1;
    storage.setItem(PDT_WORKBENCH_DISPLAY_PREFERENCES_KEY, JSON.stringify(envelope));
  } catch {
    // localStorage 可能不可用；当前 Pinia 内存状态仍可继续工作。
  }
}

export function pdtClearWorkbenchDisplayPreferences(
  storage: PdtWorkbenchPreferenceStorage | undefined = pdtBrowserStorage(),
): void {
  try {
    storage?.removeItem?.(PDT_WORKBENCH_DISPLAY_PREFERENCES_KEY);
  } catch {
    // 忽略受限存储环境。
  }
}

/** Wing 的 resize / footer toggle 只交回完整新状态，Desk 负责归一化与保存。 */
export function pdtWithWorkbenchLayoutState(
  display: PnwWorkbenchDisplayPreferences,
  layoutState: PnwWorkbenchLayoutState,
): PnwWorkbenchDisplayPreferences {
  return pnwNormalizeWorkbenchDisplayPreferences({
    ...display,
    layoutState,
  }, display);
}

/** Explicit error/output reveal overrides a hidden Bottom without resetting other blocks. */
export function pdtRevealWorkbenchBottom(
  display: PnwWorkbenchDisplayPreferences,
): PnwWorkbenchDisplayPreferences {
  if (display.layoutState.visibility.bottom) return display;
  return pdtWithWorkbenchLayoutState(display, {
    ...display.layoutState,
    visibility: { ...display.layoutState.visibility, bottom: true },
  });
}
