import type { AppShellContext } from "./useAppShell";
import type { PagePrimarySection } from "./usePagePrimaryContribution";

export const CAD_BATCH_TOOLS = [
  { page: "xlink_fix", label: "错误修正", description: "链接路径与属性计数：先分析，再确认修正。" },
  { page: "batch_attributes", label: "批量属性写入", description: "预览 FreeCAD 自定义属性；逐文件勾选可写项，默认只补缺失。" },
  { page: "name_normalize", label: "名称统一", description: "以属性 PartName 为准，未设定时才从文件名提取；分阶段统一 Label 与文件名，先预览再确认。" },
  { page: "document_sync", label: "关联文档同步", description: "选择并合并 CAD 改名记录，核对 A→B 后转入独立批量改名。" },
  { page: "assembly_labels", label: "总成链接标签修正", description: "每个 ASSY 一行，预览待修正标签数量，勾选后逐个应用；不改文件名或引用路径。" },
  { page: "part_gallery", label: "零件图册", description: "全库缩略图缓存，按产品查看和 A4 打印；PNG 可明确导出到 Git 目录。" },
  { page: "step_batch", label: "STEP → FCStd", description: "复用本机 FreeCADCmd 批量转换。" },
  { page: "sw_step_export", label: "SolidWorks → STEP", description: "Windows / SolidWorks COM 批量导出。" },
  { page: "part_dedup", label: "编号查重", description: "检查文件名及零件号、版本重复，不自动删除文件。" },
] as const;

/** Hidden tool entries still belong to the visible CAD batch-tools navigation group. */
export function cadBatchNavigationPage(page: string): string {
  return CAD_BATCH_TOOLS.some((tool) => tool.page === page) ? "cad_batch_tools" : page;
}

export function cadBatchToolsSection(shell: Pick<AppShellContext, "openTab">, current: string): PagePrimarySection {
  return {
    id: "cad-batch-tools", title: "功能", description: "在右侧工作台打开独立 View，保留各工具参数。",
    placement: "before-context", actionLayout: "grid",
    actions: [
      { id: "hub", label: "批量工具", disabled: current === "cad_batch_tools", run: () => { shell.openTab({ pageId: "cad_batch_tools" }); } },
      ...CAD_BATCH_TOOLS.map(tool => ({
        id: tool.page, label: tool.label, title: tool.description, disabled: current === tool.page,
        run: () => { shell.openTab({ pageId: tool.page }); },
      })),
    ],
  };
}
