/** 对应 Python: test_bom_compute.py */

import { describe, it, expect } from "vitest";
import { buildBomForest, buildRefEdges } from "./pnwBomCompute";

describe("pnwBomCompute — BOM 森林构建", () => {
  it("buildBomForest: 简单两级装配", () => {
    const bomData: Record<string, any> = {
      "assy.FCStd": {
        bom: { PartNumber: "8001", PartVersion: "001" },
        xlinks: [{ file: "part.FCStd", label: "零件1" }],
      },
      "part.FCStd": {
        bom: { PartNumber: "8002", PartVersion: "001" },
        xlinks: [],
      },
    };
    const basenameMap = new Map<string, string[]>([
      ["assy.FCStd", ["assy.FCStd"]],
      ["part.FCStd", ["part.FCStd"]],
    ]);

    const result = buildBomForest(bomData, basenameMap);
    expect(Object.keys(result.roots).length).toBe(1);
    expect(result.roots["assy.FCStd"].partKey).toBe("8001.001");
    expect(result.roots["assy.FCStd"].children.length).toBe(1);
    expect(result.bomLines.length).toBe(1);
    expect(result.bomLines[0].part_key).toBe("8002.001");
  });

  it("buildBomForest: 空数据", () => {
    const result = buildBomForest({}, new Map());
    expect(Object.keys(result.roots).length).toBe(0);
    expect(result.bomLines.length).toBe(0);
  });

  it("buildRefEdges: 提取引用边", () => {
    const bomData: Record<string, any> = {
      "a.FCStd": { xlinks: [{ file: "b.FCStd" }] },
      "b.FCStd": { xlinks: [] },
    };
    const basenameMap = new Map([["b.FCStd", ["b.FCStd"]]]);
    const edges = buildRefEdges(bomData, basenameMap);
    expect(edges.length).toBe(1);
    expect(edges[0].hostRel).toBe("a.FCStd");
    expect(edges[0].targetRel).toBe("b.FCStd");
  });
});
