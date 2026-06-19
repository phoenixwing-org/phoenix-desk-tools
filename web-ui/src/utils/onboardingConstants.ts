/** 无工作空间也可进入的页面 */
export const ONBOARDING_PAGES_ALWAYS = new Set(["home", "config", "unit_tests"]);

/** 依赖本机 FreeCAD 目录（仅限制「开始任务」类操作，不拦进入页面） */
export const ONBOARDING_PAGES_FREECAD_TASKS = new Set(["step_batch", "sw_step_export"]);

export const FILE_DETAIL_PAGE_IDS = new Set(["file_detail", "bom_apply"]);

export const WORKSPACE_GATE_MSG = "请先在配置中设置有效的工作空间根目录";

export const FREECAD_TASK_MSG = "请先在配置中填写 FreeCAD 安装目录";

export const SHELL_TOUR_VERSION = 1;
