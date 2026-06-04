import { defineStore } from "pinia";
import {
  applyExpandIconCssVars,
  clampExpandIconSize,
  EXPAND_ICON_SIZE_DEFAULT,
} from "../utils/expandIconTheme";

const STORAGE_KEY = "fcdesk-ui-prefs-v1";

type UiPrefsPersisted = {
  expandControlSizePx?: number;
};

export const useUiPrefsStore = defineStore("uiPrefs", {
  state: () => ({
    expandControlSizePx: EXPAND_ICON_SIZE_DEFAULT,
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
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    },
    setExpandControlSizePx(px: number) {
      this.expandControlSizePx = clampExpandIconSize(px);
      applyExpandIconCssVars(this.expandControlSizePx);
      this.persist();
    },
  },
});
