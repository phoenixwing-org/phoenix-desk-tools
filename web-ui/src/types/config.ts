export type NavItem = {
  id: string;
  label: string;
  page: string;
  description?: string;
  icon?: string;
};

export type AppConfig = {
  title: string;
  navigation: NavItem[];
  toolbar: { items: unknown[] };
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

export type LauncherPrefs = {
  version: number;
  recent_workspaces: string[];
  freecad_dir: string;
  default_freecad_dir?: string;
  platform?: string;
  shell_layout: ShellLayout;
  launcher_config_path?: string;
  legacy_launcher_path?: string;
  legacy_launcher_exists?: boolean;
  migrated_from_legacy?: boolean;
};

export const DEFAULT_PAGE_ICONS: Record<string, string> = {
  home: "⚙",
  fcstd_map: "◫",
  xlink_fix: "⎘",
  step_batch: "⇩",
  sw_step_export: "▣",
  bom_export: "▤",
  bom_apply: "✎",
  file_rename: "↦",
  part_catalog: "◉",
  part_dedup: "≡",
};
