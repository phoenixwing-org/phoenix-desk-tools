import { describe, expect, it } from "vitest";
import { emitWizardHeaderDeclarations, patchWizardHeaderDeclarations } from "./wizardHeader.js";
import type { CaaDialogNode } from "./schema.js";

const ROOT: CaaDialogNode = {
  id: "MyDlg",
  type: "CATDlgDialog",
  children: [
    {
      id: "FrameParams",
      type: "CATDlgFrame",
      children: [
        { id: "LabelBaseCurve", type: "CATDlgLabel", father: "FrameParams", children: [] },
        {
          id: "SelectorListBaseCurve",
          type: "CATDlgSelectorList",
          father: "FrameParams",
          children: [],
        },
      ],
    },
    { id: "_AlreadyPrefixed", type: "CATDlgPushButton", children: [] },
  ],
};

it("emits widget declarations in depth-first order without the dialog root", () => {
  expect(emitWizardHeaderDeclarations(ROOT)).toBe(
    [
      " CATDlgFrame*      _FrameParams;",
      " CATDlgLabel*      _LabelBaseCurve;",
      " CATDlgSelectorList*      _SelectorListBaseCurve;",
      " CATDlgPushButton*      _AlreadyPrefixed;",
    ].join("\n"),
  );
});

describe("patchWizardHeaderDeclarations", () => {
  it("replaces only the CAA2 widget declaration section", () => {
    const source = [
      "#ifndef MyDlg_widgets_H",
      "#define MyDlg_widgets_H",
      "class MyDlg {",
      "private:",
      "    // clang-format off",
      "//CAA2 WIZARD WIDGET DECLARATION SECTION",
      " CATDlgLabel*      _OldLabel;",
      "//END CAA2 WIZARD WIDGET DECLARATION SECTION",
      "    // clang-format on",
      "void BuildMore();",
      "};",
      "#endif",
      "",
    ].join("\n");

    const out = patchWizardHeaderDeclarations(source, ROOT);
    expect(out.warnings).toEqual([]);
    expect(out.changed).toBe(true);
    expect(out.text).toContain("//CAA2 WIZARD WIDGET DECLARATION SECTION\n CATDlgFrame*      _FrameParams;");
    expect(out.text).toContain(" CATDlgSelectorList*      _SelectorListBaseCurve;");
    expect(out.text).not.toContain("_OldLabel");
    expect(out.text).toContain("void BuildMore();");
    expect(out.text).toContain("    // clang-format on");
  });

  it("returns a warning and leaves text unchanged when markers are missing", () => {
    const source = "class MyDlg {};\n";
    const out = patchWizardHeaderDeclarations(source, ROOT);
    expect(out.changed).toBe(false);
    expect(out.text).toBe(source);
    expect(out.warnings[0]).toContain("未找到 Wizard 标记段");
  });
});
