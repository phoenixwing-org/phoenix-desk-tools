import { describe, it, expect } from "vitest";
import { createBlankCaaDialogIr } from "./createBlankCaaDialogIr";

describe("createBlankCaaDialogIr", () => {
  it("creates an IR with schema version 1", () => {
    expect(createBlankCaaDialogIr().schemaVersion).toBe(1);
  });

  it("creates a root CATDlgDialog node with no children", () => {
    const ir = createBlankCaaDialogIr();
    expect(ir.root.type).toBe("CATDlgDialog");
    expect(ir.root.children).toEqual([]);
  });

  it("uses provided dialog name for id and title", () => {
    const ir = createBlankCaaDialogIr("MyDlg");
    expect(ir.dialogName).toBe("MyDlg");
    expect(ir.root.id).toBe("MyDlg");
    expect(ir.title).toBe("MyDlg");
  });

  it("includes CATDlgWndBtn style for OK/Cancel/Preview buttons", () => {
    const ir = createBlankCaaDialogIr();
    expect(ir.root.style).toContain("CATDlgWndBtn");
  });

  it("has empty sources.catDlg (diskless)", () => {
    expect(createBlankCaaDialogIr().sources.catDlg).toBe("");
  });

  it("defaults to dialog name NewDlg", () => {
    expect(createBlankCaaDialogIr().dialogName).toBe("NewDlg");
  });
});
