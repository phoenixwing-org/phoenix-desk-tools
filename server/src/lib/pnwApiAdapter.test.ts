/** 接口规则测试 — 确保返回格式与 Python 接口 100% 一致 */

import { describe, it, expect } from "vitest";
import { toFcstdMapEntry, toPartKeyEntry, toBomHost } from "./pnwApiAdapter.js";

describe("pnwApiAdapter — Rust → Python 字段转换", () => {
  it("toFcstdMapEntry: snake_case → PascalCase BOM字段", () => {
    const rust = {
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
    const result = toFcstdMapEntry(rust);
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

  it("toPartKeyEntry: 零件号格式", () => {
    const rust = { part_number: "8001", part_version: "001", part_name: "滑轨", type_code: "H", model_series: "PX", file_count: 3 };
    const r = toPartKeyEntry(rust);
    expect(r.part_key).toBe("8001.001");
    expect(r.PartName).toBe("滑轨");
    expect(r.TypeCode).toBe("H");
    expect(r.files).toBe(3);
  });

  it("toBomHost: BOM 装配列表格式", () => {
    const rust = { host_rel: "./a.FCStd", host_filename: "a.FCStd", direct_children: 5, total_descendants: 20, incoming_count: 2, issues_count: 0 };
    const r = toBomHost(rust);
    expect(r.host_rel).toBe("./a.FCStd");
    expect(r.direct_children).toBe(5);
    expect(r.total_descendants).toBe(20);
  });

  it("toFcstdMapEntry: 处理缺失字段", () => {
    const rust = { repo_rel_path: "x", filename: "x.fcstd" };
    const r = toFcstdMapEntry(rust);
    expect(r.PartNumber).toBe("");
    expect(r.file_status).toBe("present");
  });
});
