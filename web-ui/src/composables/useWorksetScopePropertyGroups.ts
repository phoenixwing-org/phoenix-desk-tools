import { computed } from "vue";
import { useWorksetPageScope } from "./useWorksetPageScope";
import { useFileWorksetsStore, type WorksetScopeMode } from "../stores/fileWorksets";
import { propEnum, propGroup, propPath, propReadonly } from "../utils/pagePropertySchema";
import type { PagePropertyGroup } from "../types/pageProperties";

const SCOPE_MODE_OPTIONS = [
  { value: "all", label: "全工作空间" },
  { value: "scope", label: "子目录" },
  { value: "index", label: "Code 索引 present" },
  { value: "workset", label: "工作集" },
] as const;

/** 工作集扫描范围 → 属性面板 1:1 字段（仅值；按钮走 Ribbon/页脚/主区） */
export function useWorksetScopePropertyGroups(
  pageId: string,
  opts?: { showIndexScope?: boolean },
) {
  const showIndexScope = opts?.showIndexScope ?? true;
  const store = useFileWorksetsStore();
  const pageScope = useWorksetPageScope(pageId);

  const scopeModeOptions = computed(() =>
    SCOPE_MODE_OPTIONS.filter((o) => showIndexScope || o.value !== "index").map((o) => ({
      value: o.value,
      label: o.label,
    })),
  );

  const worksetSelectOptions = computed(() => [
    { value: "", label: "（侧栏当前工作集）" },
    ...store.worksetOptions.map((o) => ({
      value: o.id,
      label: `${o.label}（${o.count}）`,
    })),
  ]);

  const worksetIdValue = computed({
    get: () => pageScope.worksetId.value ?? "",
    set: (v: string) => {
      pageScope.worksetId.value = v || null;
    },
  });

  const isSubdirMode = computed(() => pageScope.scopeMode.value === "scope");
  const isWorksetMode = computed(() => pageScope.scopeMode.value === "workset");

  const activeWorksetLabel = computed(() => store.activeWorkset?.name ?? "—");

  function onScopeModeChange(value: string) {
    const mode = value as WorksetScopeMode;
    pageScope.scopeMode.value = mode;
    if (mode === "workset" && !pageScope.worksetId.value && store.activeId) {
      pageScope.worksetId.value = store.activeId;
    }
  }

  function build(): PagePropertyGroup[] {
    return [
      propGroup("scope", "扫描范围", [
        propEnum("scope_mode", "范围模式", {
          value: computed(() => pageScope.scopeMode.value),
          options: scopeModeOptions.value,
          onChange: onScopeModeChange,
        }),
      ]),
      propGroup("scope_subdir", "子目录", [
        propPath("scope_path", "相对路径", {
          value: pageScope.scope,
          placeholder: "相对子目录",
          mono: true,
        }),
      ], { hidden: computed(() => !isSubdirMode.value) }),
      propGroup("scope_workset", "工作集", [
        propEnum("workset_id", "选择", {
          value: worksetIdValue,
          options: worksetSelectOptions.value,
          hint: "选「侧栏当前工作集」即跟随侧栏活动项；管理列表请用 Ribbon/页脚「工作集」",
        }),
        propReadonly("active_workset", "侧栏活动", {
          value: activeWorksetLabel,
          hint: "侧栏当前活动工作集；选「侧栏当前工作集」时使用",
        }),
      ], { hidden: computed(() => !isWorksetMode.value) }),
    ];
  }

  return build;
}
