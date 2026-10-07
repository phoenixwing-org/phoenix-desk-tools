import { describe, expect, it } from "vitest";
import {
  PAGE_SIDE_BLOCK_COMPONENTS,
  PAGE_SIDE_BLOCK_LABELS,
  pageHasSideBlock,
  pageSideBlockComponent,
  pageSideBlockLabel,
} from "./pageSideBlockRegistry";
import { PAGE_CONTRIBUTIONS } from "./pageRegistry";
import type { PageSideBlockHostProps } from "./pageRegistry";

describe("page side Block registry", () => {
  it("keeps a stable page/tab context contract for future multi-tab Blocks", () => {
    const props: PageSideBlockHostProps = { pageId: "caa_dialog", workbenchTabId: "tab-1" };
    expect(props).toEqual({ pageId: "caa_dialog", workbenchTabId: "tab-1" });
  });

  it("gives every registered workbench page a Primary Block", () => {
    expect(Object.keys(PAGE_SIDE_BLOCK_COMPONENTS)).toEqual(Object.keys(PAGE_CONTRIBUTIONS));
    expect(Object.isFrozen(PAGE_CONTRIBUTIONS)).toBe(true);
    expect(Object.isFrozen(PAGE_CONTRIBUTIONS.caa_dialog)).toBe(true);
    expect(Object.isFrozen(PAGE_SIDE_BLOCK_COMPONENTS)).toBe(true);
    expect(Object.isFrozen(PAGE_SIDE_BLOCK_LABELS)).toBe(true);
    expect(Object.keys(PAGE_SIDE_BLOCK_LABELS)).toEqual(Object.keys(PAGE_SIDE_BLOCK_COMPONENTS));
    expect(pageHasSideBlock("caa_dialog")).toBe(true);
    expect(pageSideBlockComponent("caa_dialog")).toBeTruthy();
    expect(pageSideBlockLabel("caa_dialog")).toBe("CAA Primary");
    expect(pageHasSideBlock("code_ignore")).toBe(true);
    expect(pageSideBlockComponent("code_ignore")).toBeTruthy();
    expect(pageSideBlockLabel("code_ignore")).toBe("忽略设定 Primary");
    expect(PAGE_CONTRIBUTIONS.caa_dialog?.sideBlock).toBe(pageSideBlockComponent("caa_dialog"));
    expect(pageSideBlockComponent("caa_dialog")).toBe(pageSideBlockComponent("code_ignore"));
    for (const contribution of Object.values(PAGE_CONTRIBUTIONS)) {
      expect(Boolean(contribution.sideBlockLabel?.trim())).toBe(Boolean(contribution.sideBlock));
    }
  });
});
