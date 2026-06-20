import type { DriveStep } from "driver.js";

/** 各页「?」说明 + 可选「本页导引」步骤 */
export type PageHelpContent = {
  title: string;
  bullets: string[];
  docPath?: string;
  tourSteps?: DriveStep[];
};

function tour(
  selector: string,
  title: string,
  description: string,
  side: "top" | "right" | "bottom" | "left" = "bottom",
): DriveStep {
  return {
    element: selector,
    popover: { title, description, side, align: "start" },
  };
}

export const PAGE_HELP: Record<string, PageHelpContent> = {
  welcome: {
    title: "欢迎",
    bullets: [
      "启动后默认页：点击最近工程进入 Ribbon 工作台；左侧可打开配置或新手指南。",
      "Gitee 链接在左侧底部；完整功能模块与开工清单见「功能与模块」或 Ribbon「主页」。",
    ],
    docPath: "doc/user/快速开始.md",
    tourSteps: [
      tour("[data-tour-page-welcome-recent]", "最近使用", "保存过的工作空间根目录会出现在这里；点击行切换工程。"),
    ],
  },
  home: {
    title: "主页",
    bullets: [
      "新手指南四步：工作空间 → FreeCAD（推荐）→ CAD 索引 → 打开文件详情。",
      "侧栏「? 新手指引」或主页清单可随时回到开工步骤；「界面巡游」为全壳层导览。",
    ],
    docPath: "doc/user/新手指引.md",
    tourSteps: [
      tour("#onboarding-guide", "新手指南", "按步骤完成配置与首次扫描；完成后显示「已可开工」。"),
      tour("[data-tour-page-home-features]", "功能入口", "配置好工作空间后，从这里进入各工具页。"),
    ],
  },
  config: {
    title: "配置",
    bullets: [
      "工作空间根、FreeCAD 目录须在此保存；保存后写入最近列表并解锁侧栏功能。",
      "界面区可调展开图标大小；可重新观看全壳层巡游。",
    ],
    docPath: "doc/user/新手指引.md",
    tourSteps: [
      tour("[data-tour-page-config-workspace]", "工作空间", "填写工程根目录并点「保存偏好」。"),
      tour("[data-tour-page-config-freecad]", "FreeCAD", "STEP 批量等任务需要本机 FreeCAD 路径。"),
    ],
  },
  fcstd_map: {
    title: "CAD 索引",
    bullets: [
      "「工程内搜索」写入 .phoenix/phoenix-workspace.sqlite，并重建 BOM 引用表。",
      "「删除缺失」清理索引里文件已不存在的条目。",
    ],
    docPath: "doc/cad/CAD索引-缺失条目.md",
    tourSteps: [
      tour("[data-tour-page-fcstd-scan]", "工程内搜索", "首次使用或大改文件后请执行；日志在右侧运行日志。"),
      tour("[data-tour-page-fcstd-table]", "索引表", "浏览扫描结果；可导出 JSON。"),
    ],
  },
  bom_export: {
    title: "BOM 列表",
    bullets: [
      "一次 SQL 汇总各总成及直接子件数；不加载全部引用边。",
      "点击行进入文件详情 · 装配结构（多级树已预计算缓存）。",
      "仅含 .assy.fcstd 或子件≥2；图纸档不列入。",
    ],
    docPath: "doc/cad/BOM列表页设计.md",
    tourSteps: [
      tour("[data-tour-page-bom-tabs]", "总成列表", "浏览工程内装配宿主数量与摘要。"),
      tour("[data-tour-page-bom-table]", "总成表", "点击行打开该文件的装配结构 Tab。"),
    ],
  },
  file_detail: {
    title: "文件详情",
    bullets: [
      "子 Tab：概览、编辑属性、引用、改名、装配结构等。",
      "图纸档属性只读；同一 repo 路径复用一个 Tab。",
    ],
    docPath: "doc/cad/文件详情页-整改规划.md",
    tourSteps: [
      tour("[data-tour-page-filedetail-tabs]", "子 Tab", "在不同子页之间切换属性、引用与改名。"),
      tour("[data-tour-page-filedetail-body]", "内容区", "当前子 Tab 的表单或表格；写入后注意看运行日志。"),
    ],
  },
  xlink_fix: {
    title: "链接路径修正",
    bullets: [
      "先分析再写回；未找到行可展开并手选目标 FCStd。",
    ],
    docPath: "doc/cad/链接路径修正-未找到手选.md",
    tourSteps: [
      tour("[data-tour-page-xlink-analyze]", "分析", "扫描问题列表，区分可自动修正与未找到。"),
      tour("[data-tour-page-xlink-table]", "问题表", "勾选后执行写回；展开行可选手动目标文件。"),
    ],
  },
  step_batch: {
    title: "STEP 批量",
    bullets: [
      "需先在配置填写 FreeCAD 目录；freecadcmd 批量 STEP→FCStd。",
    ],
    docPath: "doc/cad/STEP批量转FCStd.md",
    tourSteps: [
      tour("[data-tour-page-step-form]", "目录与选项", "设置 STEP 输入目录与 FCStd 输出目录。"),
      tour("[data-tour-page-step-run]", "执行", "先预览数量，再开始转换；输出见运行日志。"),
    ],
  },
  sw_step_export: {
    title: "SW→STEP",
    bullets: [
      "Windows + SolidWorks COM；导出后可接 STEP 批量。",
    ],
    docPath: "doc/cad/SolidWorks批量STEP导出.md",
    tourSteps: [
      tour("[data-tour-page-sw-form]", "目录", "设置三维模型源目录与 STEP 输出目录。"),
      tour("[data-tour-page-sw-run]", "导出", "预览模型数量后执行 COM 导出。"),
    ],
  },
  part_catalog: {
    title: "零件目录",
    bullets: [
      "按 PartKey 聚合；点标签或零件标识打开零件详情。",
    ],
    tourSteps: [
      tour("[data-tour-page-partcat-search]", "搜索与筛选", "按零件号、状态筛选列表。"),
      tour("[data-tour-page-partcat-table]", "目录表", "点击行打开零件详情 Tab。"),
    ],
  },
  part_key_detail: {
    title: "零件详情",
    bullets: ["查看 PartKey 属性与关联 FCStd。"],
    tourSteps: [
      tour("[data-tour-page-partkey-body]", "零件信息", "属性与关联文件列表；同 PartKey 复用 Tab。"),
    ],
  },
  file_rename: {
    title: "改名分析",
    bullets: [
      "针对已发生改名分析引用；磁盘改名在文件详情 · 改名 Tab。",
    ],
    docPath: "doc/cad/改名与XLink引用修正-规划讨论.md",
    tourSteps: [
      tour("[data-tour-page-rename-modes]", "数据来源", "改名历史或手动输入新旧文件名。"),
      tour("[data-tour-page-rename-panel]", "分析区", "查看影响范围并写回引用。"),
    ],
  },
  part_dedup: {
    title: "编号查重",
    bullets: [
      "按扩展名扫描目录，查文件名 / 编号 / 编号+版本重复。",
    ],
    tourSteps: [
      tour("[data-tour-page-dedup-settings]", "扫描参数", "目录、扩展名、编号与版本位数。"),
      tour("[data-tour-page-dedup-scan]", "开始扫描", "结果按三类重复分组展示。"),
    ],
  },
  reorder_members: {
    title: "C++ 成员排序",
    bullets: [
      "工作空间下一级目录与 .h/.cpp 文件；忽略规则见「Code 忽略设定」（code.ignore + 自定义）。",
      "可预检或直接执行排序；结果在运行日志。",
    ],
    docPath: "doc/code/成员函数排序-reorder_members.md",
  },
  code_ignore: {
    title: "Code 忽略设定",
    bullets: [
      "所有 Code 工具共用：内置 + .phoenix/code.ignore 文件 + 工作空间自定义。",
      "Code 模块页面下，右侧栏提供「工作空间树 / 忽略设定」Tab；各区块可折叠展开。",
      "亦可在导航打开本页全屏编辑；CAA 等可选预设后保存。",
    ],
    docPath: "doc/code/Code模块-批量改名-规划.md",
  },
  code_index: {
    title: "Code 索引",
    bullets: [
      "「工程内搜索」递归扫描源文件、配置、文档与资源，写入 phoenix_code_* 表（与 CAD 索引同库）。",
      "跳过 build、node_modules、.git 等目录；再次扫描会将磁盘上已删除的文件标为「缺失」。",
    ],
    docPath: "doc/code/Code模块-工作空间索引.md",
    tourSteps: [
      tour("[data-tour-page-code-scan]", "工程内搜索", "首次使用 Code 工具前建议先建立索引。"),
      tour("[data-tour-page-code-table]", "索引表", "按类型与路径筛选浏览。"),
    ],
  },
  code_rename: {
    title: "Code 批量改名",
    bullets: [
      "旧名→新名精确匹配；可勾选文件夹 / 文件 / 文本三个级别。",
      "忽略规则在「Code 忽略设定」统一配置。",
      "预览列出命中后再执行；引擎接入前 API 与界面可先联调。",
    ],
    docPath: "doc/code/Code模块-批量改名-规划.md",
  },
  code_uuid: {
    title: "Code UUID 替换",
    bullets: [
      "扫描文本文件中的 UUID 形态字符串，勾选后批量替换。",
      "忽略规则在「Code 忽略设定」统一配置；同一旧 UUID 可一键全选。",
    ],
    docPath: "doc/code/Code模块-批量改名-规划.md",
  },
  unit_tests: {
    title: "单元测试",
    bullets: [
      "在本机 Python 进程内运行仓库 tests/ 下 unittest，不依赖工作空间。",
      "运行范围：勾选 Code / CAD / 平台 套件后点运行（可多选组合）。",
      "有结果后，用「结果 · 套件 / 状态」勾选筛选明细，与运行范围分开。",
    ],
    tourSteps: [
      tour("[data-tour-page-unit-tests-suites]", "运行范围", "勾选要跑的套件，再点运行测试。"),
      tour("[data-tour-page-unit-tests-run]", "运行", "执行后查看统计；下方勾选仅筛选结果展示。"),
    ],
  },
};

/** 未单独配置的 pageId 使用通用说明 */
const FALLBACK: PageHelpContent = {
  title: "本页",
  bullets: ["完整说明见侧栏对应功能文档（doc/）。"],
};

export function getPageHelp(pageId: string): PageHelpContent {
  return PAGE_HELP[pageId] ?? { ...FALLBACK, title: pageId };
}

export function hasPageTour(pageId: string): boolean {
  return (PAGE_HELP[pageId]?.tourSteps?.length ?? 0) > 0;
}
