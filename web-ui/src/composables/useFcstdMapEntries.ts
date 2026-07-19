import { computed, ref, watch, type Ref } from "vue";
import {
  fetchFcstdMapEntries,
  type FcstdMapEntriesPayload,
  type FcstdMapEntry,
} from "../api";
import {
  deriveFcstdMapEntryQuery,
  fcstdMapCurrentPage,
  fcstdMapIsPageSize,
  fcstdMapOffsetForPage,
  fcstdMapPageEnd,
  type FcstdMapKindFilter,
  type FcstdMapPageSize,
  type FcstdMapStatusFilter,
} from "../models/fcstdMapViewModel";

export interface UseFcstdMapEntriesOptions {
  readonly exists: Readonly<Ref<boolean>>;
  readonly fetchEntries?: (query: ReturnType<typeof deriveFcstdMapEntryQuery>) => Promise<FcstdMapEntriesPayload>;
  readonly onError?: (error: unknown) => void;
  readonly debounceMs?: number;
}

/** FCStd 索引列表 Controller；扫描任务、Shell 日志与工作集状态不进入此 composable。 */
export function useFcstdMapEntries(options: UseFcstdMapEntriesOptions) {
  const statusFilter = ref<FcstdMapStatusFilter>("all");
  const kindFilter = ref<FcstdMapKindFilter>("all");
  const searchQuery = ref("");
  const entries = ref<FcstdMapEntry[]>([]);
  const entriesTotal = ref(0);
  const pageOffset = ref(0);
  const pageSize = ref<FcstdMapPageSize>(20);
  const entriesLoading = ref(false);
  const debugSql = ref("");
  const fetchEntries = options.fetchEntries ?? fetchFcstdMapEntries;
  let searchDebounce: ReturnType<typeof setTimeout> | undefined;

  const pageEnd = computed(() => fcstdMapPageEnd(pageOffset.value, entries.value.length, entriesTotal.value));
  const currentPage = computed(() => fcstdMapCurrentPage(pageOffset.value, pageSize.value));

  function clear(): void {
    entries.value = [];
    entriesTotal.value = 0;
    debugSql.value = "";
  }

  async function load(): Promise<void> {
    if (!options.exists.value) {
      clear();
      return;
    }
    entriesLoading.value = true;
    try {
      const out = await fetchEntries(deriveFcstdMapEntryQuery({
        pageOffset: pageOffset.value,
        pageSize: pageSize.value,
        statusFilter: statusFilter.value,
        kindFilter: kindFilter.value,
        searchQuery: searchQuery.value,
      }));
      entries.value = out.entries;
      entriesTotal.value = out.total;
      debugSql.value = out.debug_sql;
    } catch (error) {
      clear();
      options.onError?.(error);
    } finally {
      entriesLoading.value = false;
    }
  }

  function onPagerCurrentChange(page: number): void {
    pageOffset.value = fcstdMapOffsetForPage(page, pageSize.value);
    void load();
  }

  function onPagerSizeChange(size: number): void {
    if (!fcstdMapIsPageSize(size)) return;
    pageSize.value = size;
    pageOffset.value = 0;
    void load();
  }

  function scheduleReload(resetPage = true): void {
    if (resetPage) pageOffset.value = 0;
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchDebounce = undefined;
      void load();
    }, options.debounceMs ?? 280);
  }

  const stopFilterWatch = watch([statusFilter, kindFilter], () => scheduleReload(true));
  const stopSearchWatch = watch(searchQuery, () => scheduleReload(true));

  function dispose(): void {
    stopFilterWatch();
    stopSearchWatch();
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = undefined;
  }

  return {
    statusFilter,
    kindFilter,
    searchQuery,
    entries,
    entriesTotal,
    pageOffset,
    pageSize,
    entriesLoading,
    debugSql,
    pageEnd,
    currentPage,
    load,
    onPagerCurrentChange,
    onPagerSizeChange,
    scheduleReload,
    dispose,
  };
}
