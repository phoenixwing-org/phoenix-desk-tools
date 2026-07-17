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
  it("uses the workbench tab id to isolate same-page tabs", () => {
    const first = contribution("first");
    const second = contribution("second");
    setPagePrimaryContribution("code_index", "tab-1", first);
    setPagePrimaryContribution("code_index", "tab-2", second);

    expect(pagePrimaryContributionKey("code_index", "tab-1")).toBe("tab-1");
    expect(getPagePrimaryContribution("code_index", "tab-1")).toBe(first);
    expect(getPagePrimaryContribution("code_index", "tab-2")).toBe(second);

    setPagePrimaryContribution("code_index", "tab-1", null);
    setPagePrimaryContribution("code_index", "tab-2", null);
  });

  it("falls back to a page-scoped contribution", () => {
    const page = contribution("page");
    setPagePrimaryContribution("code_rename", undefined, page);
    expect(getPagePrimaryContribution("code_rename", "missing-tab")).toBe(page);
    setPagePrimaryContribution("code_rename", undefined, null);
  });
});
