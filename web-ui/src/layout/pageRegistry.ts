import { defineAsyncComponent, type Component } from "vue";
import { createRetryableSharedLoader } from "./asyncViewSwitch";

const componentPreloads = new Map<Component, () => Promise<unknown>>();

function lazyPage(loader: () => Promise<{ default: Component }>): Component {
  const sharedLoader = createRetryableSharedLoader(loader);
  const component = defineAsyncComponent({ loader: sharedLoader, timeout: 30_000 });
  componentPreloads.set(component, sharedLoader);
  return component;
}

const genericPrimaryBlock = lazyPage(() => import("../components/primary/GenericPagePrimaryBlock.vue"));

export type PageContribution = {
  view: Component;
  sideBlock?: Component;
  /** Ribbon / 页脚用于区分不同工具 Block 的短名称。 */
  sideBlockLabel?: string;
};

/** Shell 传给页面 sideBlock 的稳定宿主上下文；多 Tab 工具可据此隔离状态。 */
export type PageSideBlockHostProps = {
  pageId?: string;
  workbenchTabId?: string;
};

/**
 * Workbench 页面贡献的唯一登记点。
 *
 * 所有页面都提供 VS Code 式 Primary + View；有专用 Primary 的页面使用专用 Block，
 * 其余页面由通用 Primary 承接页面上下文，没有专属控件时显示说明文字。
 * Shell 只消费派生注册表，不感知具体业务页面。
 */
const pageContributions = {
  home: { view: lazyPage(() => import("../pages/HomePage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "主页 Primary" },
  audio_extract: { view: lazyPage(() => import("../features/audio-extractor/AudioExtractPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "音频提取 Primary" },
  config: { view: lazyPage(() => import("../pages/ConfigPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "配置 Primary" },
  git: { view: lazyPage(() => import("../pages/GitPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "Git Primary" },
  bom_apply: { view: lazyPage(() => import("../pages/FileDetailPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "文件 Primary" },
  file_detail: { view: lazyPage(() => import("../pages/FileDetailPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "文件 Primary" },
  file_rename: { view: lazyPage(() => import("../pages/FileRenamePage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "改名 Primary" },
  rename_analysis: { view: lazyPage(() => import("../pages/FileRenamePage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "改名 Primary" },
  part_catalog: { view: lazyPage(() => import("../pages/PartCatalogPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "零件目录 Primary" },
  cad_index: { view: lazyPage(() => import("../pages/CadIndexPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "CAD 索引 Primary" },
  part_key_detail: { view: lazyPage(() => import("../pages/PartKeyDetailPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "零件 Primary" },
  cad_batch_tools: { view: lazyPage(() => import("../pages/CadBatchToolsPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "批量工具 Primary" },
  batch_attributes: { view: lazyPage(() => import("../pages/BatchAttributesPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "批量工具 Primary" },
  name_normalize: { view: lazyPage(() => import("../features/cad-name-normalize/NameNormalizePage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "批量工具 Primary" },
  document_sync: { view: lazyPage(() => import("../features/document-sync/DocumentSyncPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "文档同步 Primary" },
  rename_tasks: { view: lazyPage(() => import("../features/batch-rename/RenameTasksPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "改名任务 Primary" },
  assembly_labels: { view: lazyPage(() => import("../features/cad-assembly-labels/AssemblyLabelsPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "批量工具 Primary" },
  part_gallery: { view: lazyPage(() => import("../features/part-gallery/PartGalleryPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "图册 Primary" },
  xlink_fix: { view: lazyPage(() => import("../pages/XlinkFixPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "错误修正 Primary" },
  part_dedup: { view: lazyPage(() => import("../pages/PartDedupPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "查重 Primary" },
  step_batch: { view: lazyPage(() => import("../pages/StepBatchPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "STEP Primary" },
  sw_step_export: { view: lazyPage(() => import("../pages/SwStepExportPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "SW→STEP Primary" },
  code_ignore: { view: lazyPage(() => import("../pages/CodeIgnorePage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "忽略设定 Primary" },
  unit_tests: { view: lazyPage(() => import("../pages/UnitTestsPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "测试 Primary" },
  test_fixtures: { view: lazyPage(() => import("../pages/TestFixturesPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "测试工程 Primary" },
  caa_dialog_home: { view: lazyPage(() => import("../pages/CaaDialogHomePage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "CAA Primary" },
  caa_dialog: { view: lazyPage(() => import("../pages/CaaDialogEditorPage.vue")), sideBlock: genericPrimaryBlock, sideBlockLabel: "CAA Primary" },
} satisfies Record<string, PageContribution>;

for (const contribution of Object.values(pageContributions)) Object.freeze(contribution);

export const PAGE_CONTRIBUTIONS: Readonly<Record<string, Readonly<PageContribution>>> = Object.freeze(
  pageContributions,
);

export const PAGE_COMPONENTS: Readonly<Record<string, Component>> = Object.freeze(
  Object.fromEntries(Object.entries(PAGE_CONTRIBUTIONS).map(([pageId, contribution]) => [
    pageId,
    contribution.view,
  ])),
);

export const PAGE_COMPONENT_IDS: ReadonlySet<string> = new Set(Object.keys(PAGE_CONTRIBUTIONS));

/** 与 Vue 异步组件共享同一个 import Promise；未知页面由同步 Placeholder 处理。 */
export function preloadPageComponent(pageId: string): Promise<unknown> {
  const component = PAGE_COMPONENTS[pageId];
  return component ? componentPreloads.get(component)?.() ?? Promise.resolve() : Promise.resolve();
}
