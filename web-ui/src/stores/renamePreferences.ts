import { defineStore } from "pinia";
import { DEFAULT_RENAME_OPTIONS } from "../utils/fileRename";

type RenameOptions = { fixXref: boolean; syncLabels: boolean; fixBasename: boolean };
type RenameOption = keyof RenameOptions;
const STORAGE_KEY = "phoenix-rename-options-v1";

function loadOptions(): RenameOptions {
  const defaults: RenameOptions = { ...DEFAULT_RENAME_OPTIONS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    for (const key of Object.keys(defaults) as RenameOption[]) {
      if (typeof saved?.[key] === "boolean") defaults[key] = saved[key];
    }
  } catch { /* Corrupt or unavailable storage keeps safe explicit UI defaults. */ }
  return defaults;
}

/** One user preference shared by file dialogs; no file data or execution plans are persisted. */
export const useRenamePreferencesStore = defineStore("renamePreferences", {
  state: loadOptions,
  actions: {
    setOption(key: RenameOption, value: boolean) {
      this[key] = value;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          fixXref: this.fixXref, syncLabels: this.syncLabels, fixBasename: this.fixBasename,
        }));
      } catch { /* The in-session Pinia preference still works without local storage. */ }
    },
  },
});
