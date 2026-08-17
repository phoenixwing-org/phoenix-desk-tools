import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./gitWorkspaceService.ts", import.meta.url), "utf8");

describe("Desk Git shared Node boundary", () => {
  it("delegates Git process execution to Wing while retaining Desk workflow rules", () => {
    expect(source).toContain('from "@phoenix-wing/git-node"');
    expect(source).toContain("await pnwRunGitCommand(");
    expect(source).toContain("isPhoenixRuntimeDatabasePath");
    expect(source).toContain("assertRestorePaths");
    expect(source).not.toContain('from "node:child_process"');
    expect(source).not.toContain("spawnSync(");
    expect(source).not.toContain("execFile(");
  });
});
