import { computed, type Ref } from "vue";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { propEnum, propGroup, propReadonly, propSheet } from "../utils/pagePropertySchema";
import type { GitListViewMode } from "../utils/gitChangeView";
import type { GitChangesPayload, GitWorkspaceInfo } from "../types/gitWorkspace";

export function useGitPropertySheet(
  pageId: string,
  opts: {
    gitInfo: Ref<GitWorkspaceInfo | null>;
    changesPayload: Ref<GitChangesPayload | null>;
    loading: Ref<boolean>;
    loadError: Ref<string>;
    initLoading: Ref<boolean>;
    listViewMode: Ref<GitListViewMode>;
    onListViewModeChange: (mode: GitListViewMode) => void;
  },
) {
  const { gitInfo, changesPayload, loading, loadError, initLoading, listViewMode, onListViewModeChange } =
    opts;

  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        propGroup("intro", "说明", [
          propReadonly("plugin_phase", "阶段", {
            value: computed(() => "壳层 Git 插件预览（G1）"),
          }),
          propReadonly("main_actions", "本页操作", {
            value: computed(
              () => "已暂存 − 取消暂存；更改 / 未跟踪 + 暂存；侧栏填写说明并 Commit",
            ),
          }),
        ]),
        propGroup("env", "环境", [
          propReadonly("git_installed", "Git 程序", {
            value: computed(() => {
              if (!gitInfo.value) return loading.value ? "加载中…" : "—";
              return gitInfo.value.git_installed ? "已安装" : "未安装";
            }),
          }),
          propReadonly("page_state", "页面", {
            value: computed(() => {
              if (loadError.value) return "加载失败";
              if (loading.value) return "刷新中";
              if (initLoading.value) return "初始化 Git…";
              return "就绪";
            }),
          }),
        ]),
        propGroup("repo", "仓库", [
          propReadonly("repo_initialized", "状态", {
            value: computed(() => {
              if (!gitInfo.value) return "—";
              return gitInfo.value.repo_initialized ? "已初始化" : "未初始化";
            }),
          }),
          propReadonly("git_root", "Git 根", {
            value: computed(() => gitInfo.value?.git_root_display?.trim() || "—"),
            mono: true,
            hidden: computed(() => !gitInfo.value?.repo_initialized),
          }),
        ]),
        propGroup("changes", "变更统计", [
          propReadonly("staged_count", "已暂存", {
            value: computed(() => {
              if (!gitInfo.value?.repo_initialized) return "—";
              return changesPayload.value?.staged_count ?? 0;
            }),
          }),
          propReadonly("unstaged_count", "更改（工作区）", {
            value: computed(() => {
              if (!gitInfo.value?.repo_initialized) return "—";
              return changesPayload.value?.changes.length ?? 0;
            }),
            hint: "已跟踪文件的未暂存改动（不含未跟踪）",
          }),
          propReadonly("untracked_count", "未跟踪", {
            value: computed(() => {
              if (!gitInfo.value?.repo_initialized) return "—";
              return changesPayload.value?.untracked_count ?? 0;
            }),
          }),
          propReadonly("entries_total", "status 条目", {
            value: computed(() => {
              if (!gitInfo.value?.repo_initialized) return "—";
              return changesPayload.value?.entries.length ?? 0;
            }),
            hint: "git status --porcelain 解析行数（含 MM 双区）",
          }),
        ]),
        propGroup("display", "显示", [
          propEnum("list_view", "变更列表", {
            value: listViewMode,
            options: [
              { value: "file", label: "文件（仅文件名）" },
              { value: "tree", label: "树（按目录）" },
            ],
            onChange: (value) => onListViewModeChange(value as GitListViewMode),
            hint: "文件模式只显示文件名；树模式按目录折叠展示",
          }),
        ]),
        propGroup("scope", "范围", [
          propReadonly("scope_note", "操作范围", {
            value: computed(
              () => gitInfo.value?.scope_note?.trim() || "仅当前工作空间根；不含子模块",
            ),
          }),
          propReadonly("load_error", "最近错误", {
            value: computed(() => loadError.value.trim() || "—"),
            hidden: computed(() => !loadError.value.trim()),
          }),
        ]),
      ],
      { title: "Git", schemaVersion: 1 },
    ),
  );
}
