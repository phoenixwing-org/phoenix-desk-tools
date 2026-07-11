import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  gitWorkspaceChanges,
  gitWorkspaceCommit,
  gitWorkspaceDiff,
  gitWorkspaceInfo,
  gitWorkspaceInit,
  gitWorkspaceRestore,
  gitWorkspaceStage,
  normalizeGitRepoPath,
} from "./gitWorkspaceService.js";

const roots: string[] = [];
const gitAvailable = spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;

function tempWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "git-workspace-service-"));
  roots.push(root);
  return root;
}

function git(root: string, args: string[]): void {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "git failed").trim());
}

function configureIdentity(root: string): void {
  git(root, ["config", "user.name", "Git Service Test"]);
  git(root, ["config", "user.email", "git-service@example.invalid"]);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe.skipIf(!gitAvailable)("git workspace service", () => {
  it("handles Unicode/space paths, untracked diff, and unstage before the first commit", () => {
    const workspace = tempWorkspace();
    expect(gitWorkspaceInfo(workspace)).toMatchObject({
      git_installed: true,
      repo_initialized: false,
    });
    expect(gitWorkspaceInit(workspace)).toMatchObject({ ok: true, git_root: workspace });

    const rel = "目录/hello world.txt";
    const target = path.join(workspace, "目录", "hello world.txt");
    fs.mkdirSync(path.dirname(target));
    fs.writeFileSync(target, "hello\n", "utf8");
    fs.mkdirSync(path.join(workspace, ".phoenix"));
    fs.writeFileSync(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"), "runtime\n", "utf8");

    expect(gitWorkspaceChanges(workspace).untracked).toEqual([
      expect.objectContaining({ path: rel, untracked: true }),
    ]);
    expect(gitWorkspaceDiff(workspace, rel)).toMatchObject({
      path: rel,
      has_diff: true,
      is_binary: false,
      unified_diff: expect.stringContaining("+hello"),
    });

    expect(gitWorkspaceStage(workspace, [rel])).toEqual({ staged: [rel] });
    expect(gitWorkspaceChanges(workspace).staged).toEqual([
      expect.objectContaining({ path: rel, index_status: "A" }),
    ]);
    expect(gitWorkspaceRestore(workspace, [rel], "staged")).toEqual({
      restored: [rel],
      scope: "staged",
    });
    expect(gitWorkspaceChanges(workspace).untracked[0]?.path).toBe(rel);

    expect(gitWorkspaceRestore(workspace, [rel], "untracked")).toEqual({
      restored: [rel],
      scope: "untracked",
    });
    expect(fs.existsSync(target)).toBe(false);
    expect(gitWorkspaceChanges(workspace).untracked).toEqual([]);
  }, 20_000);

  it("commits, previews staged/worktree changes, and restores tracked content", () => {
    const workspace = tempWorkspace();
    gitWorkspaceInit(workspace);
    configureIdentity(workspace);
    const target = path.join(workspace, "tracked.txt");
    fs.writeFileSync(target, "one\n", "utf8");
    gitWorkspaceStage(workspace, ["tracked.txt"]);
    const first = gitWorkspaceCommit(workspace, "initial commit");
    expect(first).toMatchObject({
      committed_paths: ["tracked.txt"],
      message: "initial commit",
    });
    expect(first.commit_sha).toHaveLength(7);

    fs.writeFileSync(target, "two\n", "utf8");
    expect(gitWorkspaceDiff(workspace, "tracked.txt", "worktree").unified_diff).toContain("+two");
    gitWorkspaceStage(workspace, ["tracked.txt"]);
    expect(gitWorkspaceDiff(workspace, "tracked.txt", "staged").unified_diff).toContain("+two");

    gitWorkspaceRestore(workspace, ["tracked.txt"], "staged");
    expect(gitWorkspaceChanges(workspace).changes[0]?.path).toBe("tracked.txt");
    gitWorkspaceRestore(workspace, ["tracked.txt"], "worktree");
    expect(fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n")).toBe("one\n");
    expect(gitWorkspaceChanges(workspace)).toMatchObject({
      staged_count: 0,
      unstaged_count: 0,
    });
  });

  it("parses staged renames without C-style path corruption", () => {
    const workspace = tempWorkspace();
    gitWorkspaceInit(workspace);
    configureIdentity(workspace);
    fs.writeFileSync(path.join(workspace, "old name.txt"), "same\n", "utf8");
    gitWorkspaceStage(workspace, ["old name.txt"]);
    gitWorkspaceCommit(workspace, "add old");

    fs.renameSync(path.join(workspace, "old name.txt"), path.join(workspace, "新 name.txt"));
    gitWorkspaceStage(workspace, ["old name.txt", "新 name.txt"]);
    expect(gitWorkspaceChanges(workspace).staged).toEqual([
      expect.objectContaining({
        path: "新 name.txt",
        original_path: "old name.txt",
        index_status: "R",
      }),
    ]);
  });

  it("detects binary changes and rejects stale destructive restore requests", () => {
    const workspace = tempWorkspace();
    gitWorkspaceInit(workspace);
    configureIdentity(workspace);
    const binary = path.join(workspace, "blob.bin");
    fs.writeFileSync(binary, Buffer.from([0, 1, 2]));
    gitWorkspaceStage(workspace, ["blob.bin"]);
    gitWorkspaceCommit(workspace, "add binary");
    fs.writeFileSync(binary, Buffer.from([0, 1, 3]));
    expect(gitWorkspaceDiff(workspace, "blob.bin")).toMatchObject({
      has_diff: true,
      is_binary: true,
      unified_diff: "",
    });

    const keep = path.join(workspace, "keep.txt");
    fs.writeFileSync(keep, "keep\n", "utf8");
    expect(() => gitWorkspaceRestore(workspace, ["other.txt"], "untracked"))
      .toThrow("Paths are no longer present");
    expect(fs.existsSync(keep)).toBe(true);
  });

  it("enforces repository-relative paths and commit message limits", () => {
    expect(normalizeGitRepoPath(".gitignore")).toBe(".gitignore");
    expect(normalizeGitRepoPath("./src/a.cpp")).toBe("src/a.cpp");
    expect(() => normalizeGitRepoPath("../outside")).toThrow("Invalid repository path");
    expect(() => normalizeGitRepoPath(".git/config")).toThrow("Invalid repository path");
    expect(() => normalizeGitRepoPath("C:/outside")).toThrow("Invalid repository path");

    const workspace = tempWorkspace();
    gitWorkspaceInit(workspace);
    expect(() => gitWorkspaceCommit(workspace, "x".repeat(4097)))
      .toThrow("cannot exceed 4096 characters");
    expect(() => gitWorkspaceStage(workspace, [".phoenix/phoenix-workspace.sqlite"]))
      .toThrow("runtime database cannot be changed");
  });
});
