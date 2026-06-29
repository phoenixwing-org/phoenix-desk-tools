import type { ShellLayout } from "../types/config";

export type SideDock = "left" | "right";

export type SideDockVisibility = {
  leftVisible: boolean;
  rightVisible: boolean;
  leftShowTree: boolean;
  leftShowCaaTree: boolean;
  leftShowLog: boolean;
  leftShowProps: boolean;
  leftShowGitCommit: boolean;
  leftShowWorkset: boolean;
  rightShowTree: boolean;
  rightShowLog: boolean;
  rightShowProps: boolean;
  rightShowGitCommit: boolean;
  rightShowWorkset: boolean;
};

export type SideDockVisibilityContext = {
  onGitPage?: boolean;
  onCaaPage?: boolean;
};

export function gitCommitPanelDock(layout: ShellLayout): SideDock {
  const dock = layout.git_commit_panel_dock;
  if (dock === "left" || dock === "right") return dock;
  return layout.properties_panel_dock;
}

export function sideDockVisibility(
  layout: ShellLayout,
  ctx: SideDockVisibilityContext = {},
): SideDockVisibility {
  const treeLeft = layout.workspace_tree_dock === "left";
  const treeRight = layout.workspace_tree_dock === "right";
  const logLeft = layout.shell_log_dock === "left";
  const logRight = layout.shell_log_dock === "right";
  const propsLeft = layout.properties_panel_dock === "left";
  const propsRight = layout.properties_panel_dock === "right";
  const gitLeft = gitCommitPanelDock(layout) === "left";
  const gitRight = gitCommitPanelDock(layout) === "right";
  const wsLeft = (layout.workset_panel_dock || "right") === "left";
  const wsRight = (layout.workset_panel_dock || "right") === "right";
  const treeOpen = layout.right_panel_open;
  const logOpen = layout.log_panel_open;
  const propsOpen = layout.properties_panel_open;
  const gitOpen = Boolean(ctx.onGitPage) && layout.git_commit_panel_open;
  const wsOpen = layout.workset_panel_open;

  const leftShowTree = treeLeft && treeOpen;
  const leftShowCaaTree = Boolean(ctx.onCaaPage);
  const leftShowLog = logLeft && logOpen;
  const leftShowProps = propsLeft && propsOpen;
  const leftShowGitCommit = gitLeft && gitOpen;
  const leftShowWorkset = wsLeft && wsOpen;
  const rightShowTree = treeRight && treeOpen;
  const rightShowLog = logRight && logOpen;
  const rightShowProps = propsRight && propsOpen;
  const rightShowGitCommit = gitRight && gitOpen;
  const rightShowWorkset = wsRight && wsOpen;

  return {
    leftVisible: leftShowTree || leftShowCaaTree || leftShowLog || leftShowProps || leftShowGitCommit || leftShowWorkset,
    rightVisible: rightShowTree || rightShowLog || rightShowProps || rightShowGitCommit || rightShowWorkset,
    leftShowTree,
    leftShowCaaTree,
    leftShowLog,
    leftShowProps,
    leftShowGitCommit,
    leftShowWorkset,
    rightShowTree,
    rightShowLog,
    rightShowProps,
    rightShowGitCommit,
    rightShowWorkset,
  };
}
