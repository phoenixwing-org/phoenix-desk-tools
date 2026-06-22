import { defineStore } from "pinia";
import {
  applyExpandIconCssVars,
  clampExpandIconSize,
  EXPAND_ICON_SIZE_DEFAULT,
} from "../utils/expandIconTheme";
import { applyColorScheme, type ColorScheme } from "../utils/colorScheme";

const STORAGE_KEY = "phoenix-ui-prefs-v1";

export type RibbonLayoutMode = "grouped" | "inline";

type UiPrefsPersisted = {
  expandControlSizePx?: number;
  ribbonLayoutMode?: RibbonLayoutMode;
  colorScheme?: ColorScheme;
};

export const useUiPrefsStore = defineStore("uiPrefs", {
  state: () => ({
    expandControlSizePx: EXPAND_ICON_SIZE_DEFAULT,
    ribbonLayoutMode: "grouped" as RibbonLayoutMode,
    colorScheme: "light" as ColorScheme,
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
      applyExpandIconCssVars(this.expandControlSizePx);
      applyColorScheme(this.colorScheme);
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
    setColorScheme(scheme: ColorScheme) {
      this.colorScheme = scheme;
      applyColorScheme(scheme);
      this.persist();
    },
    resetToDefaults() {
      this.expandControlSizePx = EXPAND_ICON_SIZE_DEFAULT;
      this.ribbonLayoutMode = "grouped";
      this.colorScheme = "light";
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      applyExpandIconCssVars(this.expandControlSizePx);
      applyColorScheme(this.colorScheme);
    },
  },
});
