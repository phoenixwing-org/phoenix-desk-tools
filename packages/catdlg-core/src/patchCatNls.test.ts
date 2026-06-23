import { describe, expect, it } from "vitest";
import { patchCatNls } from "./patchCatNls.js";

const SAMPLE = `// header
// DO NOT EDIT :: THE CAA2 WIZARD WILL REPLACE ALL THE CODE HERE
Title = "PNX Curve Division";
FrameParams.LabelBaseCurve.Title = "Base Curve";
// END WIZARD REPLACEMENT ZONE
`;

describe("patchCatNls", () => {
  it("updates existing keys and preserves comments", () => {
    const out = patchCatNls(SAMPLE, {
      Title: "PNX Curve Division 2",
      "FrameParams.LabelBaseCurve.Title": "Base Curve",
    });
    expect(out).toContain("Title = \"PNX Curve Division 2\";");
    expect(out).toContain("// header");
    expect(out).toContain("END WIZARD");
  });

  it("appends new keys before END WIZARD zone", () => {
    const out = patchCatNls(SAMPLE, {
      Title: "PNX Curve Division",
      "FrameParams.LabelBaseCurve.Title": "Base Curve",
      "FrameParams.LabelPointCount.Title": "Point Count",
    });
    expect(out).toContain("FrameParams.LabelPointCount.Title = \"Point Count\";");
    const endIdx = out.indexOf("END WIZARD");
    const newIdx = out.indexOf("FrameParams.LabelPointCount.Title");
    expect(newIdx).toBeGreaterThan(0);
    expect(newIdx).toBeLessThan(endIdx);
  });
});
