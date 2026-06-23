import { ref } from "vue";
import {
  persistGitListViewMode,
  readGitListViewMode,
  type GitListViewMode,
} from "../utils/gitChangeView";

/** Git 页与侧栏提交区共享状态（KeepAlive 单页） */
const stagedCount = ref(0);
const gitReady = ref(false);
const commitMessage = ref("");
const commitPending = ref(false);
const listViewMode = ref<GitListViewMode>(readGitListViewMode());

let refreshHandler: (() => void | Promise<void>) | null = null;

export function useGitPageState() {
  function setGitPageSnapshot(opts: {
    stagedCount: number;
    gitReady: boolean;
  }) {
    stagedCount.value = opts.stagedCount;
    gitReady.value = opts.gitReady;
  }

  function registerGitRefresh(fn: () => void | Promise<void>) {
    refreshHandler = fn;
  }

  function unregisterGitRefresh(fn: () => void | Promise<void>) {
    if (refreshHandler === fn) refreshHandler = null;
  }

  async function requestGitRefresh() {
    if (refreshHandler) await refreshHandler();
  }

  function setListViewMode(mode: GitListViewMode) {
    listViewMode.value = mode;
    persistGitListViewMode(mode);
  }

  return {
    stagedCount,
    gitReady,
    commitMessage,
    commitPending,
    listViewMode,
    setGitPageSnapshot,
    setListViewMode,
    registerGitRefresh,
    unregisterGitRefresh,
    requestGitRefresh,
  };
}
