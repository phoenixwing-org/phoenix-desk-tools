import { defineStore } from "pinia";
import {
  applyExpandIconCssVars,
  clampExpandIconSize,
  EXPAND_ICON_SIZE_DEFAULT,
} from "../utils/expandIconTheme";
import {
  pnwApplyColorScheme,
  pnwNormalizeWorkbenchDisplayPreferences,
  type PnwColorScheme,
  type PnwWorkbenchDisplayPreferences,
} from "phoenix-wing";
import {
  pdtClearWorkbenchDisplayPreferences,
  pdtDefaultWorkbenchDisplayPreferences,
  pdtReadWorkbenchDisplayPreferences,
  pdtWriteWorkbenchDisplayPreferences,
} from "../workbench/PdtWorkbenchDisplayPreferences";

const STORAGE_KEY = "phoenix-ui-prefs-v1";

export type RibbonLayoutMode = "grouped" | "inline";

type UiPrefsPersisted = {
  expandControlSizePx?: number;
  ribbonLayoutMode?: RibbonLayoutMode;
  colorScheme?: PnwColorScheme;
};

export const useUiPrefsStore = defineStore("uiPrefs", {
  state: () => ({
    expandControlSizePx: EXPAND_ICON_SIZE_DEFAULT,
    ribbonLayoutMode: "grouped" as RibbonLayoutMode,
    colorScheme: "light" as PnwColorScheme,
    workbenchDisplayPreferences: pdtDefaultWorkbenchDisplayPreferences("light"),
    hydrated: false,
  }),
  actions: {
    hydrate() {
      if (this.hydrated) return;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const data = JSON.parse(raw) as UiPrefsPersisted;
          if (typeof data.expandControlSizePx === "number") {
            this.expandControlSizePx = clampExpandIconSize(data.expandControlSizePx);
          }
          if (data.ribbonLayoutMode === "grouped" || data.ribbonLayoutMode === "inline") {
            this.ribbonLayoutMode = data.ribbonLayoutMode;
          }
          if (
            data.colorScheme === "light" ||
            data.colorScheme === "dark" ||
            data.colorScheme === "system"
          ) {
            this.colorScheme = data.colorScheme;
          }
        }
      } catch {
        /* ignore corrupt storage */
      }
      this.workbenchDisplayPreferences = pdtReadWorkbenchDisplayPreferences(
        pdtDefaultWorkbenchDisplayPreferences(this.colorScheme),
      );
      this.colorScheme = this.workbenchDisplayPreferences.colorScheme;
      applyExpandIconCssVars(this.expandControlSizePx);
      pnwApplyColorScheme(this.colorScheme);
      this.hydrated = true;
    },
    persist() {
      const payload: UiPrefsPersisted = {
        expandControlSizePx: this.expandControlSizePx,
        ribbonLayoutMode: this.ribbonLayoutMode,
        colorScheme: this.colorScheme,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    },
    setExpandControlSizePx(px: number) {
      this.expandControlSizePx = clampExpandIconSize(px);
      applyExpandIconCssVars(this.expandControlSizePx);
      this.persist();
    },
    setRibbonLayoutMode(mode: RibbonLayoutMode) {
      this.ribbonLayoutMode = mode;
      this.persist();
    },
    toggleRibbonLayoutMode() {
      this.setRibbonLayoutMode(this.ribbonLayoutMode === "grouped" ? "inline" : "grouped");
    },
    setColorScheme(scheme: PnwColorScheme) {
      this.colorScheme = scheme;
      this.workbenchDisplayPreferences = pnwNormalizeWorkbenchDisplayPreferences({
        ...this.workbenchDisplayPreferences,
        colorScheme: scheme,
      }, pdtDefaultWorkbenchDisplayPreferences(scheme));
      pdtWriteWorkbenchDisplayPreferences(
        this.workbenchDisplayPreferences,
        pdtDefaultWorkbenchDisplayPreferences(scheme),
      );
      pnwApplyColorScheme(scheme);
      this.persist();
    },
    setWorkbenchDisplayPreferences(value: PnwWorkbenchDisplayPreferences) {
      const fallback = pdtDefaultWorkbenchDisplayPreferences(this.colorScheme);
      this.workbenchDisplayPreferences = pnwNormalizeWorkbenchDisplayPreferences(value, fallback);
      this.colorScheme = this.workbenchDisplayPreferences.colorScheme;
      pnwApplyColorScheme(this.colorScheme);
      pdtWriteWorkbenchDisplayPreferences(this.workbenchDisplayPreferences, fallback);
      this.persist();
    },
    resetToDefaults() {
      this.expandControlSizePx = EXPAND_ICON_SIZE_DEFAULT;
      this.ribbonLayoutMode = "grouped";
      this.colorScheme = "light";
      this.workbenchDisplayPreferences = pdtDefaultWorkbenchDisplayPreferences("light");
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      pdtClearWorkbenchDisplayPreferences();
      applyExpandIconCssVars(this.expandControlSizePx);
      pnwApplyColorScheme(this.colorScheme);
    },
  },
});
