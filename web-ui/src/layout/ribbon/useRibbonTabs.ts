import { computed, ref, watch, type Ref } from "vue";
import type { NavItem } from "../../types/config";
import type { ModuleScope } from "../../constants/moduleScope";
import { ribbonTabIdForModuleScope } from "../../utils/moduleScopeNavigation";
import { RIBBON_SHELL_TAB_ID, RIBBON_TABS, type RibbonTabDef } from "./ribbonConfig";
import { WORKBENCH_IDLE_PAGE } from "../../constants/workbench";

export function useRibbonTabs(options: {
  navigation: Ref<NavItem[]>;
  currentPage: Ref<string>;
  enabledModules: Ref<string[]>;
  workbenchFocusScope?: Ref<ModuleScope>;
}) {
  const activeTab = ref(RIBBON_SHELL_TAB_ID);

  /** 从 navigation 动态生成 Ribbon Tab 配置 */
  const ribbonTabs = computed(() => RIBBON_TABS);

  const visibleTabs = computed(() =>
    ribbonTabs.value.filter((tab) => {
      if (!tab.module) return true;
      return options.enabledModules.value.includes(tab.module);
    }),
  );

  watch(
    visibleTabs,
    (tabs) => {
      if (!tabs.some((t) => t.id === activeTab.value)) {
        activeTab.value = tabs[0]?.id ?? RIBBON_SHELL_TAB_ID;
      }
    },
    { immediate: true },
  );

  const activeTabDef = computed(
    () => visibleTabs.value.find((t) => t.id === activeTab.value) ?? visibleTabs.value[0],
  );

  function tabForModule(module: string): RibbonTabDef | undefined {
    return visibleTabs.value.find((t) => t.module === module);
  }

  watch(
    options.currentPage,
    (page) => {
      if (page === WORKBENCH_IDLE_PAGE && options.workbenchFocusScope) {
        const tabId = ribbonTabIdForModuleScope(
          options.workbenchFocusScope.value,
          options.enabledModules.value,
        );
        if (visibleTabs.value.some((t) => t.id === tabId)) {
          activeTab.value = tabId;
        }
        return;
      }
      const nav = options.navigation.value.find((n) => n.page === page);
      const mod = nav?.module;
      if (mod) {
        const tab = tabForModule(mod);
        if (tab) activeTab.value = tab.id;
      } else if (
        page === "welcome" ||
        page === "home" ||
        page === "config" ||
        page === "git" ||
        page === "unit_tests" ||
        page === "test_fixtures"
      ) {
        activeTab.value = RIBBON_SHELL_TAB_ID;
      }
    },
    { immediate: true },
  );

  watch(
    () => options.workbenchFocusScope?.value,
    (scope) => {
      if (options.currentPage.value !== WORKBENCH_IDLE_PAGE || !scope) return;
      const tabId = ribbonTabIdForModuleScope(scope, options.enabledModules.value);
      if (visibleTabs.value.some((t) => t.id === tabId)) {
        activeTab.value = tabId;
      }
    },
  );

  return { activeTab, visibleTabs, activeTabDef };
}
