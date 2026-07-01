import { computed, type Ref } from "vue";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { pnwPropEnum, pnwPropGroup, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";
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

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("intro", "说明", [
          pnwPropReadonly("plugin_phase", "阶段", {
            value: computed(() => "壳层 Git 插件预览（G1）"),
          }),
          pnwPropReadonly("main_actions", "本页操作", {
            value: computed(
              () => "已暂存 − 取消暂存；更改 / 未跟踪 + 暂存；侧栏填写说明并 Commit",
            ),
          }),
        ]),
        pnwPropGroup("env", "环境", [
          pnwPropReadonly("git_installed", "Git 程序", {
            value: computed(() => {
              if (!gitInfo.value) return loading.value ? "加载中…" : "—";
              return gitInfo.value.git_installed ? "已安装" : "未安装";
            }),
          }),
          pnwPropReadonly("page_state", "页面", {
            value: computed(() => {
              if (loadError.value) return "加载失败";
              if (loading.value) return "刷新中";
              if (initLoading.value) return "初始化 Git…";
              return "就绪";
            }),
          }),
        ]),
        pnwPropGroup("repo", "仓库", [
          pnwPropReadonly("repo_initialized", "状态", {
            value: computed(() => {
              if (!gitInfo.value) return "—";
              return gitInfo.value.repo_initialized ? "已初始化" : "未初始化";
            }),
          }),
          pnwPropReadonly("git_root", "Git 根", {
            value: computed(() => gitInfo.value?.git_root_display?.trim() || "—"),
            mono: true,
            hidden: computed(() => !gitInfo.value?.repo_initialized),
          }),
        ]),
        pnwPropGroup("changes", "变更统计", [
          pnwPropReadonly("staged_count", "已暂存", {
            value: computed(() => {
              if (!gitInfo.value?.repo_initialized) return "—";
              return changesPayload.value?.staged_count ?? 0;
            }),
          }),
          pnwPropReadonly("unstaged_count", "更改（工作区）", {
            value: computed(() => {
              if (!gitInfo.value?.repo_initialized) return "—";
              return changesPayload.value?.changes.length ?? 0;
            }),
            hint: "已跟踪文件的未暂存改动（不含未跟踪）",
          }),
          pnwPropReadonly("untracked_count", "未跟踪", {
            value: computed(() => {
              if (!gitInfo.value?.repo_initialized) return "—";
              return changesPayload.value?.untracked_count ?? 0;
            }),
          }),
          pnwPropReadonly("entries_total", "status 条目", {
            value: computed(() => {
              if (!gitInfo.value?.repo_initialized) return "—";
              return changesPayload.value?.entries.length ?? 0;
            }),
            hint: "git status --porcelain 解析行数（含 MM 双区）",
          }),
        ]),
        pnwPropGroup("display", "显示", [
          pnwPropEnum("list_view", "变更列表", {
            value: listViewMode,
            options: [
              { value: "file", label: "文件（仅文件名）" },
              { value: "tree", label: "树（按目录）" },
            ],
            onChange: (value) => onListViewModeChange(value as GitListViewMode),
            hint: "文件模式只显示文件名；树模式按目录折叠展示",
          }),
        ]),
        pnwPropGroup("scope", "范围", [
          pnwPropReadonly("scope_note", "操作范围", {
            value: computed(
              () => gitInfo.value?.scope_note?.trim() || "仅当前工作空间根；不含子模块",
            ),
          }),
          pnwPropReadonly("load_error", "最近错误", {
            value: computed(() => loadError.value.trim() || "—"),
            hidden: computed(() => !loadError.value.trim()),
          }),
        ]),
      ],
      { title: "Git", schemaVersion: 1 },
    ),
  );
}
