/** Ribbon 配置。
 *
 * TODO: 改回 buildRibbonTabs(navigation) 动态生成，消除硬编码。
 * 当前回退到静态 RIBBON_TABS 排查 UI bug。
 */

import type { NavItem } from "../../types/config";

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
  module?: string;
  groups: RibbonGroupDef[];
};

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
          { pageId: "test_fixtures", label: "检出测试工程" },
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
        items: [{ pageId: "caa_dialog_home", label: "CAA 对话框" }],
      },
    ],
  },
];

/** 从 navigation 动态生成 Ribbon Tab 配置（待 debug 后启用）。 */
export function buildRibbonTabs(_navigation: NavItem[]): RibbonTabDef[] {
  // TODO: 修复后启用动态生成
  return RIBBON_TABS;
}
