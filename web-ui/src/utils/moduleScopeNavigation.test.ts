import { describe, expect, it } from "vitest";
import { NAV_MODULE_OPTIONS } from "../constants/navModules";
import type { WorkbenchTab } from "../types/workbench";
import { defaultPageForModuleScope, resolveTabForModuleScope, ribbonTabIdForModuleScope } from "./moduleScopeNavigation";
import { parseShellUrl } from "./shellUrlSync";

describe("workspace domain scopes with aggregate tools navigation", () => {
  it("keeps persisted module choices independent and only maps their Ribbon presentation", () => {
    expect(NAV_MODULE_OPTIONS.map((option) => option.id)).toEqual(["cad", "code"]);
    expect(ribbonTabIdForModuleScope("cad", ["cad"])).toBe("cad");
    expect(ribbonTabIdForModuleScope("code", ["code"])).toBe("cad");
    expect(ribbonTabIdForModuleScope("all", ["cad", "code"])).toBe("system");
    expect(ribbonTabIdForModuleScope("code", ["cad"])).toBe("system");
    expect(ribbonTabIdForModuleScope("cad", ["code"])).toBe("system");
  });

  it("preserves separate workspace defaults and document selection", () => {
    expect(defaultPageForModuleScope("code", ["code"])).toBe("caa_dialog_home");
    expect(defaultPageForModuleScope("cad", ["cad"])).toBe("part_catalog");
    const tabs: WorkbenchTab[] = [
      { id: "caa", pageId: "caa_dialog", title: "CAA", contextKey: "Dialog.CATDlg", dirty: true, payloadConsumed: true },
      { id: "cad", pageId: "file_detail", title: "CAD", contextKey: "Part.FCStd", dirty: false, payloadConsumed: true },
    ];
    const domain = (page: string) => page === "caa_dialog" ? "code" : "cad";
    expect(resolveTabForModuleScope(tabs, "cad", "code", domain)).toBe("caa");
    expect(resolveTabForModuleScope(tabs, "caa", "cad", domain)).toBe("cad");
  });

  it.each(["code_ignore", "caa_dialog_home", "cad_index", "part_catalog", "audio_extract"])(
    "preserves the existing %s deep link", (pageId) => {
      expect(parseShellUrl(`?page=${pageId}`)).toEqual({ kind: "page", pageId });
    },
  );
});
