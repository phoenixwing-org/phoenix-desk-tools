import { describe, expect, it } from "vitest";
import { emitCatDlgText, validateCaaDialogIrRoot } from "./emitCatDlg.js";
import type { CaaDialogNode } from "./schema.js";

const ROOT: CaaDialogNode = {
  id: "MyDlg",
  type: "CATDlgDialog",
  style: ["CATDlgWndBtn"],
  children: [
    {
      id: "FrameParams",
      type: "CATDlgFrame",
      father: "MyDlg",
      grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
      children: [
        {
          id: "LabelName",
          type: "CATDlgLabel",
          father: "FrameParams",
          grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
          nls: { title: "Name" },
          children: [],
        },
      ],
    },
  ],
};

describe("emitCatDlgText", () => {
  it("emits declaration order, father, style, and grid fields", () => {
    expect(emitCatDlgText(ROOT)).toContain(
      [
        "CATDlgFrame FrameParams",
        "{",
        "  FATHER = MyDlg;",
        "  GRID = { 0, 0, 1, 1 };",
        "}",
      ].join("\n"),
    );
    expect(emitCatDlgText(ROOT)).toContain("CATDlgLabel LabelName");
  });
});

describe("validateCaaDialogIrRoot", () => {
  it("accepts a valid dialog tree", () => {
    expect(validateCaaDialogIrRoot(ROOT)).toEqual({ errors: [], warnings: [] });
  });

  it("rejects duplicate ids, invalid fathers, and grid overlaps", () => {
    const invalid: CaaDialogNode = {
      id: "MyDlg",
      type: "CATDlgDialog",
      children: [
        {
          id: "A",
          type: "CATDlgLabel",
          father: "WrongFather",
          grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
          children: [],
        },
        {
          id: "A",
          type: "CATDlgEditor",
          father: "MyDlg",
          grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
          children: [],
        },
      ],
    };

    const result = validateCaaDialogIrRoot(invalid);
    expect(result.errors).toContain("A.FATHER=WrongFather 与父节点 MyDlg 不一致");
    expect(result.errors).toContain("重复控件 id：A");
    expect(result.errors).toContain("MyDlg 内控件重叠：A 与 A");
  });

  it("warns about unknown control types without blocking write", () => {
    const root: CaaDialogNode = {
      id: "MyDlg",
      type: "CATDlgDialog",
      children: [
        {
          id: "Mystery",
          type: "CATDlgMystery",
          father: "MyDlg",
          children: [],
        },
      ],
    };

    expect(validateCaaDialogIrRoot(root)).toEqual({
      errors: [],
      warnings: ["未登记控件类型：CATDlgMystery (Mystery)"],
    });
  });
});
