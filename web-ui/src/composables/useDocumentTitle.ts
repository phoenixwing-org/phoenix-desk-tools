import { watch, type Ref } from "vue";
import { DEFAULT_APP_TITLE } from "../types/config";

export function useDocumentTitle(options: {
  workspaceShort: Ref<string>;
  workspacePath: Ref<string>;
  pageLabel: Ref<string | undefined>;
}) {
  function syncTitle() {
    let title = DEFAULT_APP_TITLE;
    if (options.workspacePath.value) {
      title = `${DEFAULT_APP_TITLE} - ${options.workspaceShort.value}`;
    }
    const page = options.pageLabel.value;
    if (page && page !== "欢迎") {
      title = `${title} · ${page}`;
    }
    document.title = title;
  }

  watch(
    [options.workspaceShort, options.workspacePath, options.pageLabel],
    syncTitle,
    { immediate: true },
  );
}
