import { watch, type Ref } from "vue";
import { DEFAULT_APP_TITLE } from "../types/config";

const BASE_TITLE = DEFAULT_APP_TITLE;

export function useDocumentTitle(options: {
  workspaceShort: Ref<string>;
  workspacePath: Ref<string>;
  pageLabel: Ref<string | undefined>;
}) {
  function syncTitle() {
    const parts: string[] = [];
    if (options.workspacePath.value) {
      parts.push(options.workspaceShort.value);
    }
    if (options.pageLabel.value) {
      parts.push(options.pageLabel.value);
    }
    parts.push("Phoenix");
    document.title = parts.length > 1 ? parts.join(" · ") : BASE_TITLE;
  }

  watch(
    [options.workspaceShort, options.workspacePath, options.pageLabel],
    syncTitle,
    { immediate: true },
  );
}
