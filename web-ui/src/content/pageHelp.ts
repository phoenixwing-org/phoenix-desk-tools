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
      "最近工程右侧选择 CAD / Code / 全部，进入对应 Ribbon 工具台；有未关闭文档时优先恢复。",
      "主页与模块开关仅在 Ribbon「系统 → 主页」或左侧「主页 · 功能清单」打开。",
      "Gitee 链接在欢迎页；完整开工清单见新手指南。",
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
      tour("[data-tour-page-home-features]", "功能模块", "按 CAD / Code 分组勾选模块，并在下方卡片快捷打开各工具页。"),
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
      "在工作空间树中点击 .FCStd 打开；同一路径复用一个 Tab。",
      "子 Tab：概览、编辑属性（图纸档为「查看属性」）、引用、改名、装配结构等。",
      "纯图纸 FCStd：顶部提示 BOM 只读，点「打开模型」编辑 Link 源文件。",
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
      "以「零件号.版本」为唯一键聚合关联文件；点标签或零件标识打开零件详情（同键复用 Tab）。",
    ],
    tourSteps: [
      tour("[data-tour-page-partcat-search]", "搜索与筛选", "按零件号、状态筛选列表。"),
      tour("[data-tour-page-partcat-table]", "目录表", "点击行打开零件详情 Tab。"),
    ],
  },
  part_key_detail: {
    title: "零件详情",
    bullets: [
      "输入零件标识后检索；或在本 Tab 激活时点击树中 .FCStd（按文件名解析）。",
      "查看 PartKey 属性与关联 FCStd 列表。",
    ],
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
      "勾选一级目录或源文件；运行选项与 KEVIN_SYSTEM_CODE 在侧栏「属性」面板（随工作空间保存）。",
      "建议先预检再写盘；变更列表与运行日志见下方。",
      "忽略：内置 .phoenix / build / node_modules 等；可选 .phoenix/code.ignore；CAA 差异在侧栏「忽略设定」。",
      "锁定段（P0）：clang-format off/on、KEVIN/CAA Wizard、#pragma region 等成对标记内整段不重排。",
      "排序摘要：.cpp/.h 各访问段内特殊成员优先，其余字母序；.cpp 补 //--- 分隔符。",
    ],
    docPath: "doc/code/成员函数排序-reorder_members.md",
  },
  code_ignore: {
    title: "Code 忽略设定",
    bullets: [
      "所有 Code 工具共用：内置规则 + code.ignore 文件 + 工作空间自定义行。",
      "Code 模块页可在侧栏「忽略设定」Tab 编辑；本页为全屏编辑入口。",
      "文件级 / 进程目录 / 自定义区可折叠；Git 式 code.ignore 在上方，自定义在下方。",
    ],
    docPath: "doc/code/Code模块-批量改名-规划.md",
  },
  code_index: {
    title: "Code 索引",
    bullets: [
      "「工程内搜索」递归扫描源文件、配置、文档与资源，写入 phoenix_code_* 表（与 CAD 索引同库）。",
      "跳过 build、node_modules、.git 等目录；再次扫描会将磁盘上已删除的文件标为「缺失」。",
      "上次扫描时间与分类统计（源文件 / 配置 / 文档 / 资源）见侧栏「属性」。",
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
      "旧名→新名精确匹配；勾选文件夹 / 文件 / 文本三个级别后预览再执行。",
      "扫描范围见表单内工作集选择器；忽略规则在侧栏「忽略设定」统一配置。",
      "「包含忽略目录」慎用；完成后可勾选重扫 Code 索引。",
    ],
    docPath: "doc/code/Code模块-批量改名-规划.md",
  },
  code_uuid: {
    title: "Code UUID 替换",
    bullets: [
      "扫描文本中的 UUID 形态字符串，勾选后预检或写盘替换。",
      "替换策略：同值一组共用一个新 UUID，或每条命中独立新 UUID。",
      "忽略规则在侧栏「忽略设定」；可按 UUID 组全选。",
    ],
    docPath: "doc/code/Code模块-批量改名-规划.md",
  },
  git: {
    title: "Git",
    bullets: [
      "已暂存 − 取消暂存；更改 / 未跟踪 点 + 暂存（分区展示）。",
      "提交说明与 Commit 在右侧属性面板下方的「提交」区。",
      "Git 状态摘要见属性；范围与说明见 ? 帮助。",
    ],
    docPath: "doc/platform/Web壳层-Git工作区插件-规划.md",
  },
  unit_tests: {
    title: "单元测试",
    bullets: [
      "在本机运行仓库 tests/ 下的 unittest；勾选套件后运行，无需工作空间。",
      "运行范围：勾选 Code / CAD / 平台 套件；展开「列出运行范围」可再按模块勾选（默认全选）。",
      "有结果后，用「结果 · 套件 / 状态」勾选筛选明细，与运行范围分开。",
    ],
    tourSteps: [
      tour("[data-tour-page-unit-tests-suites]", "运行范围", "勾选要跑的套件，再点运行测试。"),
      tour("[data-tour-page-unit-tests-run]", "运行", "执行后查看统计；下方勾选仅筛选结果展示。"),
    ],
  },
  test_fixtures: {
    title: "检出测试工程",
    bullets: [
      "可引用的测试工程为系统内置（test_fixture_catalog.json），如 KtAlarmClock、PNXCaaStudy；随仓库提交，本页不可增删。",
      "本机偏好（launcher.json → test_fixtures）：检出根目录、勾选列表，不提交进 Git。",
      "勾选仅标记「要引用」并写入本机偏好；点页头或卡片内「检出并链接」才执行 git clone + 链到 tests/fixtures/<名>。",
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
