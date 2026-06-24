import { describe, it, expect } from "vitest";
import { patchCatDlgGridLayout } from "./patchCatDlg.js";

const SAMPLE = `// DO NOT EDIT :: THE CAA2 WIZARD WILL REPLACE ALL THE CODE HERE
CATDlgDialog PNXBomAnalysisDlg
{
  ROWRES = { 1 };
}
  STYLE = CATDlgWndBtnOKCancelPreview|CATDlgGridLayout;

CATDlgFrame FrameParams
{
  COLRES = { 1 };
}
  FATHER = PNXBomAnalysisDlg;
  STYLE = CATDlgFraNoFrame|CATDlgGridLayout;
  GRID = { 0, 0, 1, 1, CATGRID_4SIDES };

CATDlgLabel LabelFirstProduct
{
CATDlgLabel LabelFirstProduct
  FATHER = FrameParams;
  GRID = { 0, 0, 1, 1, CATGRID_4SIDES };
}

CATDlgSelectorList SelectorListFirstProduct
{
CATDlgSelectorList SelectorListFirstProduct
  FATHER = FrameParams;
  TH = 1;
  TW = 16;
  GRID = { 0, 1, 1, 1, CATGRID_4SIDES };
}

CATDlgFrame FrameBom
{
  ROWRES = { 0 };
  COLRES = { 0 };
}
  FATHER = PNXBomAnalysisDlg;
  STYLE = CATDlgFraNoFrame|CATDlgGridLayout;
  GRID = { 1, 0, 1, 1, CATGRID_4SIDES };
`;

describe("patchCatDlgGridLayout", () => {
  it("替换已有 ROWRES", () => {
    const result = patchCatDlgGridLayout(SAMPLE, [
      { nodeId: "PNXBomAnalysisDlg", rowResizable: [0, 1] },
    ]);
    expect(result).toContain("ROWRES = { 0, 1 };");
    expect(result).not.toContain("ROWRES = { 1 };");
  });

  it("替换已有 COLRES", () => {
    const result = patchCatDlgGridLayout(SAMPLE, [
      { nodeId: "FrameParams", colResizable: [1, 2] },
    ]);
    expect(result).toContain("COLRES = { 1, 2 };");
    expect(result).not.toContain("COLRES = { 1 };");
  });

  it("添加新的 ROWRES（原本没有）", () => {
    const result = patchCatDlgGridLayout(SAMPLE, [
      { nodeId: "FrameParams", rowResizable: [0] },
    ]);
    // FrameParams 没有 ROWRES，应新增一行
    expect(result).toMatch(/ROWRES = \{ 0 \};/);
    // COLRES 保留
    expect(result).toContain("COLRES = { 1 };");
  });

  it("多个容器同时打补丁", () => {
    const result = patchCatDlgGridLayout(SAMPLE, [
      { nodeId: "PNXBomAnalysisDlg", rowResizable: [0, 1] },
      { nodeId: "FrameBom", colResizable: [0, 1], rowResizable: [] },
    ]);
    expect(result).toContain("ROWRES = { 0, 1 };"); // Dialog 改了
    // FrameBom: ROWRES 空 → 删除，COLRES 变
    expect(result).toContain("COLRES = { 0, 1 };");
    expect(result).not.toMatch(/FrameBom[^}]*ROWRES/);
  });

  it("空数组 → 删除该行", () => {
    const result = patchCatDlgGridLayout(SAMPLE, [
      { nodeId: "FrameBom", rowResizable: [], colResizable: [] },
    ]);
    // FrameBom 原来有 ROWRES={0}, COLRES={0}，都应删除
    expect(result).not.toMatch(/FrameBom[^}]*ROWRES/);
    expect(result).not.toMatch(/FrameBom[^}]*COLRES/);
  });

  it("不匹配的 nodeId 不影响源文本", () => {
    const result = patchCatDlgGridLayout(SAMPLE, [
      { nodeId: "NonExistent", rowResizable: [0] },
    ]);
    // 应保留所有关键结构和声明
    expect(result).toContain("CATDlgDialog PNXBomAnalysisDlg");
    expect(result).toContain("ROWRES = { 1 };");
    expect(result).toContain("FATHER = FrameParams;");
    expect(result).toContain("CATDlgFrame FrameBom");
  });

  it("保持原文件的其他内容不变", () => {
    const result = patchCatDlgGridLayout(SAMPLE, [
      { nodeId: "FrameParams", colResizable: [1] },
    ]);
    expect(result).toContain("STYLE = CATDlgFraNoFrame|CATDlgGridLayout;");
    expect(result).toContain("GRID = { 0, 0, 1, 1, CATGRID_4SIDES };");
    expect(result).toContain("FATHER = PNXBomAnalysisDlg;");
  });

  it("处理重复声明行（CAA2 Wizard bug）", () => {
    // LabelFirstProduct 有重复声明行，应被跳过不影响解析
    const result = patchCatDlgGridLayout(SAMPLE, [
      { nodeId: "SelectorListFirstProduct", rowResizable: [0] },
    ]);
    expect(result).toContain("SelectorListFirstProduct");
    // 不应因为重复行而损坏
    expect(result).toMatch(/LabelFirstProduct[^}]*FATHER = FrameParams/);
  });
});
