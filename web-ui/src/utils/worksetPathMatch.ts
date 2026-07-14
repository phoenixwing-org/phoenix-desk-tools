export type WorksetPathLike = string | { path: string; type?: "file" | "dir" };

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export function matchesWorksetPath(repoRelPath: string, entries: WorksetPathLike[]): boolean {
  const candidate = normalizePath(repoRelPath);
  if (!candidate) return false;
  return entries.some((entry) => {
    const entryPath = normalizePath(typeof entry === "string" ? entry : entry.path);
    if (!entryPath) return false;
    const type = typeof entry === "string" ? "file" : entry.type || "file";
    return type === "dir"
      ? candidate === entryPath || candidate.startsWith(`${entryPath}/`)
      : candidate === entryPath;
  });
}
