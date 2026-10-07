import { ref } from "vue";
import { describe, expect, it } from "vitest";
import {
  isPageSideBlockOpen,
  setPageSideBlockOpen,
  usePageSideBlockVisibility,
} from "./usePageSideBlockVisibility";

describe("page side Block visibility", () => {
  it("defaults every registered page Block to open and ignores unknown pages", () => {
    setPageSideBlockOpen("caa_dialog", true);
    setPageSideBlockOpen("code_ignore", true);
    expect(isPageSideBlockOpen("caa_dialog")).toBe(true);
    expect(isPageSideBlockOpen("code_ignore")).toBe(true);
    expect(isPageSideBlockOpen("not_registered")).toBe(false);
  });

  it("tracks the active contribution and remembers a hidden Block", () => {
    const pageId = ref("caa_dialog");
    const host = usePageSideBlockVisibility(pageId);
    setPageSideBlockOpen("code_ignore", true);

    host.setOpen(false);
    expect(host.available.value).toBe(true);
    expect(host.open.value).toBe(false);

    pageId.value = "code_ignore";
    expect(host.available.value).toBe(true);
    expect(host.open.value).toBe(true);

    pageId.value = "caa_dialog";
    expect(host.open.value).toBe(false);
    host.toggle();
    expect(host.open.value).toBe(true);
  });
});
