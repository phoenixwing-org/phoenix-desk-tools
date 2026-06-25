import { describe, expect, it } from "vitest";
import { emitWizardCppConstruction, patchWizardCppConstruction } from "./wizardCpp.js";
import type { CaaDialogNode } from "./schema.js";

const ROOT: CaaDialogNode = {
  id: "MyDlg",
  type: "CATDlgDialog",
  children: [
    {
      id: "FrameParams",
      type: "CATDlgFrame",
      father: "MyDlg",
      style: ["CATDlgFraNoFrame"],
      grid: { row: 0, col: 0, rowSpan: 2, colSpan: 2 },
      gridLayout: { rowResizable: [1], colResizable: [0] },
      children: [
        {
          id: "LabelBaseCurve",
          type: "CATDlgLabel",
          father: "FrameParams",
          grid: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
          children: [],
        },
      ],
    },
  ],
};

it("emits cpp construction statements in depth-first order", () => {
  expect(emitWizardCppConstruction(ROOT)).toBe(
    [
      '_FrameParams = new CATDlgFrame(this, "FrameParams", CATDlgFraNoFrame);',
      "_FrameParams->SetGridConstraints(0, 0, 2, 2, CATGRID_4SIDES);",
      "_FrameParams->SetGridRowResizable(1);",
      "_FrameParams->SetGridColumnResizable(0);",
      '_LabelBaseCurve = new CATDlgLabel(_FrameParams, "LabelBaseCurve", 0);',
      "_LabelBaseCurve->SetGridConstraints(0, 0, 1, 1, CATGRID_4SIDES);",
    ].join("\n"),
  );
});

describe("patchWizardCppConstruction", () => {
  it("replaces only the CAA2 widget construction section", () => {
    const source = [
      "void MyDlg::Build()",
      "{",
      "//CAA2 WIZARD WIDGET CONSTRUCTION SECTION",
      " _Old = new CATDlgLabel(this, \"Old\", 0);",
      "//END CAA2 WIZARD WIDGET CONSTRUCTION SECTION",
      " BuildMore();",
      "}",
      "",
    ].join("\n");

    const out = patchWizardCppConstruction(source, ROOT);
    expect(out.warnings).toEqual([]);
    expect(out.changed).toBe(true);
    expect(out.text).toContain('_FrameParams = new CATDlgFrame(this, "FrameParams", CATDlgFraNoFrame);');
    expect(out.text).toContain('_LabelBaseCurve = new CATDlgLabel(_FrameParams, "LabelBaseCurve", 0);');
    expect(out.text).not.toContain("_Old");
    expect(out.text).toContain(" BuildMore();");
  });

  it("returns a warning and leaves text unchanged when markers are missing", () => {
    const source = "void MyDlg::Build() {}\n";
    const out = patchWizardCppConstruction(source, ROOT);
    expect(out.changed).toBe(false);
    expect(out.text).toBe(source);
    expect(out.warnings[0]).toContain("未找到 Wizard 标记段");
  });

  it("preserves existing SetColumnTitles calls for active widgets", () => {
    const rootWithColumns: CaaDialogNode = {
      id: "MyDlg",
      type: "CATDlgDialog",
      children: [
        {
          id: "MultiListPartBom",
          type: "CATDlgMultiList",
          father: "MyDlg",
          nls: { columnTitles: ["Part", "Qty"] },
          children: [],
        },
      ],
    };
    const source = [
      "void MyDlg::Build()",
      "{",
      "//CAA2 WIZARD WIDGET CONSTRUCTION SECTION",
      ' _MultiListPartBom = new CATDlgMultiList(this, "MultiListPartBom", 0);',
      " _MultiListPartBom->SetColumnTitles(MyColumnTitles);",
      " _RemovedList->SetColumnTitles(RemovedTitles);",
      "//END CAA2 WIZARD WIDGET CONSTRUCTION SECTION",
      " BuildMore();",
      "}",
      "",
    ].join("\n");

    const out = patchWizardCppConstruction(source, rootWithColumns);
    expect(out.text).toContain('_MultiListPartBom = new CATDlgMultiList(this, "MultiListPartBom", 0);');
    expect(out.text).toContain("_MultiListPartBom->SetColumnTitles(MyColumnTitles);");
    expect(out.text).not.toContain("MultiListPartBomColumnTitles[]");
    expect(out.text).not.toContain("_RemovedList->SetColumnTitles");
    expect(out.warnings.some((w) => w.includes("保留了既有 SetColumnTitles"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("MultiListPartBom"))).toBe(true);
  });

  it("does not preserve SetColumnTitles calls matched only by substring", () => {
    const rootWithColumns: CaaDialogNode = {
      id: "MyDlg",
      type: "CATDlgDialog",
      children: [
        {
          id: "List",
          type: "CATDlgMultiList",
          father: "MyDlg",
          nls: { columnTitles: ["Part"] },
          children: [],
        },
      ],
    };
    const source = [
      "void MyDlg::Build()",
      "{",
      "//CAA2 WIZARD WIDGET CONSTRUCTION SECTION",
      ' _OtherList = new CATDlgMultiList(this, "OtherList", 0);',
      " _OtherList->SetColumnTitles(OtherTitles);",
      "//END CAA2 WIZARD WIDGET CONSTRUCTION SECTION",
      "}",
      "",
    ].join("\n");

    const out = patchWizardCppConstruction(source, rootWithColumns);
    expect(out.text).not.toContain("_OtherList->SetColumnTitles");
    expect(out.text).toContain("CATUnicodeString ListColumnTitles[] = {");
    expect(out.text).toContain("_List->SetColumnTitles(ListColumnTitles, 1);");
    expect(out.warnings.some((w) => w.includes("已生成 SetColumnTitles"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("List"))).toBe(true);
  });

  it("generates SetColumnTitles for MultiList nodes without existing calls", () => {
    const rootWithColumns: CaaDialogNode = {
      id: "MyDlg",
      type: "CATDlgDialog",
      children: [
        {
          id: "MultiListPartBom",
          type: "CATDlgMultiList",
          father: "MyDlg",
          size: { columnCount: 3 },
          nls: { columnTitles: ["Part", "Qty"] },
          children: [],
        },
      ],
    };
    const source = [
      "void MyDlg::Build()",
      "{",
      "//CAA2 WIZARD WIDGET CONSTRUCTION SECTION",
      "//END CAA2 WIZARD WIDGET CONSTRUCTION SECTION",
      "}",
      "",
    ].join("\n");

    const out = patchWizardCppConstruction(source, rootWithColumns);
    expect(out.text).toContain("CATUnicodeString MultiListPartBomColumnTitles[] = {");
    expect(out.text).toContain('  CATUnicodeString("Part"),');
    expect(out.text).toContain('  CATUnicodeString("Qty"),');
    expect(out.text).toContain('  CATUnicodeString(""),');
    expect(out.text).toContain("_MultiListPartBom->SetColumnTitles(MultiListPartBomColumnTitles, 3);");
    expect(out.warnings.some((w) => w.includes("已生成 SetColumnTitles"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("MultiListPartBom"))).toBe(true);
  });
});
