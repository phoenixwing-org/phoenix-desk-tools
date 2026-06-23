import { describe, expect, it } from "vitest";
import {
  inferCatNlsRel,
  inferCatNlsRelCandidates,
  inferGraphicResourceDirs,
} from "../src/caaDialogPaths.js";

describe("inferCatNlsRelCandidates", () => {
  const catDlg =
    "PNXBomAnalysisWsp/PNXBomAnalysisFrm/PNXBomAnalysisUI.m/LocalInterfaces/PNXBomAnalysisDlg.CATDlg";

  it("prefers package-level CNext for PNX BOM layout", () => {
    const candidates = inferCatNlsRelCandidates(catDlg);
    expect(candidates[0]).toBe(
      "PNXBomAnalysisWsp/PNXBomAnalysisFrm/CNext/resources/msgcatalog/PNXBomAnalysisDlg.CATNls",
    );
    expect(candidates.length).toBe(1);
    expect(inferCatNlsRel(catDlg)).toBe(candidates[0]);
  });

  it("skips Frm sibling for .edu package layout", () => {
    const catDlg =
      "PNXCombinedCurveWsp/PNXCombinedCurve.edu/PNXCombinedCurveUI.m/LocalInterfaces/PNXSubCurveDlg.CATDlg";
    const candidates = inferCatNlsRelCandidates(catDlg);
    expect(candidates).toEqual([
      "PNXCombinedCurveWsp/PNXCombinedCurve.edu/CNext/resources/msgcatalog/PNXSubCurveDlg.CATNls",
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
