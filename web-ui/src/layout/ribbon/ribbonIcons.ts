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
  MagicStick,
  Monitor,
  Operation,
  Refresh,
  Search,
  Setting,
  Share,
  Sort,
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
  part_key_detail: Key,
  file_detail: Document,
  bom_apply: Document,
  file_rename: Switch,
  rename_analysis: Search,
  xlink_fix: Link,
  part_dedup: DocumentCopy,
  step_batch: Upload,
  sw_step_export: Box,
  code_index: Files,
  code_ignore: Operation,
  reorder_members: Sort,
  kt_codegen: Operation,
  code_rename: Refresh,
  code_uuid: MagicStick,
  unit_tests: Monitor,
  test_fixtures: Connection,
  caa_dialog_home: Document,
};

export function ribbonIconFor(pageId: string): Component {
  return RIBBON_PAGE_ICONS[pageId] ?? Document;
}
