import fs from "node:fs/promises";
import path from "node:path";

const SKIP_DIR_NAMES = new Set(
  [
    ".git",
    ".svn",
    ".hg",
    "__pycache__",
    ".venv",
    "venv",
    "node_modules",
    ".idea",
    ".vs",
    ".bundle",
    "Pods",
  ].map((s) => s.toLowerCase()),
);

function shouldSkipDir(name: string): boolean {
  const cf = name.toLowerCase();
  if (SKIP_DIR_NAMES.has(cf)) return true;
  return name.startsWith(".");
}

export async function walkCatDlgRelPaths(workspaceRoot: string): Promise<string[]> {
  const root = path.resolve(workspaceRoot);
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (shouldSkipDir(ent.name)) continue;
        await walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!ent.name.toLowerCase().endsWith(".catdlg")) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (rel && !rel.startsWith("..")) out.push(rel);
    }
  }

  await walk(root);
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
