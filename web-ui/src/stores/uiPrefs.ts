import { defineStore } from "pinia";
import {
  applyExpandIconCssVars,
  clampExpandIconSize,
  EXPAND_ICON_SIZE_DEFAULT,
} from "../utils/expandIconTheme";

const STORAGE_KEY = "phoenix-ui-prefs-v1";

export type RibbonLayoutMode = "grouped" | "inline";

type UiPrefsPersisted = {
  expandControlSizePx?: number;
  ribbonLayoutMode?: RibbonLayoutMode;
};

export const useUiPrefsStore = defineStore("uiPrefs", {
  state: () => ({
    expandControlSizePx: EXPAND_ICON_SIZE_DEFAULT,
    ribbonLayoutMode: "grouped" as RibbonLayoutMode,
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
        }
      } catch {
        /* ignore corrupt storage */
      }
      applyExpandIconCssVars(this.expandControlSizePx);
      this.hydrated = true;
    },
    persist() {
      const payload: UiPrefsPersisted = {
        expandControlSizePx: this.expandControlSizePx,
        ribbonLayoutMode: this.ribbonLayoutMode,
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
  },
});
