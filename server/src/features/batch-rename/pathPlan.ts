import path from "node:path";
import { pnwPlanCodeRename, type PnwCodeRenameEntry } from "@phoenix-wing/code-core";

/** Rules are resolved once by Wing; its path planner validates each resolved basename. */
export function planRenameBasename(rel: string, name: string, targetName: string, kind: "file" | "dir", siblings: readonly PnwCodeRenameEntry[]) {
  const fallback = path.posix.join(path.posix.dirname(rel), targetName);
  if (name === targetName) return { target: rel };
  const plan = pnwPlanCodeRename(siblings, { oldText: name, newText: targetName, levels: [kind], caseSensitivePaths: false });
  const change = plan.changes.find(item => item.level === kind && item.relativePath === rel);
  return { target: change?.targetPath || fallback, problem: !plan.valid ? plan.diagnostics.join("；") : change?.status === "conflict" ? change.detail : undefined };
}
