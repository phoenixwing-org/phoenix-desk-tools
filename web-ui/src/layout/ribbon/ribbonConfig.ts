/** Ribbon Tab / 分组 / 工具项静态配置（标签可覆盖 navigation.label） */

export type RibbonItemSize = "large" | "small";

export type RibbonItemDef = {
  pageId: string;
  label?: string;
  /** 分组 Ribbon 下均为大图标；small 仅单行模式保留语义 */
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

/** 壳层常用区（工作空间 / 模块 / 侧栏）仅在此 Tab 展示 */
export const RIBBON_SHELL_TAB_ID = "system";

export const RIBBON_TABS: RibbonTabDef[] = [
  {
    id: RIBBON_SHELL_TAB_ID,
    label: "系统",
    groups: [
      {
        id: "system-common",
        label: "常用",
        items: [
          { pageId: "home", label: "主页" },
          { pageId: "config" },
        ],
      },
      {
        id: "system-dev",
        label: "开发",
        items: [
          { pageId: "git", label: "Git" },
          { pageId: "test_fixtures", label: "引用测试工程" },
          { pageId: "unit_tests" },
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
          { pageId: "fcstd_map", label: "CAD 索引" },
          { pageId: "bom_export" },
          { pageId: "part_catalog" },
        ],
      },
      {
        id: "cad-tools",
        label: "工具",
        items: [
          { pageId: "file_rename", label: "改名分析" },
          { pageId: "xlink_fix", label: "链接修正" },
          { pageId: "part_dedup" },
          { pageId: "step_batch" },
          { pageId: "sw_step_export" },
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
        items: [{ pageId: "code_index" }],
      },
      {
        id: "code-edit",
        label: "编辑",
        items: [
          { pageId: "reorder_members" },
          { pageId: "code_rename" },
          { pageId: "code_uuid" },
          { pageId: "code_ignore", label: "忽略设定" },
        ],
      },
      {
        id: "code-caa",
        label: "CAA",
        items: [{ pageId: "caa_dialog", label: "CAA 对话框" }],
      },
    ],
  },
];
