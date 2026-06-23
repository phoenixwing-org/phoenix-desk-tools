import fs from "node:fs";
import path from "node:path";

/** 自 cwd 向上查找含 phoenix/config/app_config.json 的目录 */
export function findRepoRoot(start = process.cwd()): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    const marker = path.join(dir, "phoenix", "config", "app_config.json");
    if (fs.existsSync(marker)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
