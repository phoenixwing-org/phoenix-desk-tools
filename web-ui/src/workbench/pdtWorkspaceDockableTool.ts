import {
  pnwNormalizeDockableToolState,
  pnwReduceDockableToolState,
  type PnwDockableToolDefinition,
  type PnwDockableToolState,
} from "phoenix-wing";

export const PDT_WORKSPACE_TOOL_STATE_KEY = "phoenix-desk-workspace-tool-v1";

export const PDT_WORKSPACE_TOOL_DEFINITION = {
  id: "phoenix-desk.workspace",
  title: "工作空间",
  ariaLabel: "工作空间工具",
  scope: "application",
  frame: {
    ownerKind: "tool",
    movable: true,
    resizable: "both",
    recommendedSize: { width: 420, height: 320 },
    minSize: { width: 300, height: 220 },
    maxSize: { width: 720, height: 680 },
    rememberBounds: true,
    closeBehavior: "close",
  },
} as const satisfies PnwDockableToolDefinition;

export function pdtCreateWorkspaceToolState(
  stored?: Partial<PnwDockableToolState> | null,
): PnwDockableToolState {
  return pnwNormalizeDockableToolState(stored ?? {
    mode: "closed",
    floatingPosition: { x: 36, y: 96 },
    floatingSize: { width: 420, height: 320 },
    primaryPlacement: "first",
    primaryExpanded: true,
  });
}

export function pdtToggleWorkspaceTool(state: PnwDockableToolState): PnwDockableToolState {
  return pnwReduceDockableToolState(state, {
    type: state.mode === "closed" ? "open-floating" : "close",
  });
}
