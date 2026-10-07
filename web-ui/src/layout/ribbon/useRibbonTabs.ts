import { computed, ref, watch, type Ref } from "vue";
import type { NavItem } from "../../types/config";
import type { ModuleScope } from "../../constants/moduleScope";
import { ribbonTabIdForModuleScope } from "../../utils/moduleScopeNavigation";
import { buildRibbonTabs, RIBBON_SHELL_TAB_ID, type RibbonTabDef } from "./ribbonConfig";
import { WORKBENCH_IDLE_PAGE } from "../../constants/workbench";
import { CAA_EDITOR_PAGE_ID, CAA_HOME_PAGE_ID } from "../../constants/caaPages";

export function useRibbonTabs(options: {
  navigation: Ref<NavItem[]>;
  currentPage: Ref<string>;
  enabledModules: Ref<string[]>;
  workbenchFocusScope?: Ref<ModuleScope>;
}) {
  const activeTab = ref(RIBBON_SHELL_TAB_ID);

  // Domain preferences stay independent even though both domains share one
  // presentation tab. Filter before grouping so code-only workspaces keep it.
  const visibleTabs = computed(() => buildRibbonTabs(options.navigation.value.filter((nav) =>
    !nav.module || options.enabledModules.value.includes(nav.module),
  )));

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

  function tabForPage(page: string): RibbonTabDef | undefined {
    const navPage = page === CAA_EDITOR_PAGE_ID ? CAA_HOME_PAGE_ID : page;
    const directlyListed = visibleTabs.value.find((tab) =>
      tab.groups.some((group) => group.items.some((item) => item.pageId === navPage)),
    );
    if (directlyListed) return directlyListed;

    // Context-only CAD documents have no Ribbon button but retain their domain.
    const module = options.navigation.value.find((nav) => nav.page === page)?.module;
    if (!module) return undefined;
    if (module !== "cad" && module !== "code") {
      return visibleTabs.value.find((tab) => tab.module === module);
    }
    const tabId = ribbonTabIdForModuleScope(module, options.enabledModules.value);
    return visibleTabs.value.find((tab) => tab.id === tabId);
  }

  watch(
    [options.currentPage, visibleTabs],
    ([page]) => {
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
      const tab = tabForPage(page);
      if (tab) {
        activeTab.value = tab.id;
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
