import { computed, ref, watch, type Ref } from "vue";
import type { NavItem } from "../../types/config";
import { RIBBON_TABS, type RibbonTabDef } from "./ribbonConfig";

export function useRibbonTabs(options: {
  navigation: Ref<NavItem[]>;
  currentPage: Ref<string>;
  enabledModules: Ref<string[]>;
}) {
  const activeTab = ref("start");

  const visibleTabs = computed(() =>
    RIBBON_TABS.filter((tab) => {
      if (!tab.module) return true;
      return options.enabledModules.value.includes(tab.module);
    }),
  );

  watch(
    visibleTabs,
    (tabs) => {
      if (!tabs.some((t) => t.id === activeTab.value)) {
        activeTab.value = tabs[0]?.id ?? "start";
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
      const nav = options.navigation.value.find((n) => n.page === page);
      const mod = nav?.module;
      if (mod) {
        const tab = tabForModule(mod);
        if (tab) activeTab.value = tab.id;
      } else if (page === "welcome" || page === "home" || page === "config") {
        activeTab.value = "start";
      } else if (page === "unit_tests") {
        activeTab.value = "system";
      }
    },
    { immediate: true },
  );

  return { activeTab, visibleTabs, activeTabDef };
}
