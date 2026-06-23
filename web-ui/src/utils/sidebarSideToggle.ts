import type { ShellLayout, SideDock } from "../types/config";
import { gitCommitPanelDock, sideDockVisibility, type SideDockVisibilityContext } from "./sideDockLayout";

export type SidePanelSnapshot = {
  tree: boolean;
  log: boolean;
  props: boolean;
  git: boolean;
};

export function sideHasDockedPanels(layout: ShellLayout, side: SideDock): boolean {
  return (
    layout.workspace_tree_dock === side ||
    layout.shell_log_dock === side ||
    layout.properties_panel_dock === side ||
    gitCommitPanelDock(layout) === side
  );
}

export function snapshotPanelsOnSide(layout: ShellLayout, side: SideDock): SidePanelSnapshot {
  return {
    tree: layout.workspace_tree_dock === side && layout.right_panel_open,
    log: layout.shell_log_dock === side && layout.log_panel_open,
    props: layout.properties_panel_dock === side && layout.properties_panel_open,
    git: gitCommitPanelDock(layout) === side && layout.git_commit_panel_open,
  };
}

export function buildCollapseSidePatch(layout: ShellLayout, side: SideDock): Partial<ShellLayout> {
  const patch: Partial<ShellLayout> = {};
  if (layout.workspace_tree_dock === side) patch.right_panel_open = false;
  if (layout.shell_log_dock === side) patch.log_panel_open = false;
  if (layout.properties_panel_dock === side) patch.properties_panel_open = false;
  if (gitCommitPanelDock(layout) === side) patch.git_commit_panel_open = false;
  return patch;
}

export function buildExpandSidePatch(
  layout: ShellLayout,
  side: SideDock,
  snapshot: SidePanelSnapshot | null,
): Partial<ShellLayout> {
  const snap = snapshot ?? { tree: true, log: true, props: true, git: true };
  const patch: Partial<ShellLayout> = {};
  if (layout.workspace_tree_dock === side && snap.tree) patch.right_panel_open = true;
  if (layout.shell_log_dock === side && snap.log) patch.log_panel_open = true;
  if (layout.properties_panel_dock === side && snap.props) patch.properties_panel_open = true;
  if (gitCommitPanelDock(layout) === side && snap.git) patch.git_commit_panel_open = true;

  const wouldOpen = Boolean(
    (patch.right_panel_open && layout.workspace_tree_dock === side) ||
      (patch.log_panel_open && layout.shell_log_dock === side) ||
      (patch.properties_panel_open && layout.properties_panel_dock === side) ||
      (patch.git_commit_panel_open && gitCommitPanelDock(layout) === side),
  );
  if (wouldOpen) return patch;

  if (layout.workspace_tree_dock === side) patch.right_panel_open = true;
  else if (layout.shell_log_dock === side) patch.log_panel_open = true;
  else if (layout.properties_panel_dock === side) patch.properties_panel_open = true;
  else if (gitCommitPanelDock(layout) === side) patch.git_commit_panel_open = true;
  return patch;
}

export function isSideVisible(
  layout: ShellLayout,
  side: SideDock,
  ctx: SideDockVisibilityContext = {},
): boolean {
  const vis = sideDockVisibility(layout, ctx);
  return side === "left" ? vis.leftVisible : vis.rightVisible;
}
