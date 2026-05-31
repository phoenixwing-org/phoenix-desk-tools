import type { TreeNode } from "../api";

export function fileMatchesTreeFilter(node: TreeNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${node.name} ${node.path}`.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((token) => hay.includes(token));
}

/** 按文件名 / 路径模糊筛选，保留仍有匹配文件的目录枝。 */
export function filterTreeNode(node: TreeNode, query: string): TreeNode | null {
  const q = query.trim();
  if (!q) return node;

  if (node.type === "file") {
    return fileMatchesTreeFilter(node, q) ? node : null;
  }

  const children = (node.children ?? [])
    .map((child) => filterTreeNode(child, q))
    .filter((child): child is TreeNode => child != null);

  if (!children.length) return null;
  return { ...node, children };
}

export function countTreeFiles(node: TreeNode): number {
  if (node.type === "file") return 1;
  return (node.children ?? []).reduce((sum, child) => sum + countTreeFiles(child), 0);
}
