import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadWorkbenchSession,
  saveWorkbenchSession,
} from "./workbenchSessionService.js";

const tempRoots: string[] = [];

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-session-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("workbench session service", () => {
  it("returns an empty envelope before the database exists", () => {
    const workspace = makeWorkspace();
    expect(loadWorkbenchSession(workspace)).toMatchObject({
      version: 1,
      session: null,
      updated_at: null,
      database_path_display: ".phoenix/phoenix-workspace.sqlite",
    });
  });

  it("persists and reloads the Python-compatible workbench scope", () => {
    const workspace = makeWorkspace();
    const saved = saveWorkbenchSession(workspace, {
      version: 99,
      active_tab_id: "tab-code",
      tabs: [{ id: "tab-code", pageId: "code_ignore" }, null, "bad"],
      ignored: true,
    });
    expect(saved.session).toEqual({
      version: 1,
      active_tab_id: "tab-code",
      tabs: [{ id: "tab-code", pageId: "code_ignore" }],
    });
    expect(saved.updated_at).toBeTruthy();
    expect(loadWorkbenchSession(workspace)).toMatchObject({
      version: 1,
      session: saved.session,
      updated_at: saved.updated_at,
    });
  });
});
