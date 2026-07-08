/** 对应 Python: test_part_naming.py + test_fcstd_mapping.py */

import { describe, it, expect } from "vitest";
import { normalizeRepoRel, inferPartKeyFromFilename, composeLabel, normXrefPath, GRAPH_TARGET_STATUSES } from "./pnwCadDb";

describe("pnwCadDb — fcstd_mapping 命名约定", () => {
  it("normalizeRepoRel: 加 ./ 前缀", () => {
    expect(normalizeRepoRel("零件/a.FCStd")).toBe("./零件/a.FCStd");
    expect(normalizeRepoRel("./零件/a.FCStd")).toBe("./零件/a.FCStd");
    expect(normalizeRepoRel("/abs/path")).toBe("/abs/path");
    expect(normalizeRepoRel("../up/a.FCStd")).toBe("../up/a.FCStd");
  });

  it("inferPartKeyFromFilename: 解析 6+3 零件号", () => {
    expect(inferPartKeyFromFilename("800001.001-H-名称.FCStd")).toEqual({ part_number: "800001", part_version: "001" });
    expect(inferPartKeyFromFilename("abc.FCStd")).toBeNull();
  });

  it("composeLabel: PartNumber.PartVersion-名称", () => {
    expect(composeLabel("8001", "001", "滑轨", "fallback")).toBe("8001.001-滑轨");
    expect(composeLabel("", "001", "滑轨", "fallback")).toBeNull();
    expect(composeLabel("8001", "", "", "fallback")).toBeNull();
  });
});

describe("pnwCadDb — cad_index/common 常量", () => {
  it("GRAPH_TARGET_STATUSES", () => {
    expect(GRAPH_TARGET_STATUSES).toContain("resolved");
    expect(GRAPH_TARGET_STATUSES).toContain("ambiguous");
  });

  it("normXrefPath", () => {
    expect(normXrefPath("a\\b.FCStd")).toBe("a/b.FCStd");
    expect(normXrefPath(null)).toBeNull();
    expect(normXrefPath("  a/b  ")).toBe("a/b");
  });
});
