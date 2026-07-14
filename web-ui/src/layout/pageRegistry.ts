import { defineAsyncComponent, type Component } from "vue";

function lazyPage(loader: () => Promise<{ default: Component }>): Component {
  return defineAsyncComponent({ loader, timeout: 30_000 });
}

export const PAGE_COMPONENTS: Record<string, Component> = {
  home: lazyPage(() => import("../pages/HomePage.vue")),
  config: lazyPage(() => import("../pages/ConfigPage.vue")),
  git: lazyPage(() => import("../pages/GitPage.vue")),
  bom_apply: lazyPage(() => import("../pages/FileDetailPage.vue")),
  file_detail: lazyPage(() => import("../pages/FileDetailPage.vue")),
  file_rename: lazyPage(() => import("../pages/FileRenamePage.vue")),
  rename_analysis: lazyPage(() => import("../pages/FileRenamePage.vue")),
  fcstd_map: lazyPage(() => import("../pages/FcstdMapPage.vue")),
  part_catalog: lazyPage(() => import("../pages/PartCatalogPage.vue")),
  part_key_detail: lazyPage(() => import("../pages/PartKeyDetailPage.vue")),
  xlink_fix: lazyPage(() => import("../pages/XlinkFixPage.vue")),
  part_dedup: lazyPage(() => import("../pages/PartDedupPage.vue")),
  step_batch: lazyPage(() => import("../pages/StepBatchPage.vue")),
  sw_step_export: lazyPage(() => import("../pages/SwStepExportPage.vue")),
  reorder_members: lazyPage(() => import("../pages/ReorderMembersPage.vue")),
  code_index: lazyPage(() => import("../pages/CodeIndexPage.vue")),
  code_ignore: lazyPage(() => import("../pages/CodeIgnorePage.vue")),
  code_rename: lazyPage(() => import("../pages/CodeRenamePage.vue")),
  code_uuid: lazyPage(() => import("../pages/CodeUuidReplacePage.vue")),
  bom_export: lazyPage(() => import("../pages/BomExportPage.vue")),
  unit_tests: lazyPage(() => import("../pages/UnitTestsPage.vue")),
  test_fixtures: lazyPage(() => import("../pages/TestFixturesPage.vue")),
  caa_dialog_home: lazyPage(() => import("../pages/CaaDialogHomePage.vue")),
  caa_dialog: lazyPage(() => import("../pages/CaaDialogEditorPage.vue")),
};

export const PAGE_COMPONENT_IDS = new Set(Object.keys(PAGE_COMPONENTS));
