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
    const props: PageSideBlockHostProps = { pageId: "kt_codegen", workbenchTabId: "tab-1" };
    expect(props).toEqual({ pageId: "kt_codegen", workbenchTabId: "tab-1" });
  });

  it("gives every registered workbench page a Primary Block", () => {
    expect(Object.keys(PAGE_SIDE_BLOCK_COMPONENTS)).toEqual(Object.keys(PAGE_CONTRIBUTIONS));
    expect(Object.isFrozen(PAGE_CONTRIBUTIONS)).toBe(true);
    expect(Object.isFrozen(PAGE_CONTRIBUTIONS.kt_codegen)).toBe(true);
    expect(Object.isFrozen(PAGE_SIDE_BLOCK_COMPONENTS)).toBe(true);
    expect(Object.isFrozen(PAGE_SIDE_BLOCK_LABELS)).toBe(true);
    expect(Object.keys(PAGE_SIDE_BLOCK_LABELS)).toEqual(Object.keys(PAGE_SIDE_BLOCK_COMPONENTS));
    expect(pageHasSideBlock("kt_codegen")).toBe(true);
    expect(pageSideBlockComponent("kt_codegen")).toBeTruthy();
    expect(pageSideBlockLabel("kt_codegen")).toBe("KT Codegen Primary");
    expect(pageHasSideBlock("code_index")).toBe(true);
    expect(pageSideBlockComponent("code_index")).toBeTruthy();
    expect(pageSideBlockLabel("code_index")).toBe("Code 索引 Primary");
    expect(pageSideBlockLabel("caa_dialog")).toBe("CAA Primary");
    expect(PAGE_CONTRIBUTIONS.kt_codegen?.sideBlock).toBe(pageSideBlockComponent("kt_codegen"));
    expect(pageSideBlockComponent("kt_codegen")).toBe(pageSideBlockComponent("code_index"));
    expect(pageSideBlockComponent("caa_dialog")).toBe(pageSideBlockComponent("code_index"));
    for (const contribution of Object.values(PAGE_CONTRIBUTIONS)) {
      expect(Boolean(contribution.sideBlockLabel?.trim())).toBe(Boolean(contribution.sideBlock));
    }
  });
});
