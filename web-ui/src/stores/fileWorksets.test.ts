import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFileWorksets } from "../api";
import { RETIRED_CODE_PAGE_IDS } from "../constants/retiredCodePages";
import { useFileWorksetsStore } from "./fileWorksets";

vi.mock("../api", () => ({
  fetchFileWorksets: vi.fn(),
  pruneMissingFileWorksetPaths: vi.fn(),
  saveFileWorksets: vi.fn(),
}));

const storageKey = "phoenix-file-worksets-ui-v1";

describe("workset preferences after Code retirement", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.mocked(fetchFileWorksets).mockResolvedValue({
      version: 1,
      worksets: [
        { id: "first", name: "First", updated_at: "2026-01-01", paths: ["part.FCStd"] },
        { id: "second", name: "Second", updated_at: "2026-01-01", paths: ["Dialog.CATDlg"] },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not consume retired scopes but preserves their exact values through hydration and normal updates", async () => {
    const retiredScopes = Object.fromEntries([...RETIRED_CODE_PAGE_IDS].map((pageId) => [pageId, {
      scopeMode: "index", worksetId: "legacy-missing-workset", scope: `${pageId}/old`, extra: { retained: true },
    }]));
    const legacyUuid = { scopeMode: "index", worksetId: "legacy", scope: "legacy/source", retained: true };
    const otherWorkspace = { activeId: "other", pageScopes: { old: { untouched: true } } };
    localStorage.setItem(storageKey, JSON.stringify({
      retainedRootField: "keep",
      byWorkspace: {
        "/workspace": {
          activeId: null,
          pageScopes: { ...retiredScopes, cad_index: { scopeMode: "scope", worksetId: null, scope: "parts" } },
          codeUuid: legacyUuid,
          retainedWorkspaceField: "keep",
        },
        "/other": otherWorkspace,
      },
    }));

    const store = useFileWorksetsStore();
    await store.hydrate("/workspace");
    expect(store.activeId).toBe("first"); // Hydration has already persisted a new default selection.
    for (const pageId of RETIRED_CODE_PAGE_IDS) {
      expect(store.pageScopes[pageId]).toBeUndefined();
      expect(store.getPageScope(pageId)).toEqual({ scopeMode: "all", worksetId: null, scope: "" });
      store.patchPageScope(pageId, { scope: "must-not-overwrite-history" });
    }
    store.patchPageScope("cad_index", { scope: "new-parts" });
    store.setActiveId("second");

    const saved = JSON.parse(localStorage.getItem(storageKey)!);
    expect(saved.retainedRootField).toBe("keep");
    expect(saved.byWorkspace["/other"]).toEqual(otherWorkspace);
    expect(saved.byWorkspace["/workspace"]).toEqual({
      activeId: "second",
      pageScopes: { ...retiredScopes, cad_index: { scopeMode: "scope", worksetId: null, scope: "new-parts" } },
      codeUuid: legacyUuid,
      retainedWorkspaceField: "keep",
    });
  });
});
