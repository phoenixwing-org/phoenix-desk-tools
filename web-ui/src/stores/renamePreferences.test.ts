import { createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRenamePreferencesStore } from "./renamePreferences";

let saved: string | null;
beforeEach(() => {
  saved = null;
  vi.stubGlobal("localStorage", { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } });
});
afterEach(() => vi.unstubAllGlobals());

describe("rename option preferences", () => {
  it("starts with all options selected", () => {
    const prefs = useRenamePreferencesStore(createPinia());
    expect(prefs.$state).toEqual({ fixXref: true, syncLabels: true, fixBasename: true });
  });
  it("restores explicit false choices on a fresh Pinia instance", () => {
    const prefs = useRenamePreferencesStore(createPinia());
    prefs.setOption("syncLabels", false);
    prefs.setOption("fixBasename", false);
    expect(useRenamePreferencesStore(createPinia()).$state).toEqual({ fixXref: true, syncLabels: false, fixBasename: false });
  });
  it("ignores malformed or non-boolean persisted values", () => {
    saved = "broken";
    expect(useRenamePreferencesStore(createPinia()).fixXref).toBe(true);
    saved = JSON.stringify({ fixXref: false, syncLabels: "false", fixBasename: null });
    expect(useRenamePreferencesStore(createPinia()).$state).toEqual({ fixXref: false, syncLabels: true, fixBasename: true });
  });
  it("keeps the in-session choice when storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("unavailable"); }, setItem: () => { throw new Error("unavailable"); } });
    const prefs = useRenamePreferencesStore(createPinia());
    expect(() => prefs.setOption("fixXref", false)).not.toThrow();
    expect(prefs.fixXref).toBe(false);
  });
});
