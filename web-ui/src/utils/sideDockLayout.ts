import type { ShellLayout } from "../types/config";

export type SideDock = "left" | "right";

export type SideDockVisibility = {
  leftVisible: boolean;
  rightVisible: boolean;
  leftShowTree: boolean;
  leftShowLog: boolean;
  leftShowProps: boolean;
  rightShowTree: boolean;
  rightShowLog: boolean;
  rightShowProps: boolean;
};

export function sideDockVisibility(layout: ShellLayout): SideDockVisibility {
  const treeLeft = layout.workspace_tree_dock === "left";
  const treeRight = layout.workspace_tree_dock === "right";
  const logLeft = layout.shell_log_dock === "left";
  const logRight = layout.shell_log_dock === "right";
  const propsLeft = layout.properties_panel_dock === "left";
  const propsRight = layout.properties_panel_dock === "right";
  const treeOpen = layout.right_panel_open;
  const logOpen = layout.log_panel_open;
  const propsOpen = layout.properties_panel_open;

  const leftShowTree = treeLeft && treeOpen;
  const leftShowLog = logLeft && logOpen;
  const leftShowProps = propsLeft && propsOpen;
  const rightShowTree = treeRight && treeOpen;
  const rightShowLog = logRight && logOpen;
  const rightShowProps = propsRight && propsOpen;

  return {
    leftVisible: leftShowTree || leftShowLog || leftShowProps,
    rightVisible: rightShowTree || rightShowLog || rightShowProps,
    leftShowTree,
    leftShowLog,
    leftShowProps,
    rightShowTree,
    rightShowLog,
    rightShowProps,
  };
}
