import { describe, expect, it } from "vitest";
import type { WorkbenchTab } from "../types/workbench";
import {
  findKtCodegenDocumentTab,
  normalizeKtCodegenDocumentPath,
  reusableKtCodegenBlankTab,
} from "./ktCodegenTabBinding";

function tab(patch: Partial<WorkbenchTab>): WorkbenchTab {
  return {
    id: patch.id ?? "tab-1",
    pageId: patch.pageId ?? "kt_codegen",
    title: patch.title ?? "KT Codegen",
    contextKey: patch.contextKey,
    dirty: patch.dirty ?? false,
    payloadConsumed: false,
  };
}

describe("KT Codegen tab binding", () => {
  it("normalizes tree and discovery paths to the same key", () => {
    expect(normalizeKtCodegenDocumentPath(".\\config\\a.json")).toBe("config/a.json");
    expect(normalizeKtCodegenDocumentPath("./config/a.json")).toBe("config/a.json");
  });

  it("rejects absolute paths and traversal before they become a View identity", () => {
    expect(normalizeKtCodegenDocumentPath("../outside.json")).toBe("");
    expect(normalizeKtCodegenDocumentPath("/tmp/outside.json")).toBe("");
    expect(normalizeKtCodegenDocumentPath("C:\\outside.json")).toBe("");
  });

  it("finds the existing view for the same JSON but not another JSON", () => {
    const opened = tab({ contextKey: "./config/a.json" });
    expect(findKtCodegenDocumentTab([opened], "config/a.json")).toBe(opened);
    expect(findKtCodegenDocumentTab([opened], "config/b.json")).toBeUndefined();
  });

  it("only reuses the active blank clean launcher view", () => {
    const blank = tab({ id: "blank" });
    expect(reusableKtCodegenBlankTab([blank], "blank")).toBe(blank);
    expect(reusableKtCodegenBlankTab([{ ...blank, dirty: true }], "blank")).toBeUndefined();
    expect(reusableKtCodegenBlankTab([{ ...blank, contextKey: "a.json" }], "blank")).toBeUndefined();
  });
});
