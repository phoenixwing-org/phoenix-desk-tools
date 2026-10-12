import { describe, expect, it } from "vitest";
import { assertValidPartName, bomNameSource, recommendPartName } from "./bomNameRecommendation.js";
const rel = "parts/720421.003-H-DEMO-PLATE.FCStd";
describe("PartName first with selectable missing-name source", () => {
  it.each(["", " \t ", "S", " s ", "H", "a", "Z", "Ｓ", "S.ASSY", "a.assy.ASSY"])("rejects blank or single-letter business name %j", name => {
    expect(() => assertValidPartName(name)).toThrow(/为空或仅为一个英文字母/);
  });
  it.each(["轴", "M6螺栓", "S型支架", "S-夹具", "AB", "A1"])("allows genuine names %s", PartName => {
    expect(recommendPartName(rel, { PartName }).value).toBe(PartName);
  });
  it.each(["label", "filename"] as const)("does not rescue a single-letter property from another source in %s mode", source => {
    expect(() => recommendPartName(rel, { PartName: "S", label: "720421.003-有效标签名" }, source)).toThrow(/属性 PartName/);
  });
  it.each(["720421.003-S", "720421.003-a.ASSY", "720421.003-", "S", " H "])("rejects invalid names extracted from label %j instead of falling back", label => {
    expect(() => recommendPartName(rel, { PartName: "", label })).toThrow(/标签名.*为空或仅为一个英文字母/);
  });
  it.each(["S", "a", ""])("rejects invalid names from filename %j", name => {
    expect(() => recommendPartName(`parts/720421.003-S-${name}.FCStd`, { label: "" }, "filename")).toThrow(/文件名.*为空或仅为一个英文字母/);
  });
  it.each(["label", "filename"] as const)("keeps the explicit property in %s mode", source => {
    expect(recommendPartName(rel, { PartName: "手工名称", label: "720421.003-标签名" }, source)).toEqual({ value: "手工名称", source_note: "属性 PartName" });
  });
  it.each([
    ["720421.003-测试面板-甲", "测试面板-甲"], ["720421.003-H-DEMO-测试面板-甲", "测试面板-甲"],
    ["测试面板--甲.v2", "测试面板--甲.v2"], ["720421.003-H-梁", "H-梁"],
    ["720421.003-EAR-SIDE-A", "EAR-SIDE-A"], ["H-DEMO-侧板", "H-DEMO-侧板"],
  ])("extracts %s without swallowing name segments", (label, value) => {
    expect(recommendPartName(rel, { label }).value).toBe(value);
  });
  it("allows a filename choice and falls back to it only when the label is empty", () => {
    expect(recommendPartName(rel, { label: "中文标签" }, "filename").value).toBe("PLATE");
    expect(recommendPartName(rel, { label: "  " }).value).toBe("PLATE");
  });
  it.each(["Body", "Body001"])("uses a plain filename instead of the saved default Body label %s", objectName => {
    const context = { objectName, typeId: "PartDesign::Body" };
    expect(recommendPartName("测试盖板.FCStd", { label: objectName }, "label", context)).toEqual({ value: "测试盖板", source_note: "默认节点标签，从文件名补全" });
    expect(recommendPartName(rel, { label: objectName }, "label", context).value).toBe("PLATE");
    expect(recommendPartName(rel, { PartName: "自定义属性名称", label: objectName }, "label", context).value).toBe("自定义属性名称");
    expect(() => recommendPartName(rel, { PartName: "S", label: objectName }, "label", context)).toThrow(/属性 PartName/);
  });
  it.each(["App::Part", "Assembly::AssemblyObject", "", undefined])("does not discard a custom Body label for other/unknown type %s", typeId => {
    expect(recommendPartName(rel, { label: "Body" }, "label", { objectName: "Body", typeId }).value).toBe("Body");
  });
  it.each(["Body flange", "Body-Panel", "测试面板"])("preserves the custom Body label %s", label => {
    expect(recommendPartName(rel, { label }, "label", { objectName: "Body", typeId: "PartDesign::Body" }).value).toBe(label);
  });
  it("requires exact default node identity, not just a Body-like display name", () => {
    expect(recommendPartName(rel, { label: "Body" }, "label", { objectName: "Panel", typeId: "PartDesign::Body" }).value).toBe("Body");
    expect(recommendPartName(rel, { label: "Body" }).value).toBe("Body");
  });
  it("allows an explicit row source to replace only the name recommendation", () => {
    const current = { PartName: "已有名称", label: "720421.003-节点面板" };
    expect(recommendPartName(rel, current, "filename", { explicitSource: true })).toEqual({ value: "PLATE", source_note: "文件名" });
    expect(recommendPartName(rel, current, "label", { explicitSource: true })).toEqual({ value: "节点面板", source_note: "标签名" });
    expect(current).toEqual({ PartName: "已有名称", label: "720421.003-节点面板" });
    expect(() => recommendPartName(rel, { label: "Body" }, "label", { objectName: "Body", typeId: "PartDesign::Body", explicitSource: true })).toThrow(/节点标签为空或为默认 Body/);
    expect(() => recommendPartName(rel, { label: "" }, "label", { explicitSource: true })).toThrow(/节点标签为空/);
    expect(() => recommendPartName(rel, { label: "S" }, "label", { explicitSource: true })).toThrow(/仅为一个英文字母/);
  });
  it("normalizes one assembly suffix and handles standard parts", () => {
    expect(recommendPartName("720421.003-H-DEMO-PLATE.ASSY.FCStd", { label: "720421.003-测试总成.ASSY.ASSY" }).value).toBe("测试总成");
    expect(recommendPartName("720421.003-S-M6-BOLT.FCStd", { label: "720421.003-S-M6-螺栓" }).value).toBe("M6-螺栓");
  });
  it.each([".FCStd", ".ASSY.FCStd"])("excludes assembly suffix from PartName even for a legacy filename ending in %s", extension => {
    const file = `parts/720422.003-H-DEMO-FRAME${extension}`;
    expect(recommendPartName(file, { label: "720422.003-测试框架装配.ASSY" }).value).toBe("测试框架装配");
    expect(recommendPartName(file, { PartName: "测试框架装配.assy.ASSY", label: "其他标签" }, "filename").value).toBe("测试框架装配");
    expect(recommendPartName(file, { label: "720422.003-测试框架.ASSY.说明" }).value).toBe("测试框架.ASSY.说明");
  });
  it("defaults to label and rejects unknown modes", () => {
    expect(bomNameSource(undefined)).toBe("label");
    expect(() => bomNameSource("index")).toThrow(/来源/);
  });
});
