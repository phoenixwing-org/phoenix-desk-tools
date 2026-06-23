export type GitWorkspaceInfo = {
  git_installed: boolean;
  repo_initialized: boolean;
  git_root: string | null;
  git_root_display: string | null;
  scope_note?: string;
};

export type GitChangeEntry = {
  path: string;
  index_status: string;
  worktree_status: string;
  staged: boolean;
  modified: boolean;
  untracked: boolean;
  has_worktree_change?: boolean;
  has_staged_change?: boolean;
  section?: "changes" | "staged" | "untracked";
};

export type GitChangesPayload = {
  entries: GitChangeEntry[];
  changes: GitChangeEntry[];
  untracked: GitChangeEntry[];
  staged: GitChangeEntry[];
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
};

export type GitCommitResult = {
  commit_sha: string;
  committed_paths: string[];
  message: string;
};

export type GitFileDiff = {
  path: string;
  scope?: "worktree" | "staged";
  has_diff: boolean;
  is_binary: boolean;
  unified_diff: string;
  truncated: boolean;
  message?: string | null;
};
