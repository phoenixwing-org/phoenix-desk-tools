import { describe, expect, it } from "vitest";
import type { KtCodegenDiagnostic } from "@phoenix-wing/kt-codegen";
import {
  ktCodegenDiagnosticLocation,
  ktCodegenDiagnosticMarkerContext,
} from "./ktCodegenDiagnosticPresentation";

describe("KT Codegen diagnostic presentation", () => {
  it("uses structured Wing marker metadata and 1-based workbench locations", () => {
    const diagnostic: KtCodegenDiagnostic = {
      code: "marker.missing-end",
      severity: "error",
      message: "localized text must not be parsed",
      path: { source: "source", file: "src/Widget.cpp", row: 9, column: 2 },
      marker: {
        kind: "start",
        classId: "KtWidgetBase",
        blockKey: "PARAM DECLARATION",
        boundary: { kind: "start", line: 20 },
      },
    };

    expect(ktCodegenDiagnosticLocation(diagnostic)).toBe("src/Widget.cpp:10:3");
    expect(ktCodegenDiagnosticMarkerContext(diagnostic)).toBe(
      "PARAM define · START · KtWidgetBase · 截断于 START 行 20",
    );
  });

  it("falls back to Wing block keys without parsing the message", () => {
    expect(ktCodegenDiagnosticMarkerContext({
      code: "marker.orphan-end",
      severity: "error",
      message: "anything",
      marker: { kind: "end", classId: "KtWidget", blockKey: "UNKNOWN BLOCK" },
    })).toBe("UNKNOWN BLOCK · END · KtWidget");
  });
});
