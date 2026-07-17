import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type GitRestoreScope = "worktree" | "staged" | "untracked";
export type GitDiffScope = "worktree" | "staged";

export interface GitChangeEntry {
  path: string;
  original_path?: string;
  index_status: string;
  worktree_status: string;
  staged: boolean;
  modified: boolean;
  untracked: boolean;
  has_worktree_change: boolean;
  has_staged_change: boolean;
  section?: "changes" | "staged" | "untracked";
}

export interface GitChangesPayload {
  entries: GitChangeEntry[];
  changes: GitChangeEntry[];
  untracked: GitChangeEntry[];
  staged: GitChangeEntry[];
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
}

type GitResult = {
  status: number;
  stdout: string;
  stderr: string;
};

const MAX_DIFF_CHARS = 512 * 1024;
const COMMIT_MESSAGE_MAX_LENGTH = 4096;

function isPhoenixRuntimeDatabasePath(rawPath: string): boolean {
  const rel = String(rawPath || "").replace(/\\/g, "/").toLowerCase();
  return rel === ".phoenix/phoenix-workspace.sqlite"
    || rel.startsWith(".phoenix/phoenix-workspace.sqlite-")
    || rel === ".phoenix/runtime-catalog.sqlite"
    || rel.startsWith(".phoenix/runtime-catalog.sqlite-");
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function runGit(gitRoot: string, args: string[]): GitResult {
  const trustedRoot = path.resolve(gitRoot);
  const proc = spawnSync("git", [
    "-c",
    "core.quotepath=false",
    "-c",
    `safe.directory=${trustedRoot}`,
    "-C",
    trustedRoot,
    ...args,
  ], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    status: proc.status ?? 1,
    stdout: proc.stdout || "",
    stderr: proc.stderr || proc.error?.message || "",
  };
}

function gitError(result: GitResult, fallback: string): Error {
  return new Error((result.stderr || result.stdout || fallback).trim());
}

export function gitExecutableAvailable(): boolean {
  const proc = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
  return proc.status === 0;
}

function gitRootForWorkspace(workspace: string): string | null {
  const root = path.resolve(workspace || ".");
  if (!workspace || !isDirectory(root) || !fs.existsSync(path.join(root, ".git"))) return null;
  const result = runGit(root, ["rev-parse", "--show-toplevel"]);
  if (result.status !== 0) return null;
  const top = path.resolve(result.stdout.trim());
  const comparableRoot = canonicalPath(root);
  const comparableTop = canonicalPath(top);
  return process.platform === "win32"
    ? comparableTop.toLowerCase() === comparableRoot.toLowerCase() ? root : null
    : comparableTop === comparableRoot ? root : null;
}

function canonicalPath(value: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

export function normalizeGitRepoPath(raw: string): string {
  const normalized = String(raw || "").replace(/\\/g, "/").trim().replace(/^\.\/+/, "");
  if (
    !normalized
    || normalized.includes("\0")
    || path.posix.isAbsolute(normalized)
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.startsWith("//")
  ) {
    throw new Error(`Invalid repository path: ${raw}`);
  }
  const segments = normalized.split("/");
  if (segments.includes("..") || segments[0] === ".git") {
    throw new Error(`Invalid repository path: ${raw}`);
  }
  return normalized;
}

function resolveRepoPath(workspace: string, raw: string): { full: string; rel: string } {
  const rel = normalizeGitRepoPath(raw);
  const root = path.resolve(workspace);
  const full = path.resolve(root, rel);
  const back = path.relative(root, full);
  if (!back || back.startsWith("..") || path.isAbsolute(back)) {
    throw new Error(`Repository path escapes the workspace: ${raw}`);
  }
  return { full, rel };
}

function emptyChanges(): GitChangesPayload {
  return {
    entries: [],
    changes: [],
    untracked: [],
    staged: [],
    staged_count: 0,
    unstaged_count: 0,
    untracked_count: 0,
  };
}

function parsePorcelainZ(output: string): GitChangeEntry[] {
  const records = output.split("\0");
  const entries: GitChangeEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const indexStatus = record[0] || " ";
    const worktreeStatus = record[1] || " ";
    const rel = record.slice(3).replace(/\\/g, "/");
    if (!rel) continue;
    const renamedOrCopied = ["R", "C"].includes(indexStatus) || ["R", "C"].includes(worktreeStatus);
    const originalPath = renamedOrCopied
      ? String(records[index + 1] || "").replace(/\\/g, "/")
      : "";
    if (renamedOrCopied) index += 1;
    const untracked = indexStatus === "?" && worktreeStatus === "?";
    const staged = ![" ", "?", "!"].includes(indexStatus);
    const hasWorktreeChange = ![" ", "?", "!"].includes(worktreeStatus);
    entries.push({
      path: rel,
      ...(originalPath ? { original_path: originalPath } : {}),
      index_status: indexStatus,
      worktree_status: worktreeStatus,
      staged,
      modified: hasWorktreeChange && !untracked,
      untracked,
      has_worktree_change: hasWorktreeChange,
      has_staged_change: staged,
    });
  }
  return entries;
}

export function gitWorkspaceInfo(workspace: string) {
  const installed = gitExecutableAvailable();
  const gitRoot = installed ? gitRootForWorkspace(workspace) : null;
  return {
    git_installed: installed,
    repo_initialized: Boolean(gitRoot),
    git_root: gitRoot,
    git_root_display: gitRoot,
    scope_note: "Only the configured workspace root is inspected; parent repositories and submodules are not followed.",
  };
}

export function gitWorkspaceChanges(workspace: string): GitChangesPayload {
  const gitRoot = gitRootForWorkspace(workspace);
  if (!gitRoot) return emptyChanges();
  const result = runGit(gitRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (result.status !== 0) throw gitError(result, "git status failed");

  const entries = parsePorcelainZ(result.stdout)
    .filter((entry) => !isPhoenixRuntimeDatabasePath(entry.path));
  const changes: GitChangeEntry[] = [];
  const untracked: GitChangeEntry[] = [];
  const staged: GitChangeEntry[] = [];
  for (const entry of entries) {
    if (entry.untracked) untracked.push({ ...entry, section: "untracked" });
    else if (entry.has_worktree_change) changes.push({ ...entry, section: "changes" });
    if (entry.has_staged_change) staged.push({ ...entry, section: "staged" });
  }
  return {
    entries,
    changes,
    untracked,
    staged,
    staged_count: staged.length,
    unstaged_count: changes.length + untracked.length,
    untracked_count: untracked.length,
  };
}

function isBinaryDiff(text: string): boolean {
  return text.includes("GIT binary patch")
    || (text.includes("Binary files") && text.includes(" differ"));
}

export function gitWorkspaceDiff(
  workspace: string,
  rawPath: string,
  scope: GitDiffScope = "worktree",
) {
  const gitRoot = gitRootForWorkspace(workspace);
  if (!gitRoot) throw new Error("Current workspace is not a Git repository");
  if (scope !== "worktree" && scope !== "staged") {
    throw new Error("scope must be worktree or staged");
  }
  const resolved = resolveRepoPath(gitRoot, rawPath);
  const tracked = runGit(gitRoot, ["ls-files", "--error-unmatch", "--", resolved.rel]).status === 0;
  let result: GitResult;
  if (scope === "worktree" && !tracked && fs.existsSync(resolved.full)) {
    if (!fs.statSync(resolved.full).isFile()) throw new Error(`Diff target is not a file: ${resolved.rel}`);
    result = runGit(gitRoot, ["diff", "--no-index", "-U3", "--", "/dev/null", resolved.rel]);
  } else {
    result = runGit(gitRoot, scope === "staged"
      ? ["diff", "--cached", "-U3", "--", resolved.rel]
      : ["diff", "-U3", "--", resolved.rel]);
  }
  if (result.status !== 0 && result.status !== 1) throw gitError(result, "git diff failed");

  let text = result.stdout || "";
  if (isBinaryDiff(text)) {
    return {
      path: resolved.rel,
      scope,
      has_diff: true,
      is_binary: true,
      unified_diff: "",
      truncated: false,
      message: "Binary file changed; diff preview is unavailable.",
    };
  }
  if (!text.trim()) {
    return {
      path: resolved.rel,
      scope,
      has_diff: false,
      is_binary: false,
      unified_diff: "",
      truncated: false,
      message: tracked ? "No Git diff for this file." : "The untracked file is empty.",
    };
  }
  const truncated = text.length > MAX_DIFF_CHARS;
  if (truncated) text = `${text.slice(0, MAX_DIFF_CHARS)}\n\n...(diff truncated)\n`;
  return {
    path: resolved.rel,
    scope,
    has_diff: true,
    is_binary: false,
    unified_diff: text,
    truncated,
    message: null,
  };
}

export function gitWorkspaceInit(workspace: string) {
  const root = path.resolve(workspace || ".");
  if (!workspace || !isDirectory(root)) throw new Error("Workspace is not configured");
  if (!gitExecutableAvailable()) throw new Error("Git is not installed or is not available on PATH");
  if (gitRootForWorkspace(root)) throw new Error("Workspace already has .git");
  const result = runGit(root, ["init"]);
  if (result.status !== 0) throw gitError(result, "git init failed");
  if (!gitRootForWorkspace(root)) throw new Error("git init completed but the repository root was not detected");
  return { ok: true, git_root: root, git_root_display: root };
}

function normalizedPaths(rawPaths: unknown): string[] {
  if (!Array.isArray(rawPaths)) return [];
  const paths = [...new Set(rawPaths.map((item) => normalizeGitRepoPath(String(item || ""))))];
  const runtimePaths = paths.filter(isPhoenixRuntimeDatabasePath);
  if (runtimePaths.length) {
    throw new Error(`Phoenix runtime database cannot be changed from the Git page: ${runtimePaths.join(", ")}`);
  }
  return paths;
}

export function gitWorkspaceStage(workspace: string, rawPaths: unknown) {
  const gitRoot = gitRootForWorkspace(workspace);
  if (!gitRoot) throw new Error("Current workspace is not a Git repository");
  const paths = normalizedPaths(rawPaths);
  if (!paths.length) throw new Error("No paths specified");
  const result = runGit(gitRoot, ["add", "--", ...paths]);
  if (result.status !== 0) throw gitError(result, "git add failed");
  return { staged: paths };
}

function assertRestorePaths(
  workspace: string,
  paths: string[],
  scope: GitRestoreScope,
): void {
  const payload = gitWorkspaceChanges(workspace);
  const rows = scope === "staged"
    ? payload.staged
    : scope === "untracked"
      ? payload.untracked
      : payload.changes;
  const allowed = new Set(rows.map((row) => row.path));
  const stale = paths.filter((rel) => !allowed.has(rel));
  if (stale.length) {
    throw new Error(`Paths are no longer present in the ${scope} change set: ${stale.join(", ")}`);
  }
}

export function gitWorkspaceRestore(
  workspace: string,
  rawPaths: unknown,
  scope: GitRestoreScope = "worktree",
) {
  const gitRoot = gitRootForWorkspace(workspace);
  if (!gitRoot) throw new Error("Current workspace is not a Git repository");
  if (!["worktree", "staged", "untracked"].includes(scope)) throw new Error("Invalid restore scope");
  const paths = normalizedPaths(rawPaths);
  if (!paths.length) throw new Error("No paths specified");
  assertRestorePaths(gitRoot, paths, scope);

  let result: GitResult;
  if (scope === "staged") {
    result = runGit(gitRoot, ["restore", "--staged", "--", ...paths]);
    if (result.status !== 0 && runGit(gitRoot, ["rev-parse", "--verify", "HEAD"]).status !== 0) {
      result = runGit(gitRoot, ["rm", "--cached", "-r", "--ignore-unmatch", "--", ...paths]);
    }
  } else if (scope === "untracked") {
    result = runGit(gitRoot, ["clean", "-fd", "--", ...paths]);
  } else {
    result = runGit(gitRoot, ["restore", "--", ...paths]);
    if (result.status !== 0) {
      result = runGit(gitRoot, ["checkout", "HEAD", "--", ...paths]);
    }
  }
  if (result.status !== 0) throw gitError(result, "git restore failed");
  return { restored: paths, scope };
}

function isCommitIdentityError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("user.name")
    || lower.includes("user.email")
    || lower.includes("author identity unknown")
    || lower.includes("please tell me who you are");
}

export function gitWorkspaceCommit(workspace: string, rawMessage: unknown) {
  const gitRoot = gitRootForWorkspace(workspace);
  if (!gitRoot) throw new Error("Current workspace is not a Git repository");
  const message = String(rawMessage || "").trim();
  if (!message) throw new Error("Commit message is required");
  if (message.includes("\0")) throw new Error("Commit message contains an invalid NUL character");
  if (message.length > COMMIT_MESSAGE_MAX_LENGTH) {
    throw new Error(`Commit message cannot exceed ${COMMIT_MESSAGE_MAX_LENGTH} characters`);
  }
  const stagedPaths = gitWorkspaceChanges(gitRoot).staged.map((entry) => entry.path);
  if (!stagedPaths.length) throw new Error("No staged changes");

  const result = runGit(gitRoot, ["commit", "-m", message]);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    if (isCommitIdentityError(detail)) {
      throw new Error("Git user.name/user.email is not configured. Configure both values before committing.");
    }
    throw gitError(result, "git commit failed");
  }
  const shaResult = runGit(gitRoot, ["rev-parse", "HEAD"]);
  const sha = shaResult.status === 0 ? shaResult.stdout.trim().slice(0, 7) : "";
  return { commit_sha: sha, committed_paths: stagedPaths, message };
}
