import type { CaaDialogIr, CaaDialogNode } from "../types/caaDialogIr";

export type CaaElTreeNode = { id: string; label: string; children?: CaaElTreeNode[] };

export function toCaaElTreeNode(node: CaaDialogNode): CaaElTreeNode {
  const typeShort = node.type.replace(/^CATDlg/, "");
  const title = node.nls?.title;
  const label = title ? `${node.id} (${typeShort}) — ${title}` : `${node.id} (${typeShort})`;
  return {
    id: node.id,
    label,
    children: node.children.length ? node.children.map(toCaaElTreeNode) : undefined,
  };
}

export function toCaaElTreeRoots(ir: CaaDialogIr | null): CaaElTreeNode[] {
  if (!ir) return [];
  return [toCaaElTreeNode(ir.root)];
}

export function findCaaNode(root: CaaDialogNode, id: string): CaaDialogNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findCaaNode(child, id);
    if (found) return found;
  }
  return null;
}

export function resolveSelectedNode(ir: CaaDialogIr | null, selectedId: string | null): CaaDialogNode | null {
  if (!ir || !selectedId) return null;
  return findCaaNode(ir.root, selectedId);
}

export function formatGrid(node: CaaDialogNode): string {
  const g = node.grid;
  if (!g) return "—";
  const anchor = g.anchor ? ` · ${g.anchor}` : "";
  return `行 ${g.row} · 列 ${g.col} · 跨 ${g.rowSpan}×${g.colSpan}${anchor}`;
}

export function formatIntList(values: number[] | undefined): string {
  if (!values?.length) return "—";
  return values.join(", ");
}

export function nlsFlatMapsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (a[keysA[i]] !== b[keysB[i]]) return false;
  }
  return true;
}
