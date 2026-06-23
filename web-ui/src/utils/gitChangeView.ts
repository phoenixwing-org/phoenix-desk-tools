import type { GitChangeEntry } from "../types/gitWorkspace";

export type GitListViewMode = "file" | "tree";

export type GitChangeTreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  entry?: GitChangeEntry;
  children?: GitChangeTreeNode[];
};

type MutableDir = {
  type: "dir";
  name: string;
  path: string;
  children: Map<string, MutableDir | MutableFile>;
};

type MutableFile = {
  type: "file";
  name: string;
  path: string;
  entry: GitChangeEntry;
};

const LIST_VIEW_STORAGE_KEY = "phoenix-git-list-view-v1";

export function readGitListViewMode(): GitListViewMode {
  try {
    const raw = localStorage.getItem(LIST_VIEW_STORAGE_KEY);
    if (raw === "file" || raw === "tree") return raw;
  } catch {
    /* ignore */
  }
  return "file";
}

export function persistGitListViewMode(mode: GitListViewMode) {
  try {
    localStorage.setItem(LIST_VIEW_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function gitFileName(repoRelPath: string): string {
  const normalized = repoRelPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

export function gitStatusLabel(row: GitChangeEntry): string {
  if (row.untracked) return "?";
  const parts: string[] = [];
  if (row.index_status.trim() && row.index_status !== "?") parts.push(row.index_status);
  if (row.worktree_status.trim() && row.worktree_status !== "?") parts.push(row.worktree_status);
  return parts.join("") || "·";
}

export type GitStatusKind =
  | "untracked"
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "conflict";

export type GitStatusDisplay = {
  label: string;
  kind: GitStatusKind;
  title: string;
};

const STATUS_WORD: Record<string, string> = {
  M: "修改",
  A: "新增",
  D: "删除",
  R: "重命名",
  C: "复制",
  T: "类型变更",
};

function sectionWord(row: GitChangeEntry): string {
  if (row.section === "staged") return "已暂存";
  if (row.section === "untracked") return "未跟踪";
  return "更改";
}

/** 单行状态徽章：字母 + 颜色 + tooltip（对齐 VS Code / git status 简写） */
export function resolveGitStatusDisplay(row: GitChangeEntry): GitStatusDisplay {
  const block = sectionWord(row);

  if (row.untracked) {
    return { label: "A", kind: "untracked", title: `${block} · 未跟踪 · 新文件` };
  }

  const idx = row.index_status;
  const wt = row.worktree_status;

  if (idx === "U" || wt === "U") {
    return { label: "!", kind: "conflict", title: `${block} · 未合并 · 冲突` };
  }

  const titled = (char: string, kind: GitStatusKind, detail: string): GitStatusDisplay => ({
    label: char,
    kind,
    title: `${block} · ${STATUS_WORD[char] ?? char} · ${detail}`,
  });

  if (idx === "R" || wt === "R") {
    return titled("R", "renamed", idx === "R" ? "已暂存" : "工作区");
  }
  if (idx === "C" || wt === "C") {
    return titled("C", "copied", idx === "C" ? "已暂存" : "工作区");
  }
  if (idx === "D" || wt === "D") {
    if (idx === "D" && wt === "D") return titled("D", "deleted", "已暂存且工作区");
    if (idx === "D") return titled("D", "deleted", "已暂存");
    return titled("D", "deleted", "工作区");
  }
  if (idx === "A") {
    return titled("A", "added", wt === "M" ? "已暂存 · 工作区仍有修改" : "已暂存");
  }
  if (wt === "A") {
    return titled("A", "added", "工作区");
  }
  if (idx === "T" || wt === "T") {
    return titled("T", "typechange", idx === "T" ? "已暂存" : "工作区");
  }
  if (idx === "M" || wt === "M") {
    if (idx === "M" && wt === "M") return titled("M", "modified", "已暂存 · 工作区仍有修改");
    if (idx === "M") return titled("M", "modified", "已暂存");
    return titled("M", "modified", "工作区");
  }

  const raw = gitStatusLabel(row);
  return {
    label: raw,
    kind: "modified",
    title: `${block} · 索引 ${idx || " "} / 工作区 ${wt || " "}`,
  };
}

export function buildGitChangeTree(entries: GitChangeEntry[]): GitChangeTreeNode[] {
  const root = new Map<string, MutableDir | MutableFile>();
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));

  for (const entry of sorted) {
    const parts = entry.path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (!parts.length) continue;

    let level = root;
    let dirPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isFile = i === parts.length - 1;

      if (isFile) {
        level.set(part, { type: "file", name: part, path: entry.path, entry });
        continue;
      }

      dirPath = dirPath ? `${dirPath}/${part}` : part;
      let node = level.get(part);
      if (!node || node.type !== "dir") {
        node = { type: "dir", name: part, path: dirPath, children: new Map() };
        level.set(part, node);
      }
      level = node.children;
    }
  }

  return mapToTreeNodes(root);
}

function mapToTreeNodes(map: Map<string, MutableDir | MutableFile>): GitChangeTreeNode[] {
  const nodes: GitChangeTreeNode[] = [];
  for (const node of map.values()) {
    if (node.type === "file") {
      nodes.push({
        name: node.name,
        path: node.path,
        type: "file",
        entry: node.entry,
      });
      continue;
    }
    nodes.push({
      name: node.name,
      path: node.path,
      type: "dir",
      children: mapToTreeNodes(node.children),
    });
  }
  return nodes.sort(compareTreeNodes);
}

function compareTreeNodes(a: GitChangeTreeNode, b: GitChangeTreeNode): number {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}
