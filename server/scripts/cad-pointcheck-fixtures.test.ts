import { describe, expect, it } from "vitest";
import { parseCadPointcheckFixtures, readCadPointcheckFixtures } from "./cad-pointcheck-fixtures.js";

const manifest = { subdir: "fixtures", files: ["Root.ASSY.FCStd", "Block.FCStd", "Sheet.Drawing.FCStd", "A.FCStd", "B.FCStd"] };

describe("private pointcheck fixture manifest", () => {
  it("requires an explicit manifest before accessing any engineering input", () => {
    expect(() => readCadPointcheckFixtures(undefined, process.cwd())).toThrow("--fixture-manifest");
  });
  it("accepts only the five role inputs needed by the pointcheck", () => {
    expect(parseCadPointcheckFixtures(manifest)).toEqual(manifest);
  });
  it.each(["../private", "/private", "nested/path", "nested\\path", "C:private", ".."]) (
    "rejects non-local directory segment %s", subdir => {
      expect(() => parseCadPointcheckFixtures({ ...manifest, subdir })).toThrow();
    },
  );
  it.each([
    ["A.FCStd", "a.fcstd", "B.FCStd", "C.FCStd", "D.FCStd"],
    ["é.FCStd", "e\u0301.FCStd", "B.FCStd", "C.FCStd", "D.FCStd"],
    ["../A.FCStd", "B.FCStd", "C.FCStd", "D.FCStd", "E.FCStd"],
    ["A.FCStd"],
  ])("rejects unsafe, ambiguous or incomplete files [case %#]", (...files) => {
    expect(() => parseCadPointcheckFixtures({ ...manifest, files })).toThrow();
  });
});
