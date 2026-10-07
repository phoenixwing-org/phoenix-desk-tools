import { describe, expect, it } from "vitest";
import { pnwInferBomFieldsFromFilename, type PnwCadEmbeddedBomFields } from "@phoenix-wing/cad-core";
import { proposeNameNormalization } from "./proposal.js";

const current: PnwCadEmbeddedBomFields = { PartNumber: "710031", PartVersion: "001", TypeCode: "H", ModelSeries: "DEMO", PartName: "测试块-工序A", label: "710031.001-H-DEMO-测试块-工序A" };
function propose(overrides: Partial<PnwCadEmbeddedBomFields> = {}, filename = "710031.001-H-DEMO-测试块-工序A.FCStd", index: Record<string, unknown> = {}, source: "label" | "filename" = "label") {
  return proposeNameNormalization(`parts/${filename}`, { ...current, ...overrides }, {}, { index, filename: pnwInferBomFieldsFromFilename(filename) }, source);
}

describe("name normalization uses embedded PartName before filename", () => {
  it.each(["S", " s ", "A", "z.ASSY"])("blocks suspect property %j even with valid label and filename", PartName => {
    for (const source of ["label", "filename"] as const) expect(() => propose({ PartName }, undefined, {}, source)).toThrow(/属性 PartName.*一个英文字母/);
  });
  it.each(["710031.001-S", "710031.001-", "710031.001-a.ASSY"])("blocks suspect extracted label %s", label => {
    expect(() => propose({ PartName: "", label })).toThrow(/标签名.*为空或仅为一个英文字母/);
  });
  it.each([
    ["710031", "测试块-工序A"], ["710031", "测试块-工序B"], ["710031", "测试块-工序C"],
    ["710045", "示例支架"], ["710062", "示例面板-A"],
  ])("does not put type/model into %s %s PartName", (number, name) => {
    const filename = `${number}.001-H-DEMO-${name}.FCStd`;
    expect(propose({ PartNumber: number, PartName: name, label: `${number}.001-H-DEMO-${name}` }, filename)).toMatchObject({ PartName: name, label: `${number}.001-${name}`, filename, warnings: [] });
  });
  it.each(["测试块-工序A", "TEST-PLATE-A", "测试块--工序A", "H-梁", "前缀-H-DEMO-侧板", "Plate.v2-A"])("preserves plain and full Label name punctuation: %s", name => {
    const filename = `710031.001-H-DEMO-${name}.FCStd`;
    for (const prefix of ["", "H-DEMO-"]) {
      expect(propose({ PartName: name, label: `710031.001-${prefix}${name}` }, filename)).toMatchObject({ PartName: name, label: `710031.001-${name}`, filename });
    }
  });
  it("preserves a genuine name that starts with the metadata prefix", () => {
    expect(propose({ PartName: "H-DEMO-Bracket", label: "710031.001-H-DEMO-Bracket" }, "710031.001-H-DEMO-H-DEMO-Bracket.FCStd")).toMatchObject({ PartName: "H-DEMO-Bracket", label: "710031.001-H-DEMO-Bracket" });
  });
  it("never copies an extra metadata prefix from Label", () => {
    expect(propose({ PartName: "H-DEMO-Bracket", label: "710031.001-H-DEMO-H-DEMO-Bracket" }, "710031.001-H-DEMO-H-DEMO-Bracket.FCStd").PartName).toBe("H-DEMO-Bracket");
  });
  it.each(["总成", "总成.ASSY", "总成.assy.ASSY"])("keeps pure assembly PartName and exactly one Label suffix for %s", name => {
    expect(propose({ PartName: name, label: `710031.001-H-DEMO-${name}` }, "710031.001-H-DEMO-总成.ASSY.FCStd")).toMatchObject({ PartName: "总成", label: "710031.001-总成.ASSY", filename: "710031.001-H-DEMO-总成.ASSY.FCStd" });
  });
  it("keeps standard-part name segments after the type prefix", () => {
    expect(propose({ TypeCode: "S", ModelSeries: "", PartName: "M6X12-Bolt", label: "710031.001-S-M6X12-Bolt" }, "710031.001-S-M6X12-Bolt.FCStd")).toMatchObject({ PartName: "M6X12-Bolt", label: "710031.001-M6X12-Bolt" });
  });
  it.each([".FCStd", ".ASSY.FCStd"])("extracts a pure assembly name from Label when PartName is missing in %s", suffix => {
    expect(propose({ PartName: "", label: "710031.001-测试框架装配.ASSY" }, `710031.001-H-DEMO-FRAME${suffix}`)).toMatchObject({ PartName: "测试框架装配", label: "710031.001-测试框架装配.ASSY", filename: "710031.001-H-DEMO-测试框架装配.ASSY.FCStd" });
  });
  it.each(["710031.001-R-DEMO-测试块", "710031.001-H-ALT-测试块", "710031.001-H-DEMO", "任意显示标签", "", "999999.999-旧标签"])("ignores outdated or noncanonical Label %s", label => {
    expect(propose({ label })).toMatchObject({ PartName: current.PartName, label: "710031.001-测试块-工序A" });
  });
  it("keeps explicit PartName even when filename, Label and index name all disagree", () => {
    expect(propose({ PartName: "手工名称-甲", label: "710031.001-标签旧名" }, undefined, { PartName: "索引旧名" })).toMatchObject({ PartName: "手工名称-甲", label: "710031.001-手工名称-甲", filename: "710031.001-H-DEMO-手工名称-甲.FCStd", warnings: [] });
  });
  it.each(["", "  "])("uses the selected fallback only for blank PartName %j", PartName => {
    const values = { PartName, label: "710031.001-标签名称" };
    expect(propose(values, undefined, { PartName: "索引名称" })).toMatchObject({ PartName: "标签名称", warnings: [expect.stringContaining("从标签名补全")] });
    expect(propose(values, undefined, { PartName: "索引名称" }, "filename")).toMatchObject({ PartName: "测试块-工序A", label: "710031.001-测试块-工序A", warnings: [expect.stringContaining("从文件名补全")] });
  });
  it("blocks unsafe label names instead of silently falling back to a different name", () => {
    expect(() => propose({ PartName: "", label: "710031.001-bad/name" })).toThrow(/名称为空或包含不安全/);
  });
  it.each(["bad/name", "bad:name", "..", "name.FCStd"])("does not silently replace an invalid explicit PartName %s with a filename name", PartName => {
    expect(() => propose({ PartName })).toThrow(/属性 PartName/);
  });
  it("does not treat a non-string PartName property as unset", () => {
    expect(() => proposeNameNormalization("part.FCStd", { ...current, PartName: "" }, { PartName: "App::PropertyInteger" }, { filename: { PartName: "name" }, index: {} })).toThrow(/PartName 不是字符串/);
  });
  it("retains index metadata conflict protection", () => {
    expect(() => propose({}, undefined, { ModelSeries: "ALT" })).toThrow(/ModelSeries .*冲突/);
  });
});
