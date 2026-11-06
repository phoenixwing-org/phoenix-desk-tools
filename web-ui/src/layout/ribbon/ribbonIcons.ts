import type { Component } from "vue";
import { FREECAD_MCP_MANAGE_ACTION } from "../../features/freecad-mcp/navigation";
import {
  Box,
  Connection,
  Coin,
  Document,
  DocumentCopy,
  Files,
  Grid,
  Headset,
  HomeFilled,
  Key,
  Link,
  Monitor,
  Operation,
  Search,
  Setting,
  Share,
  Switch,
  Upload,
} from "@element-plus/icons-vue";

/** pageId → Element Plus 图标（Ribbon 工具按钮） */
export const RIBBON_PAGE_ICONS: Record<string, Component> = {
  [FREECAD_MCP_MANAGE_ACTION]: Connection,
  batch_tasks: Operation,
  home: HomeFilled,
  audio_extract: Headset,
  config: Setting,
  git: Share,
  part_catalog: Grid,
  cad_index: Files,
  workspace_recovery: Coin,
  bom_delivery: Upload,
  part_key_detail: Key,
  file_detail: Document,
  bom_apply: Document,
  file_rename: Switch,
  rename_analysis: Search,
  xlink_fix: Link,
  cad_batch_tools: Operation,
  drawing_batch: DocumentCopy,
  part_dedup: DocumentCopy,
  step_batch: Upload,
  sw_step_export: Box,
  code_ignore: Operation,
  unit_tests: Monitor,
  test_fixtures: Connection,
  caa_dialog_home: Document,
};

export function ribbonIconFor(pageId: string): Component {
  return RIBBON_PAGE_ICONS[pageId] ?? Document;
}
