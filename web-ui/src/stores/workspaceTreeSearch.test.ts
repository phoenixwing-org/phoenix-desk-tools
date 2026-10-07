import { createPinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceTreeSearchStore } from "./workspaceTreeSearch";

let saved: string | null;
beforeEach(() => { saved = null; vi.stubGlobal("localStorage", { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } }); });
afterEach(() => vi.unstubAllGlobals());
it("remembers the live query on refresh while committing only complete searches to history", () => {
  const store = useWorkspaceTreeSearchStore(createPinia());
  store.setQuery("/fixture-one", "Br"); store.setQuery("/fixture-one", "Bracket 001");
  expect(store.recentFor("/fixture-one")).toEqual([]);
  store.remember("/fixture-one");
  const restored = useWorkspaceTreeSearchStore(createPinia());
  expect(restored.queryFor("/fixture-one")).toBe("Bracket 001");
  expect(restored.recentFor("/fixture-one")).toEqual(["Bracket 001"]);
});
it("retains five most recent distinct searches, normalizes whitespace, and promotes a reused search", () => {
  const store = useWorkspaceTreeSearchStore(createPinia());
  for (const query of ["one", "two", "three", "four", "five", "six", " TWO "]) {
    store.setQuery("/fixture", query); store.remember("/fixture");
  }
  expect(store.recentFor("/fixture")).toEqual(["TWO", "six", "five", "four", "three"]);
  store.setQuery("/fixture", "示例   支架\t001"); store.remember("/fixture");
  expect(store.recentFor("/fixture")[0]).toBe("示例 支架 001");
  store.setQuery("/fixture", ""); store.remember("/fixture");
  expect(store.queryFor("/fixture")).toBe(""); expect(store.recentFor("/fixture")).toHaveLength(5);
});
it("isolates workspaces and bounds the workspace cache", () => {
  const store = useWorkspaceTreeSearchStore(createPinia());
  store.setQuery("/fixture-one", "only here"); store.remember("/fixture-one");
  expect(store.queryFor("/fixture-two")).toBe(""); expect(store.recentFor("/fixture-two")).toEqual([]);
  for (let i = 0; i < 25; i++) store.setQuery(`/fixture-${i}`, "a");
  expect(store.searches).toHaveLength(20);
});
it("tolerates malformed storage and keeps in-session preferences when persistence fails", () => {
  saved = "broken"; expect(useWorkspaceTreeSearchStore(createPinia()).searches).toEqual([]);
  saved = JSON.stringify([{ workspace: "/fixture", query: "a", recent: [null, 42, " a ", "", "b"] }, { workspace: "bad", query: null }]);
  expect(useWorkspaceTreeSearchStore(createPinia()).recentFor("/fixture")).toEqual(["a", "b"]);
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("disabled"); }, setItem: () => { throw new Error("disabled"); } });
  const store = useWorkspaceTreeSearchStore(createPinia());
  expect(() => { store.setQuery("/fixture", "test"); store.remember("/fixture"); }).not.toThrow();
  expect(store.queryFor("/fixture")).toBe("test");
});
