import type { ShellLayout } from "../types/config";

export type SideDock = "left" | "right";

export type SideDockVisibility = {
  leftVisible: boolean;
  rightVisible: boolean;
  leftShowTree: boolean;
  leftShowLog: boolean;
  rightShowTree: boolean;
  rightShowLog: boolean;
};

export function sideDockVisibility(layout: ShellLayout): SideDockVisibility {
  const treeLeft = layout.workspace_tree_dock === "left";
  const treeRight = layout.workspace_tree_dock === "right";
  const logLeft = layout.shell_log_dock === "left";
  const logRight = layout.shell_log_dock === "right";
  const treeOpen = layout.right_panel_open;
  const logOpen = layout.log_panel_open;

  const leftShowTree = treeLeft && treeOpen;
  const leftShowLog = logLeft && logOpen;
  const rightShowTree = treeRight && treeOpen;
  const rightShowLog = logRight && logOpen;

  return {
    leftVisible: leftShowTree || leftShowLog,
    rightVisible: rightShowTree || rightShowLog,
    leftShowTree,
    leftShowLog,
    rightShowTree,
    rightShowLog,
  };
}
