import type { Component } from "vue";
import {
  Box,
  Connection,
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
  home: HomeFilled,
  audio_extract: Headset,
  config: Setting,
  git: Share,
  part_catalog: Grid,
  cad_index: Files,
  part_key_detail: Key,
  file_detail: Document,
  bom_apply: Document,
  file_rename: Switch,
  rename_analysis: Search,
  xlink_fix: Link,
  cad_batch_tools: Operation,
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
