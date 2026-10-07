/** 工作空间领域开关（与 ``app_config.json`` 的 ``module`` 字段对应，不是 Ribbon 分区）。 */

/** 仅在导航展示层合并；已有 cad/code 工作空间偏好与类型保持独立。 */
export const TOOL_NAV_MODULE_IDS: readonly string[] = ["cad", "code"];

/** 无工作空间领域限制的工具，不因 CAD/Code 模块开关而隐藏。 */
export const SHARED_TOOL_PAGE_IDS: readonly string[] = ["audio_extract", "rename_tasks"];

export const NAV_MODULE_OPTIONS = [
  {
    id: "cad",
    label: "CAD 工具",
    shortLabel: "CAD",
    hint: "索引、BOM、零件库、文件详情等",
  },
  {
    id: "code",
    label: "Code 工具",
    shortLabel: "Code",
    hint: "CAA 对话框与独立忽略设定",
  },
] as const;

export type NavModuleId = (typeof NAV_MODULE_OPTIONS)[number]["id"];
