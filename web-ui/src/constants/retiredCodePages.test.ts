import fs from "node:fs";
import { ref } from "vue";
import { describe, expect, it } from "vitest";
import { CODE_PAGE_FALLBACK, RETIRED_CODE_PAGE_IDS } from "./retiredCodePages";
import { PAGE_COMPONENT_IDS } from "../layout/pageRegistry";
import { PAGE_SIDE_BLOCK_COMPONENTS } from "../layout/pageSideBlockRegistry";
import { createWorkbench } from "../composables/useWorkbench";
import { buildShellSearchParams, parseShellUrl } from "../utils/shellUrlSync";
import { defaultPageForModuleScope } from "../utils/moduleScopeNavigation";
import type { AppConfig } from "../types/config";

const retiredPages = [...RETIRED_CODE_PAGE_IDS];
const workbench = () => createWorkbench(ref<AppConfig | null>(null));
const source = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), "utf8");

describe("retired Code tool boundary", () => {
  it("has no page or Primary registration for the five retired tools", () => {
    expect(retiredPages).toHaveLength(5);
    for (const id of retiredPages) {
      expect(PAGE_COMPONENT_IDS.has(id)).toBe(false);
      expect(PAGE_SIDE_BLOCK_COMPONENTS[id]).toBeUndefined();
    }
    for (const id of ["code_ignore", "caa_dialog_home", "caa_dialog", "cad_index", "part_catalog", "git"]) {
      expect(PAGE_COMPONENT_IDS.has(id)).toBe(true);
    }
  });

  it.each(retiredPages)("redirects old %s links without forwarding document or operation parameters", (pageId) => {
    expect(parseShellUrl(`?page=${pageId}&rel=private/draft.json&rename_log_id=42&analyze=1`)).toEqual({
      kind: "page", pageId: CODE_PAGE_FALLBACK,
    });
    expect(buildShellSearchParams({
      showWelcome: false,
      activeTab: { id: "old", pageId, title: "Old", contextKey: "private/draft.json", dirty: true, payloadConsumed: true },
    }).toString()).toBe(`page=${CODE_PAGE_FALLBACK}`);
  });

  it.each(retiredPages)("prevents programmatic reopening of %s and drops its context", (pageId) => {
    const wb = workbench();
    wb.openTab({ pageId, title: "Old document", subtitle: "draft.json", contextKey: "draft.json", forceNew: true });
    wb.openTab({ pageId, forceNew: true });
    expect(wb.tabs.value).toHaveLength(1);
    expect(wb.activeTab()).toMatchObject({ pageId: CODE_PAGE_FALLBACK, title: "CAA 对话框", dirty: false });
    expect(wb.activeTab()?.contextKey).toBeUndefined();
    expect(wb.activeTab()?.subtitle).toBeUndefined();
    expect(wb.canOpenNewTab(pageId)).toBe(false);
  });

  it("migrates old sessions to one clean CAA home without restoring retired drafts", () => {
    const wb = workbench();
    expect(wb.restoreSession({
      version: 1, activeTabId: "old-4",
      tabs: retiredPages.map((pageId, index) => ({
        id: `old-${index}`, pageId, title: "Retired", contextKey: "draft.json", subtitle: "draft.json",
        pageState: { draft: { unsaved: true } },
      })),
    })).toBe(true);
    expect(wb.tabs.value).toHaveLength(1);
    expect(wb.activeTab()).toMatchObject({ pageId: CODE_PAGE_FALLBACK, dirty: false });
    expect(wb.activeTab()?.contextKey).toBeUndefined();
    expect(wb.activeTab()?.subtitle).toBeUndefined();
    expect(wb.activeTab()?.pageState).toBeUndefined();
    expect(wb.exportSession({}).tabs.map((tab) => tab.pageId)).toEqual([CODE_PAGE_FALLBACK]);
  });

  it("keeps existing CAA and CAD documents, and activates existing home when the retired tab was active", () => {
    const wb = workbench();
    wb.restoreSession({
      version: 1, activeTabId: "retired",
      tabs: [
        { id: "cad", pageId: "cad_index", title: "CAD 索引", pageState: { filter: "part" } },
        { id: "retired", pageId: retiredPages[0]!, title: "Retired", pageState: { draft: true } },
        { id: "caa", pageId: "caa_dialog", title: "Dialog", contextKey: "Dialog.CATDlg", pageState: { draft: true } },
        { id: "home", pageId: CODE_PAGE_FALLBACK, title: "My dialogs", pageState: { query: "Widget" } },
        { id: "ignore", pageId: "code_ignore", title: "忽略设定" },
      ],
    });
    expect(wb.tabs.value.map((tab) => tab.id)).toEqual(["cad", "caa", "home", "ignore"]);
    expect(wb.activeTabId.value).toBe("home");
    expect(wb.getTab("caa")).toMatchObject({ contextKey: "Dialog.CATDlg", pageState: { draft: true } });
    expect(wb.getTab("cad")?.pageState).toEqual({ filter: "part" });
    expect(wb.getTab("home")).toMatchObject({ title: "My dialogs", pageState: { query: "Widget" } });
  });

  it("uses CAA as the Code default and preserves CAD defaults", () => {
    expect(defaultPageForModuleScope("code", ["cad", "code"])).toBe(CODE_PAGE_FALLBACK);
    expect(defaultPageForModuleScope("all", ["code"])).toBe(CODE_PAGE_FALLBACK);
    expect(defaultPageForModuleScope("cad", ["cad", "code"])).toBe("part_catalog");
    expect(defaultPageForModuleScope("all", [])).toBe("home");
  });

  it("keeps both unmounted CAA editor drafts across a retired-active session migration and export", () => {
    const wb = workbench();
    const firstDraft = { dirty: true, draft: { text: "Unsaved first dialog" } };
    const secondDraft = { dirty: true, draft: { text: "Unsaved second dialog" } };
    wb.restoreSession({
      version: 1, activeTabId: "retired",
      tabs: [
        { id: "retired", pageId: retiredPages[0]!, title: "Retired" },
        { id: "caa-1", pageId: "caa_dialog", title: "First", contextKey: "First.CATDlg", pageState: firstDraft },
        { id: "caa-2", pageId: "caa_dialog", title: "Second", contextKey: "Second.CATDlg", pageState: secondDraft },
      ],
    });
    expect(wb.activeTab()?.pageId).toBe(CODE_PAGE_FALLBACK);

    // No editor has mounted, so collectPageStates supplies no entry for either Tab.
    const restoredAgain = workbench();
    expect(restoredAgain.restoreSession(JSON.parse(JSON.stringify(wb.exportSession({}))))).toBe(true);
    expect(restoredAgain.getTab("caa-1")?.pageState).toEqual(firstDraft);
    expect(restoredAgain.getTab("caa-2")?.pageState).toEqual(secondDraft);

    const freshDraft = { dirty: true, draft: { text: "Newly serialized draft" } };
    const live = wb.exportSession({ "caa-1": freshDraft, "caa-2": undefined });
    expect(live.tabs.find((tab) => tab.id === "caa-1")?.pageState).toEqual(freshDraft);
    expect(live.tabs.find((tab) => tab.id === "caa-2")?.pageState).toBeUndefined();

    // Once the editor consumes its restored state, missing serializer output must not resurrect it.
    expect(wb.consumeTabPageState("caa-1")).toEqual(firstDraft);
    const consumed = wb.exportSession({});
    expect(consumed.tabs.find((tab) => tab.id === "caa-1")?.pageState).toBeUndefined();
    expect(consumed.tabs.find((tab) => tab.id === "caa-2")?.pageState).toEqual(secondDraft);
  });

  it("removes retired API calls and Codegen shell hooks while preserving independent APIs", () => {
    const api = source("../api.ts");
    for (const route of ["index", "reorder-members", "rename", "uuid", "codegen"]) {
      expect(api).not.toContain(`/api/code/${route}`);
    }
    expect(api).toContain("/api/code/ignore/prefs");
    expect(api).toContain("/api/file-worksets");
    expect(api).toContain("/api/git/");
    expect(source("../api/caaDialog.ts")).toContain("/api/caa/");
    expect(source("../composables/useAppShell.ts")).not.toMatch(/KtCodegen|ktCodegen/u);
    expect(source("../components/CodeIgnorePanel.vue")).toContain("保存不会触发源码扫描");
  });
});
