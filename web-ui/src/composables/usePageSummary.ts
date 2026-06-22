import { onUnmounted, watch, type WatchSource } from "vue";
import { useAppShell } from "./useAppShell";

/** 将页面摘要同步到底栏中间区；离开页面时自动清除。 */
export function usePageSummary(source: WatchSource<string>) {
  const shell = useAppShell();
  let last = "";

  watch(
    source,
    (value) => {
      last = value;
      shell.setPageSummary(value);
    },
    { immediate: true },
  );

  onUnmounted(() => {
    if (shell.pageSummary.value === last) {
      shell.setPageSummary("");
    }
  });
}
