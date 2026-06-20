/** Ribbon Tab / 分组 / 工具项静态配置（标签可覆盖 navigation.label） */

export type RibbonItemSize = "large" | "small";

export type RibbonItemDef = {
  pageId: string;
  label?: string;
  size?: RibbonItemSize;
};

export type RibbonGroupDef = {
  id: string;
  label: string;
  items: RibbonItemDef[];
};

export type RibbonTabDef = {
  id: string;
  label: string;
  /** 空 = 不过滤模块；cad/code 与 nav_modules 联动 */
  module?: "" | "cad" | "code";
  groups: RibbonGroupDef[];
};

export const RIBBON_TABS: RibbonTabDef[] = [
  {
    id: "start",
    label: "开始",
    groups: [
      {
        id: "start-main",
        label: "常用",
        items: [
          { pageId: "home", size: "large", label: "主页" },
          { pageId: "config", size: "small" },
        ],
      },
    ],
  },
  {
    id: "cad",
    label: "CAD",
    module: "cad",
    groups: [
      {
        id: "cad-index",
        label: "索引",
        items: [
          { pageId: "fcstd_map", size: "large" },
          { pageId: "bom_export", size: "small" },
          { pageId: "part_catalog", size: "small" },
        ],
      },
      {
        id: "cad-file",
        label: "文件",
        items: [
          { pageId: "file_rename", size: "small", label: "改名分析" },
        ],
      },
      {
        id: "cad-tools",
        label: "工具",
        items: [
          { pageId: "xlink_fix", size: "small" },
          { pageId: "part_dedup", size: "small" },
          { pageId: "step_batch", size: "small" },
          { pageId: "sw_step_export", size: "small" },
        ],
      },
    ],
  },
  {
    id: "code",
    label: "Code",
    module: "code",
    groups: [
      {
        id: "code-index",
        label: "索引",
        items: [{ pageId: "code_index", size: "large" }],
      },
      {
        id: "code-edit",
        label: "编辑",
        items: [
          { pageId: "reorder_members", size: "small" },
          { pageId: "code_rename", size: "small" },
          { pageId: "code_uuid", size: "small" },
        ],
      },
      {
        id: "code-prefs",
        label: "设定",
        items: [{ pageId: "code_ignore", size: "small" }],
      },
    ],
  },
  {
    id: "system",
    label: "系统",
    groups: [
      {
        id: "system-dev",
        label: "开发",
        items: [{ pageId: "unit_tests", size: "large" }],
      },
    ],
  },
];
