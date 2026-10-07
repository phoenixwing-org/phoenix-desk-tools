import fs from "node:fs";
import path from "node:path";
import { pnwNormalizeWorkspacePath } from "@phoenix-wing/code-core";
import { fcstdWorkspace, safeFcstdPath } from "./fcstdBatchFiles.js";

export class CadBatchDirectoryError extends Error {
  constructor(message: string, readonly status: 400 | 409 = 400) {
    super(message);
  }
}

function workspaceContext(requested: string, current: string) {
  if (!requested.trim()) throw new CadBatchDirectoryError("workspace is required");
  if (!current.trim()) throw new CadBatchDirectoryError("当前工作空间已关闭，请刷新后重试", 409);
  const workspace = path.resolve(current);
  const requestedRoot = path.resolve(requested);
  const key = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (key(workspace) !== key(requestedRoot)) {
    throw new CadBatchDirectoryError("工作空间已变化，请刷新后重试", 409);
  }
  try {
    return { workspace, root: fcstdWorkspace(workspace) };
  } catch {
    throw new CadBatchDirectoryError("当前工作空间目录不存在或不可用", 409);
  }
}

/** Only reads direct child directory metadata. Never initializes SQLite or scans files. */
export function listCadBatchDirectories(requested: string, current: string) {
  const { workspace, root } = workspaceContext(requested, current);
  const directories = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .flatMap((entry) => {
      const relative = pnwNormalizeWorkspacePath(entry.name);
      if (!relative) return [];
      try {
        // Recheck in case a directory became a link after readdir.
        if (!fs.statSync(safeFcstdPath(root, relative)).isDirectory()) return [];
        return [{ name: entry.name, path: relative }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { workspace, directories };
}

/** Validate input/native-picker output without following child symlinks. */
export function validateCadBatchDirectory(requested: string, current: string, directory: string) {
  const { workspace, root } = workspaceContext(requested, current);
  const input = directory.trim().replace(/\\/g, "/");
  if (!input) throw new CadBatchDirectoryError("请选择或输入搜索目录；工作空间根目录请使用 .");
  if (input.includes("\0") || input.split("/").includes("..")) {
    throw new CadBatchDirectoryError("搜索目录不能包含 .. 或无效字符");
  }
  const normalized = path.isAbsolute(input)
    ? pnwNormalizeWorkspacePath(path.relative(workspace, input).replace(/\\/g, "/") || ".")
      ?? pnwNormalizeWorkspacePath(path.relative(root, input).replace(/\\/g, "/") || ".")
    : pnwNormalizeWorkspacePath(input);
  if (!normalized) throw new CadBatchDirectoryError("搜索目录必须位于当前工作空间内");
  try {
    const candidate = safeFcstdPath(root, normalized);
    if (!fs.statSync(candidate).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new CadBatchDirectoryError("搜索目录不存在、不是目录或包含符号链接");
  }
  return { workspace, directory: normalized };
}
