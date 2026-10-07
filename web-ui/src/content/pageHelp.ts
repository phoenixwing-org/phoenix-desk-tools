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
    docPath: "docs/user/快速开始.md",
    tourSteps: [
      tour("[data-tour-page-welcome-recent]", "最近使用", "保存过的工作空间根目录会出现在这里；点击行切换工程。"),
    ],
  },
  home: {
    title: "主页",
    bullets: [
      "新手指南四步：工作空间 → FreeCAD（推荐）→ KT Auto CAD 扫描 → 打开文件详情。",
      "侧栏「? 新手指引」或主页清单可随时回到开工步骤；「界面巡游」为全壳层导览。",
    ],
    docPath: "docs/user/新手指引.md",
    tourSteps: [
      tour("#onboarding-guide", "新手指南", "按步骤完成配置与首次扫描；完成后显示「已可开工」。"),
      tour("[data-tour-page-home-features]", "功能模块", "按 CAD / Code 分组勾选模块，并在下方卡片快捷打开各工具页。"),
    ],
  },
  audio_extract: {
    title: "视频音频提取",
    bullets: [
      "选择或拖入浏览器可解码的 MP4、WebM、MOV 或音频文件，再点“提取 MP3”。",
      "文件仅在当前 Web/Tauri 内存中解码与编码，不经过 Desk API，也不会上传。",
      "输出为 44.1 kHz、128 kbps MP3；AVI、MKV 等浏览器通常不能直接解码，需先转换容器。",
    ],
  },
  config: {
    title: "配置",
    bullets: [
      "工作空间根、FreeCAD 目录须在此保存；保存后写入最近列表并解锁侧栏功能。",
      "界面区可调展开图标大小；可重新观看全壳层巡游。",
    ],
    docPath: "docs/user/新手指引.md",
    tourSteps: [
      tour("[data-tour-page-config-workspace]", "工作空间", "填写工程根目录并点「保存偏好」。"),
      tour("[data-tour-page-config-freecad]", "FreeCAD", "STEP 批量等任务需要本机 FreeCAD 路径。"),
    ],
  },
  file_detail: {
    title: "文件详情",
    bullets: [
      "在工作空间树中点击 .FCStd 打开；同一路径复用一个 Tab。",
      "子 Tab：概览、编辑属性（图纸档为「查看属性」）、引用、改名、装配结构等。",
      "纯图纸 FCStd：顶部提示 BOM 只读，点「打开模型」编辑 Link 源文件。",
    ],
    docPath: "docs/cad/文件详情页-整改规划.md",
    tourSteps: [
      tour("[data-tour-page-filedetail-tabs]", "子 Tab", "在不同子页之间切换属性、引用与改名。"),
      tour("[data-tour-page-filedetail-body]", "内容区", "当前子 Tab 的表单或表格；写入后注意看运行日志。"),
    ],
  },
  xlink_fix: {
    title: "错误修正",
    bullets: [
      "先分析再写回；未找到行可展开并手选目标 FCStd。",
      "链接与属性计数可一起分析；属性只修 Count，不覆盖业务值。",
    ],
    docPath: "docs/cad/CAD批量工具.md",
    tourSteps: [
      tour("[data-tour-page-xlink-analyze]", "分析", "扫描问题列表，区分可自动修正与未找到。"),
      tour("[data-tour-page-xlink-table]", "问题表", "勾选后执行写回；展开行可选手动目标文件。"),
    ],
  },
  cad_batch_tools: {
    title: "CAD 批量工具",
    bullets: ["在 Primary 功能 Block 打开独立 View；此入口不执行任何写操作。"],
    docPath: "docs/cad/CAD批量工具.md",
    tourSteps: [],
  },
  batch_attributes: {
    title: "批量属性写入",
    bullets: ["目录内预览后勾选文件/字段，默认只补缺失或空值。", "来源冲突、图纸或多个独立根对象需到单文件确认。写入前关闭 FreeCAD 文档并备份。"],
    docPath: "docs/cad/CAD批量工具.md",
    tourSteps: [],
  },
  step_batch: {
    title: "STEP 批量",
    bullets: [
      "需先在配置填写 FreeCAD 目录；freecadcmd 批量 STEP→FCStd。",
    ],
    docPath: "docs/cad/STEP批量转FCStd.md",
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
    docPath: "docs/cad/SolidWorks批量STEP导出.md",
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
  cad_index: {
    title: "CAD 索引",
    bullets: ["只读检查当前工作空间已有索引与最近扫描状态，不扫描磁盘或重建数据库。", "全量扫描在 KT Auto CAD；局部引用刷新在文件详情。"],
    docPath: "docs/cad/CAD目录与索引职责拆分.md",
    tourSteps: [],
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
    docPath: "docs/cad/改名与XLink引用修正-规划讨论.md",
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
  code_ignore: {
    title: "Code 忽略设定",
    bullets: [
      "独立管理工作空间忽略规则：内置规则 + code.ignore 文件 + 工作空间自定义行；保存不会触发源码扫描。",
      "Code 模块页可在侧栏「忽略设定」Tab 编辑；本页为全屏编辑入口。",
      "文件级 / 进程目录 / 自定义区可折叠；Git 式 code.ignore 在上方，自定义在下方。",
    ],
  },
  git: {
    title: "Git",
    bullets: [
      "已暂存 − 取消暂存；更改 / 未跟踪 点 + 暂存（分区展示）。",
      "提交说明与 Commit 在右侧属性面板下方的「提交」区。",
      "Git 状态摘要见属性；范围与说明见 ? 帮助。",
    ],
    docPath: "docs/platform/Web壳层-Git工作区插件-规划.md",
  },
  unit_tests: {
    title: "单元测试",
    bullets: [
      "开发态运行 server、web-ui 与 catdlg-core 的 Vitest；桌面发行版运行打包资源、TypeScript CAD 服务和核心算法自检，无需工作空间。",
      "运行范围：勾选 Code / CAD / 平台 / CAA 套件；展开「列出运行范围」可再按模块勾选（默认全选）。",
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
      "本机偏好（launcher-prefs.json → test_fixtures）保存检出根目录与启用列表，不提交进 Git。",
      "勾选仅标记启用；点页头或卡片内「检出」后才执行 git clone，并写入检出根目录下的同名子目录。",
    ],
  },
};

/** 未单独配置的 pageId 使用通用说明 */
const FALLBACK: PageHelpContent = {
  title: "本页",
  bullets: ["完整说明见侧栏对应功能文档（docs/）。"],
};

export function getPageHelp(pageId: string): PageHelpContent {
  return PAGE_HELP[pageId] ?? { ...FALLBACK, title: pageId };
}

export function hasPageTour(pageId: string): boolean {
  return (PAGE_HELP[pageId]?.tourSteps?.length ?? 0) > 0;
}
