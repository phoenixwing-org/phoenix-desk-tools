import { describe, expect, it } from "vitest";
import {
  pnwIsDockableToolVisible,
  pnwReduceDockableToolState,
  type PnwDockableToolDefinition,
} from "phoenix-wing";
import {
  PDT_WORKSPACE_TOOL_DEFINITION,
  pdtCreateWorkspaceToolState,
  pdtToggleWorkspaceTool,
} from "./pdtWorkspaceDockableTool";

describe("Desk Workspace Dockable Tool", () => {
  it("uses one mutually exclusive mode and retains floating bounds across Primary", () => {
    const closed = pdtCreateWorkspaceToolState();
    const floating = pdtToggleWorkspaceTool(closed);
    const primary = pnwReduceDockableToolState(floating, { type: "dock-primary" });
    const restored = pnwReduceDockableToolState(primary, { type: "open-floating" });

    expect(floating.mode).toBe("floating");
    expect(primary.mode).toBe("primary");
    expect(restored).toMatchObject({
      mode: "floating",
      floatingPosition: { x: 36, y: 96 },
      floatingSize: { width: 420, height: 320 },
    });
    expect(pdtToggleWorkspaceTool(restored).mode).toBe("closed");
  });

  it("keeps application tools visible while a view-scoped tool follows its owner", () => {
    const state = pdtCreateWorkspaceToolState({ mode: "floating" });
    const viewTool = {
      id: "desk.view-only",
      title: "View only",
      scope: "view",
      ownerViewId: "view-a",
    } as const satisfies PnwDockableToolDefinition;

    expect(pnwIsDockableToolVisible(PDT_WORKSPACE_TOOL_DEFINITION, state, "view-b")).toBe(true);
    expect(pnwIsDockableToolVisible(viewTool, state, "view-a")).toBe(true);
    expect(pnwIsDockableToolVisible(viewTool, state, "view-b")).toBe(false);
  });
});
