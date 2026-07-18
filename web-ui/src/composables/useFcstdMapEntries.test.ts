import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { useFcstdMapEntries } from "./useFcstdMapEntries";

function payload(total = 1) {
  return {
    offset: 0,
    limit: 20,
    total,
    count: total,
    debug_sql: "SELECT * FROM phoenix_cad_file_asset",
    entries: total ? [{
      repo_rel_path: "parts/Demo.FCStd",
      filename: "Demo.FCStd",
      asset_kind: "fcstd",
      PartNumber: "PN-01",
      PartVersion: "A",
      TypeCode: "Part",
      ModelSeries: "M1",
      PartName: "Demo",
      label: "Demo",
      file_status: "present" as const,
      last_seen_at: "2026-07-18T00:00:00Z",
    }] : [],
  };
}

describe("useFcstdMapEntries", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("通过注入 fetch port 加载列表并投影分页状态", async () => {
    const fetchEntries = vi.fn().mockResolvedValue(payload());
    const controller = useFcstdMapEntries({ exists: ref(true), fetchEntries });
    controller.statusFilter.value = "missing";
    controller.kindFilter.value = "fcstd";
    controller.searchQuery.value = "Demo";
    await controller.load();
    expect(fetchEntries).toHaveBeenCalledWith({
      offset: 0, limit: 20, status: "missing", kind: "fcstd", search: "Demo",
    });
    expect(controller.entries.value).toHaveLength(1);
    expect(controller.entriesTotal.value).toBe(1);
    expect(controller.currentPage.value).toBe(1);
    expect(controller.pageEnd.value).toBe(1);
    expect(controller.entriesLoading.value).toBe(false);
    controller.dispose();
  });

  it("筛选变化共用单一 debounce，pager 立即加载且拒绝未知 page size", async () => {
    vi.useFakeTimers();
    const fetchEntries = vi.fn().mockResolvedValue(payload(0));
    const controller = useFcstdMapEntries({ exists: ref(true), fetchEntries, debounceMs: 280 });
    controller.pageOffset.value = 100;
    controller.statusFilter.value = "present";
    controller.searchQuery.value = "pump";
    await nextTick();
    expect(controller.pageOffset.value).toBe(0);
    await vi.advanceTimersByTimeAsync(279);
    expect(fetchEntries).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchEntries).toHaveBeenCalledTimes(1);

    controller.onPagerCurrentChange(3);
    await nextTick();
    expect(controller.pageOffset.value).toBe(40);
    expect(fetchEntries).toHaveBeenCalledTimes(2);
    controller.onPagerSizeChange(25);
    expect(controller.pageSize.value).toBe(20);
    controller.onPagerSizeChange(50);
    await nextTick();
    expect(controller.pageSize.value).toBe(50);
    expect(controller.pageOffset.value).toBe(0);
    controller.dispose();
  });

  it("索引不存在或请求失败时清空旧列表，并只通过错误端口上报", async () => {
    const exists = ref(true);
    const onError = vi.fn();
    const fetchEntries = vi.fn()
      .mockResolvedValueOnce(payload())
      .mockRejectedValueOnce(new Error("offline"));
    const controller = useFcstdMapEntries({ exists, fetchEntries, onError });
    await controller.load();
    expect(controller.entries.value).toHaveLength(1);
    await controller.load();
    expect(controller.entries.value).toEqual([]);
    expect(controller.entriesTotal.value).toBe(0);
    expect(controller.debugSql.value).toBe("");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }));
    exists.value = false;
    await controller.load();
    expect(fetchEntries).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
});
