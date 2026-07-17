import { ref } from "vue";
import { describe, expect, it } from "vitest";
import {
  isPageSideBlockOpen,
  setPageSideBlockOpen,
  usePageSideBlockVisibility,
} from "./usePageSideBlockVisibility";

describe("page side Block visibility", () => {
  it("defaults every registered page Block to open and ignores unknown pages", () => {
    setPageSideBlockOpen("kt_codegen", true);
    setPageSideBlockOpen("code_index", true);
    expect(isPageSideBlockOpen("kt_codegen")).toBe(true);
    expect(isPageSideBlockOpen("code_index")).toBe(true);
    expect(isPageSideBlockOpen("not_registered")).toBe(false);
  });

  it("tracks the active contribution and remembers a hidden Block", () => {
    const pageId = ref("kt_codegen");
    const host = usePageSideBlockVisibility(pageId);
    setPageSideBlockOpen("code_index", true);

    host.setOpen(false);
    expect(host.available.value).toBe(true);
    expect(host.open.value).toBe(false);

    pageId.value = "code_index";
    expect(host.available.value).toBe(true);
    expect(host.open.value).toBe(true);

    pageId.value = "kt_codegen";
    expect(host.open.value).toBe(false);
    host.toggle();
    expect(host.open.value).toBe(true);
  });
});
