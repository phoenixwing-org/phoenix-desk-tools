/** 侧栏功能模块（与 ``app_config.json`` 的 ``module`` 字段对应）。 */

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
    hint: "C++ 成员排序、批量改名、UUID 替换等",
  },
] as const;

export type NavModuleId = (typeof NAV_MODULE_OPTIONS)[number]["id"];
