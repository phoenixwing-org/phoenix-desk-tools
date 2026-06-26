import { describe, expect, it } from "vitest";
import { extractWizardBindingsFromCpp } from "./wizardBindings.js";

describe("extractWizardBindingsFromCpp", () => {
  it("extracts read-only bindings from UpdateDialog lines", () => {
    const source = [
      "void MyDlg::UpdateDialog()",
      "{",
      '  _EditorFirstPartNumber->SetText(parameter->FirstPartNumber);',
      "  _SpinnerPartCount->SetValue(param.PartCount);",
      "  untouched->SetValue(parameter->Ignored);",
      "}",
      "",
    ].join("\n");

    const bindings = extractWizardBindingsFromCpp(source, {
      knownControlIds: ["EditorFirstPartNumber", "SpinnerPartCount"],
    });

    expect(bindings).toEqual([
      expect.objectContaining({
        nodeId: "EditorFirstPartNumber",
        target: "parameter->FirstPartNumber",
        source: "updateDialog",
        line: 3,
      }),
      expect.objectContaining({
        nodeId: "SpinnerPartCount",
        target: "param.PartCount",
        source: "updateDialog",
        line: 4,
      }),
    ]);
  });

  it("extracts bindings from Kevin Wizard comments", () => {
    const source = [
      "void MyDlg::ActionValueChange()",
      "{",
      "  // START KEVIN CAA WIZARD SECTION MyDlg PARAM BINDINGS",
      "  // bind EditorFoo -> parameter->Foo",
      "  // bind SpinnerCount -> data.Count",
      "  // END KEVIN CAA WIZARD SECTION MyDlg PARAM BINDINGS",
      "}",
      "",
    ].join("\n");

    const bindings = extractWizardBindingsFromCpp(source, {
      knownControlIds: ["EditorFoo", "SpinnerCount"],
    });

    expect(bindings).toEqual([
      expect.objectContaining({
        controlId: "EditorFoo",
        target: "parameter->Foo",
        source: "kevinWizard",
        line: 4,
      }),
      expect.objectContaining({
        controlId: "SpinnerCount",
        target: "data.Count",
        source: "kevinWizard",
        line: 5,
      }),
    ]);
  });
});
