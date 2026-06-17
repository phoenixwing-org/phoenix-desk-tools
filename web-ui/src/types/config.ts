export type NavItem = {
  id: string;
  label: string;
  page: string;
  description?: string;
  icon?: string;
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

export type ShellLayout = {
  nav_rail_mode: 0 | 1;
  right_panel_open: boolean;
  mid_right_sash_px: number | null;
  right_panel_width_px: number;
  log_panel_open: boolean;
  log_panel_height_px: number;
  log_auto_open_on_append: boolean;
};

export type RecentWorkspaceEntry = {
  path: string;
  exists: boolean;
};

export type LauncherPrefs = {
  version: number;
  recent_workspaces: string[];
  recent_workspace_entries?: RecentWorkspaceEntry[];
  freecad_dir: string;
  default_freecad_dir?: string;
  platform?: string;
  shell_layout: ShellLayout;
  launcher_config_path?: string;
};

export const DEFAULT_PAGE_ICONS: Record<string, string> = {
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
};
