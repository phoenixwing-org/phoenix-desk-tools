/** pnwCadScan — CAD 文件扫描，对应 Python cad_index/scan_paths.py + context.py */

import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([
  ".git", "__pycache__", ".obsidian", ".phoenix", "node_modules",
  ".cursor", "temp", ".venv", ".venv-desktop", "web-ui", "dist", "build",
]);

const CAD_EXTENSIONS = new Set([
  ".fcstd", ".FCStd", ".FCSTD",
  ".step", ".stp", ".STEP", ".STP",
  ".sldprt", ".SLDPRT", ".sldasm", ".SLDASM",
  ".dxf", ".DXF", ".dwg", ".DWG",
  ".md", ".MD", ".pdf", ".PDF",
  ".png", ".PNG", ".jpg", ".JPG", ".jpeg", ".JPEG", ".gif", ".GIF", ".svg", ".SVG",
]);

export function isCadIndexFilename(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return CAD_EXTENSIONS.has(ext) || CAD_EXTENSIONS.has(path.extname(name));
}

/** os.walk → { filename: [repo_rel_path, ...] } */
export function scanCadBasenameMap(scanRoot: string, anchor: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const root = path.resolve(scanRoot);
  const base = path.resolve(anchor);

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile() && isCadIndexFilename(e.name)) {
        const abs = path.join(dir, e.name);
        let rel = path.relative(base, abs).replace(/\\/g, "/");
        if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`;
        const arr = out.get(e.name) || [];
        arr.push(rel);
        out.set(e.name, arr);
      }
    }
  }

  walk(root);
  for (const paths of out.values()) paths.sort();
  return out;
}

/** 扫描并返回文件数量统计 */
export function scanCadStats(scanRoot: string): { files: number; fcstd: number; others: number } {
  const map = scanCadBasenameMap(scanRoot, scanRoot);
  let fcstd = 0, others = 0;
  for (const [name, paths] of map) {
    if (/\.fcstd$/i.test(name)) fcstd += paths.length;
    else others += paths.length;
  }
  return { files: fcstd + others, fcstd, others };
}
