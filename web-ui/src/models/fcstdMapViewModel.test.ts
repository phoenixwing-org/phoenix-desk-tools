import { describe, expect, it } from "vitest";
import {
  deriveFcstdMapEntryQuery,
  fcstdMapAssetKindLabel,
  fcstdMapCanOpenFileDetail,
  fcstdMapCurrentPage,
  fcstdMapMetaCell,
  fcstdMapOffsetForPage,
  fcstdMapPageEnd,
  fcstdMapPartKeyLabel,
  fcstdMapRelativeDirectory,
  fcstdMapStatusLabel,
  hydrateFcstdMapPageSession,
  serializeFcstdMapPageSession,
  type FcstdMapEntryViewInput,
  type FcstdMapPageSessionState,
} from "./fcstdMapViewModel";

const entry: FcstdMapEntryViewInput = {
  repo_rel_path: "parts\\demo.FCStd",
  filename: "demo.FCStd",
  asset_kind: "fcstd",
  PartNumber: "PN-01",
  PartVersion: "A",
  TypeCode: "Part",
  ModelSeries: "M1",
  PartName: "演示件",
  label: "Demo",
  file_status: "present",
};

const current: FcstdMapPageSessionState = {
  subTab: "index",
  forceUpdatePartName: false,
  statusFilter: "all",
  kindFilter: "all",
  searchQuery: "",
  pageOffset: 0,
  pageSize: 20,
};

describe("FCStd map view model", () => {
  it("冻结索引行标签、PartKey、目录、摘要和可打开规则", () => {
    expect(fcstdMapAssetKindLabel(entry)).toBe("FCStd");
    expect(fcstdMapStatusLabel(entry)).toBe("存在");
    expect(fcstdMapPartKeyLabel(entry)).toBe("PN-01.A");
    expect(fcstdMapRelativeDirectory(entry)).toBe("parts");
    expect(fcstdMapMetaCell(entry)).toBe("PN-01 · A · Part · M1 · 演示件 · Demo");
    expect(fcstdMapCanOpenFileDetail(entry)).toBe(true);
    expect(fcstdMapCanOpenFileDetail({ ...entry, asset_kind: "image", filename: "demo.png" })).toBe(false);
    expect(fcstdMapCanOpenFileDetail({ ...entry, file_status: "missing" })).toBe(false);
  });

  it("集中分页与查询投影，保留后端过滤协议", () => {
    expect(fcstdMapCurrentPage(100, 50)).toBe(3);
    expect(fcstdMapPageEnd(100, 12, 108)).toBe(108);
    expect(fcstdMapOffsetForPage(3, 50)).toBe(100);
    expect(deriveFcstdMapEntryQuery({
      pageOffset: 100,
      pageSize: 50,
      statusFilter: "missing",
      kindFilter: "pdf",
      searchQuery: " pump ",
    })).toEqual({ offset: 100, limit: 50, status: "missing", kind: "pdf", search: " pump " });
  });

  it("兼容 v2-v4 session，并拒绝未知版本而不污染当前状态", () => {
    const hydrated = hydrateFcstdMapPageSession({
      v: 2,
      subTab: "settings",
      forceUpdatePartName: true,
      statusFilter: "missing",
      kindFilter: "image",
      searchQuery: 123,
      pageOffset: -4,
      pageSize: 100,
    }, current);
    expect(hydrated).toEqual({
      subTab: "settings",
      forceUpdatePartName: true,
      statusFilter: "missing",
      kindFilter: "image",
      searchQuery: "123",
      pageOffset: 0,
      pageSize: 100,
    });
    expect(serializeFcstdMapPageSession(hydrated!)).toEqual({ v: 4, ...hydrated });
    expect(hydrateFcstdMapPageSession({ v: 5, statusFilter: "missing" }, current)).toBeUndefined();
    expect(hydrateFcstdMapPageSession({ v: 4, kindFilter: "unknown", pageSize: 25 }, current)).toEqual(current);
  });
});
