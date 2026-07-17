import type { ModuleScope } from "../constants/moduleScope";

export const DEFAULT_APP_TITLE = "Phoenix 桌面工具";

export type NavItem = {
  id: string;
  label: string;
  page: string;
  module?: "cad" | "code" | string;
  description?: string;
  icon?: string;
  /** Ribbon 分组名（同 module 下按此字段分组） */
  ribbonGroup?: string;
  /** Ribbon 按钮上的短标签（缺省用 label） */
  ribbonLabel?: string;
};

export type NavModules = {
  enabled: string[];
};

export type WorkbenchPageTabPolicy = {
  max_tabs: number;
  tab_enabled?: boolean;
};

export type WorkbenchConfig = {
  tab_bar?: "main_content_top";
  default_max_tabs?: number;
  pages?: Record<string, WorkbenchPageTabPolicy>;
};

export type AppConfig = {
  title: string;
  navigation: NavItem[];
  toolbar: { items: unknown[] };
  workbench?: WorkbenchConfig;
  workspace_dotfile: string;
  launcher_config_path: string;
};

export type SideDock = "left" | "right";

export type ShellLayout = {
  nav_rail_mode: 0 | 1;
  ribbon_mode: 0 | 1;
  right_panel_open: boolean;
  mid_right_sash_px: number | null;
  /** 左侧 Primary 宽度 */
  left_panel_width_px: number;
  right_panel_width_px: number;
  log_panel_open: boolean;
  log_panel_height_px: number;
  log_auto_open_on_append: boolean;
  /** 工作空间树停靠侧 */
  workspace_tree_dock: SideDock;
  /** 遗留字段；运行日志现固定在下方全局面板，不再消费该停靠值。 */
  shell_log_dock: SideDock;
  /** 页面属性面板是否展开 */
  properties_panel_open: boolean;
  properties_panel_height_px: number;
  /** 属性区下方堆叠块高度（如 Git 提交区，px） */
  properties_footer_height_px: number;
  /** Git 页侧栏「Git 提交」块是否展开 */
  git_commit_panel_open: boolean;
  /** Git 提交区停靠侧（Git 页） */
  git_commit_panel_dock: SideDock;
  /** 页面属性面板停靠侧 */
  properties_panel_dock: SideDock;
  /** 属性表「名称」列宽（px） */
  properties_name_col_width_px: number;
  /** 工作集独立面板 dock 侧 */
  workset_panel_dock: SideDock;
  /** 工作集独立面板是否展开（false=Tab 模式） */
  workset_panel_open: boolean;
};

export type RecentWorkspaceEntry = {
  path: string;
  exists: boolean;
  module_scope?: ModuleScope;
};

export type WorkspaceNavModules = {
  scope: ModuleScope;
  enabled: string[];
};

export type LauncherPrefs = {
  version: number;
  recent_workspaces: string[];
  recent_workspace_entries?: RecentWorkspaceEntry[];
  freecad_dir: string;
  default_freecad_dir?: string;
  platform?: string;
  shell_layout: ShellLayout;
  nav_modules?: NavModules;
  launcher_config_path?: string;
};

export const DEFAULT_PAGE_ICONS: Record<string, string> = {
  welcome: "◆",
  home: "⌂",
  config: "⚙",
  fcstd_map: "◫",
  xlink_fix: "⎘",
  step_batch: "⇩",
  sw_step_export: "▣",
  bom_export: "▤",
  bom_apply: "✎",
  file_rename: "↦",
  rename_analysis: "🔍",
  part_catalog: "◉",
  part_key_detail: "◎",
  part_dedup: "≡",
  reorder_members: "{ }",
  kt_codegen: "⚙",
  code_index: "⌗",
  code_ignore: "⊘",
  code_rename: "↦",
  code_uuid: "⧉",
};
