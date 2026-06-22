/** 将绝对路径转为相对工作空间根的路径；不在工作空间内则返回 null */
export function toRepoRelativePath(absPath: string, workspaceRoot: string): string | null {
  const norm = (p: string) => p.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const abs = norm(absPath);
  const root = norm(workspaceRoot);
  if (!abs || !root) return null;
  const absLower = abs.toLowerCase();
  const rootLower = root.toLowerCase();
  if (absLower === rootLower) return ".";
  const prefix = `${rootLower}/`;
  if (!absLower.startsWith(prefix)) return null;
  const rel = abs.slice(root.length).replace(/^\//, "");
  return rel || ".";
}

/** 解析相对路径 hint 为绝对路径（供原生选目录 initialdir） */
export function resolveWorkspacePathHint(workspaceRoot: string, relHint: string): string {
  const root = workspaceRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const rel = relHint.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!root) return relHint;
  if (!rel || rel === ".") return root;
  return `${root}/${rel.replace(/^\/+/, "")}`;
}
