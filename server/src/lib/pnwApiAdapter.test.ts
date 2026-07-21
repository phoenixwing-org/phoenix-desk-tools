/** 接口规则测试 — 确保返回格式与 Python 接口 100% 一致 */

import { describe, it, expect } from "vitest";
import { toFcstdMapEntry } from "./pnwApiAdapter.js";

describe("pnwApiAdapter — SQLite → 前端兼容字段转换", () => {
  it("toFcstdMapEntry: snake_case → PascalCase BOM字段", () => {
    const row = {
      repo_rel_path: "./零件/8001.001-H.FCStd",
      filename: "8001.001-H.FCStd",
      asset_kind: "fcstd",
      part_number: "8001",
      part_version: "001",
      type_code: "h",
      model_series: "PX",
      part_name: "滑轨",
      label: "8001.001-滑轨",
      file_status: "present",
    };
    const result = toFcstdMapEntry(row);
    // Python 接口规则：BOM 字段 PascalCase
    expect(result.PartNumber).toBe("8001");
    expect(result.PartVersion).toBe("001");
    expect(result.TypeCode).toBe("H");       // upper
    expect(result.ModelSeries).toBe("PX");   // upper
    expect(result.PartName).toBe("滑轨");
    expect(result.label).toBe("8001.001-滑轨");
    // 文件路径字段 snake_case 不变
    expect(result.repo_rel_path).toBe("./零件/8001.001-H.FCStd");
    expect(result.filename).toBe("8001.001-H.FCStd");
    expect(result.file_status).toBe("present");
  });

  it("toFcstdMapEntry: 处理缺失字段", () => {
    const row = { repo_rel_path: "x", filename: "x.fcstd" };
    const r = toFcstdMapEntry(row);
    expect(r.PartNumber).toBe("");
    expect(r.file_status).toBe("present");
  });
});
