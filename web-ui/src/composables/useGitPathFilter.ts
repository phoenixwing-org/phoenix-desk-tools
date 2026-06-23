import { computed, onMounted, ref, watch, type Ref } from "vue";
import {
  persistGitPathFilterTags,
  pushGitPathFilterHistory,
  readGitPathFilterHistory,
  readGitPathFilterTagSuggestions,
  readGitPathFilterTags,
} from "../utils/gitPathFilterPrefs";

/** Git 页路径筛选：session 恢复当前标签 · localStorage 历史与建议 */
export function useGitPathFilter(workspacePath: Ref<string>, filterTags: Ref<string[]>) {
  const refreshSnapshot = ref<string[]>([]);

  const filterHistory = computed(() => readGitPathFilterHistory(workspacePath.value));
  const tagSuggestions = computed(() => readGitPathFilterTagSuggestions(workspacePath.value));

  function hydrateFilters() {
    filterTags.value = readGitPathFilterTags(workspacePath.value);
    refreshSnapshot.value = [...filterTags.value];
  }

  function snapshotForRefresh() {
    refreshSnapshot.value = [...filterTags.value];
  }

  function restoreAfterRefresh() {
    filterTags.value = [...refreshSnapshot.value];
    persistGitPathFilterTags(workspacePath.value, filterTags.value);
  }

  watch(
    workspacePath,
    () => {
      hydrateFilters();
    },
    { immediate: true },
  );

  watch(
    filterTags,
    (tags) => {
      persistGitPathFilterTags(workspacePath.value, tags);
    },
    { deep: true },
  );

  function applyFilterSet(tags: string[]) {
    filterTags.value = [...tags];
    pushGitPathFilterHistory(workspacePath.value, tags);
  }

  function applySuggestion(tag: string) {
    const text = tag.trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (filterTags.value.some((t) => t.toLowerCase() === key)) return;
    filterTags.value = [...filterTags.value, text];
  }

  onMounted(() => {
    hydrateFilters();
  });

  return {
    filterHistory,
    tagSuggestions,
    hydrateFilters,
    snapshotForRefresh,
    restoreAfterRefresh,
    applyFilterSet,
    applySuggestion,
  };
}
