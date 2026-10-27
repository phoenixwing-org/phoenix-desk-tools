import fs from "node:fs";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { fcstdWorkspace, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";

const excluded = new Set(["node_modules", "__pycache__", ".venv"]);
export async function scanDrawingCandidates(workspace: string, directory: string, recursive = false) {
  const root = fcstdWorkspace(workspace);
  if (typeof directory !== "string" || !directory.trim()) throw new Error("请选择搜索目录");
  const scope = directory.replace(/\\/g, "/");
  if (scope.split("/").some(x => (x.startsWith(".") && x !== ".") || excluded.has(x))) throw new Error("不搜索隐藏或缓存目录");
  const start = safeFcstdPath(root, scope);
  if (!fs.statSync(start).isDirectory()) throw new Error("搜索范围必须是目录");
  const files: string[] = [], warnings: string[] = [], stack = [start];
  let visited = 0;
  while (stack.length) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(safeFcstdPath(root, path.relative(root, current)), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const item of entries) {
      if (++visited > 20000) throw new Error("范围超过 20000 项，请缩小目录");
      if (visited % 50 === 0) await setImmediate();
      if (item.name.startsWith(".") || excluded.has(item.name)) continue;
      const rel = path.relative(root, path.join(current, item.name)).replace(/\\/g, "/");
      if (item.isSymbolicLink()) { warnings.push(`${rel}：已跳过符号链接`); continue; }
      if (item.isDirectory()) { if (recursive) stack.push(safeFcstdPath(root, rel)); continue; }
      if (!item.isFile() || !/\.fcstd$/i.test(item.name)) continue;
      if (files.length >= 500) throw new Error("范围超过 500 个 FCStd，请缩小目录");
      safeFcstdPath(root, rel); files.push(rel);
    }
  }
  return { root, directory: path.relative(root, start).replace(/\\/g, "/") || ".", recursive: Boolean(recursive), files, scanned: files.length, warnings };
}
