import { describe, expect, it } from "vitest";
import {
  getPagePrimaryContribution,
  pagePrimaryContributionKey,
  setPagePrimaryContribution,
  type PagePrimaryContribution,
} from "./usePagePrimaryContribution";

function contribution(label: string): PagePrimaryContribution {
  return { sections: [{ id: label, title: label }] };
}

describe("page Primary contributions", () => {
  it("allows a tool group title without changing the page identity", () => {
    const group = { ...contribution("tools"), title: "批量工具" };
    setPagePrimaryContribution("xlink_fix", "repair-tab", group);
    expect(getPagePrimaryContribution("xlink_fix", "repair-tab")?.title).toBe("批量工具");
    expect(getPagePrimaryContribution("part_catalog", "catalog-tab")).toBeUndefined();
    setPagePrimaryContribution("xlink_fix", "repair-tab", null);
  });

  it("uses the workbench tab id to isolate same-page tabs", () => {
    const first = contribution("first");
    const second = contribution("second");
    setPagePrimaryContribution("code_ignore", "tab-1", first);
    setPagePrimaryContribution("code_ignore", "tab-2", second);

    expect(pagePrimaryContributionKey("code_ignore", "tab-1")).toBe("tab-1");
    expect(getPagePrimaryContribution("code_ignore", "tab-1")).toBe(first);
    expect(getPagePrimaryContribution("code_ignore", "tab-2")).toBe(second);

    setPagePrimaryContribution("code_ignore", "tab-1", null);
    setPagePrimaryContribution("code_ignore", "tab-2", null);
  });

  it("falls back to a page-scoped contribution", () => {
    const page = contribution("page");
    setPagePrimaryContribution("file_rename", undefined, page);
    expect(getPagePrimaryContribution("file_rename", "missing-tab")).toBe(page);
    setPagePrimaryContribution("file_rename", undefined, null);
  });
});
