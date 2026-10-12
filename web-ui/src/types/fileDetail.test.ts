import { describe, expect, it } from "vitest";
import { DEFAULT_FILE_DETAIL_SUB_TAB, normalizeFileDetailSubTab } from "./fileDetail";

describe("file detail default tab", () => {
  it("opens editing by default, including legacy or missing tab values", () => {
    expect(DEFAULT_FILE_DETAIL_SUB_TAB).toBe("edit");
    for (const value of [undefined, null, "", "rename", "attributes", "unknown"]) {
      expect(normalizeFileDetailSubTab(value)).toBe("edit");
    }
  });
  it("preserves explicit destinations and restored session tabs", () => {
    for (const tab of ["overview", "edit", "xref", "assembly", "drawing", "objects"] as const) {
      expect(normalizeFileDetailSubTab(tab)).toBe(tab);
    }
  });
});
