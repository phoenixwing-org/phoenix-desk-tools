import { describe, expect, it } from "vitest";
import {
  caaDialogGroupKey,
  inferCatNlsRel,
  inferCatNlsRelCandidates,
  inferGraphicResourceDirs,
} from "../src/caaDialogPaths.js";

describe("caaDialogGroupKey", () => {
  it("recognizes a UI module at the start or in the middle of a relative path", () => {
    expect(caaDialogGroupKey("ModuleUI.m/dialog/First.CATDlg")).toBe("ModuleUI.m");
    expect(caaDialogGroupKey("Workspace/ModuleUI.m/dialog/First.CATDlg")).toBe("ModuleUI.m");
    expect(caaDialogGroupKey("plain/dialog/First.CATDlg")).toBe("dialog");
  });
});

describe("inferCatNlsRelCandidates", () => {
  const catDlg =
    "PNXBomAnalysisWsp/PNXBomAnalysisFrm/PNXBomAnalysisUI.m/LocalInterfaces/PNXBomAnalysisDlg.CATDlg";

  it("prefers package-level CNext for PNX BOM layout", () => {
    const candidates = inferCatNlsRelCandidates(catDlg);
    expect(candidates[0]).toBe(
      "PNXBomAnalysisWsp/PNXBomAnalysisFrm/CNext/resources/msgcatalog/PNXBomAnalysisDlg.CATNls",
    );
    expect(candidates[1]).toBe(
      "PNXBomAnalysisWsp/PNXBomAnalysisFrm/PNXBomAnalysisUI.m/LocalInterfaces/PNXBomAnalysisDlg.CATNls",
    );
    expect(inferCatNlsRel(catDlg)).toBe(candidates[0]);
  });

  it("skips Frm sibling for .edu package layout", () => {
    const catDlg =
      "PNXCombinedCurveWsp/PNXCombinedCurve.edu/PNXCombinedCurveUI.m/LocalInterfaces/PNXSubCurveDlg.CATDlg";
    const candidates = inferCatNlsRelCandidates(catDlg);
    expect(candidates).toEqual([
      "PNXCombinedCurveWsp/PNXCombinedCurve.edu/CNext/resources/msgcatalog/PNXSubCurveDlg.CATNls",
      "PNXCombinedCurveWsp/PNXCombinedCurve.edu/PNXCombinedCurveUI.m/LocalInterfaces/PNXSubCurveDlg.CATNls",
    ]);
  });

  it("falls back to a CATNls next to a CATDlg outside the canonical CAA layout", () => {
    expect(inferCatNlsRelCandidates("CAA/Dialog/Sample.CATDlg")).toEqual([
      "CAA/Dialog/Sample.CATNls",
    ]);
  });

  it("lists graphic dirs under package CNext", () => {
    const dirs = inferGraphicResourceDirs(catDlg);
    expect(dirs).toContain(
      "PNXBomAnalysisWsp/PNXBomAnalysisFrm/CNext/resources/msgcatalog",
    );
    expect(dirs).toContain("PNXBomAnalysisWsp/PNXBomAnalysisFrm/CNext/resources/graphic");
  });
});
