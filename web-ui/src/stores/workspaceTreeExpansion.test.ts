import { createPinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkspaceTreeExpansionStore } from "./workspaceTreeExpansion";

let saved: string | null;
beforeEach(() => {
  saved = null;
  vi.stubGlobal("localStorage", { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } });
});
afterEach(() => vi.unstubAllGlobals());
it("persists directory states, including root collapse, independently for each workspace", () => {
  const store = useWorkspaceTreeExpansionStore(createPinia());
  store.setExpanded("/fixture-a", "parts", true);
  store.setExpanded("/fixture-a", "parts/sub", true);
  store.setExpanded("/fixture-a", "parts", false);
  store.setExpanded("/fixture-a", "", false);
  store.setExpanded("/fixture-b", "parts", true);
  const restored = useWorkspaceTreeExpansionStore(createPinia());
  expect(restored.statesFor("/fixture-a")).toEqual([
    { path: "", expanded: false }, { path: "parts", expanded: false }, { path: "parts/sub", expanded: true },
  ]);
  expect(restored.statesFor("/fixture-b")).toEqual([{ path: "parts", expanded: true }]);
  expect(restored.statesFor("/new-workspace")).toEqual([]);
});
it("validates and bounds storage without prototype-sensitive path keys", () => {
  saved = "broken";
  expect(useWorkspaceTreeExpansionStore(createPinia()).workspaces).toEqual([]);
  saved = JSON.stringify([{ workspace: "/fixture", directories: [null, { path: "a", expanded: "true" }, { path: "__proto__", expanded: true }] }]);
  const store = useWorkspaceTreeExpansionStore(createPinia());
  expect(store.statesFor("/fixture")).toEqual([{ path: "__proto__", expanded: true }]);
  for (let i = 0; i < 21; i++) store.setExpanded(`/fixture-${i}`, "parts", true);
  expect(store.workspaces).toHaveLength(20);
});
it("continues in memory if browser storage is unavailable", () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw Error("disabled"); }, setItem: () => { throw Error("disabled"); } });
  const store = useWorkspaceTreeExpansionStore(createPinia());
  expect(() => store.setExpanded("/fixture", "parts", true)).not.toThrow();
  expect(store.statesFor("/fixture")).toEqual([{ path: "parts", expanded: true }]);
});
