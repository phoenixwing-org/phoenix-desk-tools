import type { TreeNode } from "../api";

/** 收集树节点下全部文件的 repo_rel_path。 */
export function collectTreeFilePaths(node: TreeNode | null | undefined): string[] {
  if (!node) return [];
  const out: string[] = [];
  walk(node, out);
  return out;
}

function walk(node: TreeNode, out: string[]) {
  if (node.type === "file") {
    const p = node.path?.trim();
    if (p) out.push(p.replace(/\\/g, "/"));
    return;
  }
  for (const child of node.children ?? []) {
    walk(child, out);
  }
}
