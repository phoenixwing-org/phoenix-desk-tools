import type { CaaDialogIr, CaaDialogNode } from "../types/caaDialogIr";
import {
  controlIdPrefix,
  getCaaControlCatalogEntry,
  isCaaContainerType,
  shouldCreateDefaultTitle,
} from "@phoenix/catdlg-core";

export type CaaElTreeNode = { id: string; label: string; icon?: string; children?: CaaElTreeNode[] };

export function toCaaElTreeNode(node: CaaDialogNode): CaaElTreeNode {
  const typeShort = node.type.replace(/^CATDlg/, "");
  const title = node.nls?.title;
  const label = title ? `${node.id} (${typeShort}) — ${title}` : `${node.id} (${typeShort})`;
  const entry = getCaaControlCatalogEntry(node.type);
  return {
    id: node.id,
    label,
    icon: entry?.icon,
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

// ── Builder 模式：IR 树操作 ──

/** 在容器内生成唯一节点 ID */
export function generateNodeId(container: CaaDialogNode, type: string): string {
  const prefix = controlIdPrefix(type);
  const existing = new Set<string>();
  function collect(n: CaaDialogNode) {
    existing.add(n.id);
    for (const c of n.children) collect(c);
  }
  collect(container);
  let i = 1;
  while (existing.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

/** 创建新控件节点 */
export function createControlNode(type: string, id: string, grid: { row: number; col: number }): CaaDialogNode {
  const node: CaaDialogNode = {
    id,
    type,
    grid: { row: grid.row, col: grid.col, rowSpan: 1, colSpan: 1 },
    children: [],
  };
  // 预设默认 NLS title
  const prefix = controlIdPrefix(type);
  if (prefix && shouldCreateDefaultTitle(type)) {
    node.nls = { title: prefix };
  }
  return node;
}

/** 向容器添加子节点 */
export function addChildNode(container: CaaDialogNode, type: string, grid: { row: number; col: number }): CaaDialogNode {
  const id = generateNodeId(container, type);
  const node = createControlNode(type, id, grid);
  node.father = container.id;
  container.children.push(node);
  return node;
}

/** 插入新行：beforeRow 及之后的行号 +1；跨越插入点的 rowSpan +1 */
export function insertGridRow(container: CaaDialogNode, beforeRow: number): void {
  for (const child of container.children) {
    if (!child.grid) continue;
    const g = child.grid;
    if (g.row >= beforeRow) {
      child.grid = { ...g, row: g.row + 1 };
    } else if (g.row + g.rowSpan > beforeRow) {
      // 控件跨越插入点 → rowSpan 增长
      child.grid = { ...g, rowSpan: g.rowSpan + 1 };
    }
  }
}

/** 插入新列：beforeCol 及之后的列号 +1；跨越插入点的 colSpan +1 */
export function insertGridCol(container: CaaDialogNode, beforeCol: number): void {
  for (const child of container.children) {
    if (!child.grid) continue;
    const g = child.grid;
    if (g.col >= beforeCol) {
      child.grid = { ...g, col: g.col + 1 };
    } else if (g.col + g.colSpan > beforeCol) {
      // 控件跨越插入点 → colSpan 增长
      child.grid = { ...g, colSpan: g.colSpan + 1 };
    }
  }
}

/** 判断节点是否为容器（可接受子控件拖入） */
export function isContainerNode(node: CaaDialogNode): boolean {
  return isCaaContainerType(node.type);
}

/** 纯函数：从 children 数组中移除指定 ID 的子节点，不修改原数组 */
export function removeChildNode(
  children: readonly CaaDialogNode[],
  nodeId: string,
): { removed: CaaDialogNode | null; newChildren: CaaDialogNode[] } {
  const idx = children.findIndex((c) => c.id === nodeId);
  if (idx < 0) return { removed: null, newChildren: [...children] };
  const removed = children[idx];
  const newChildren = children.filter((_, i) => i !== idx);
  return { removed, newChildren };
}

/** 递归收集节点的所有后代 ID（深度优先，不含自身） */
export function collectDescendantIds(node: CaaDialogNode): string[] {
  const ids: string[] = [];
  for (const child of node.children) {
    ids.push(child.id);
    ids.push(...collectDescendantIds(child));
  }
  return ids;
}

/** 压缩空白行/列：移除没有任何控件的行和列，重新编号 */
export function renumberGrid(container: CaaDialogNode): void {
  if (!container.children.length) return;

  // 找到最大行列
  let maxRow = 0, maxCol = 0;
  for (const c of container.children) {
    if (!c.grid) continue;
    maxRow = Math.max(maxRow, c.grid.row + c.grid.rowSpan);
    maxCol = Math.max(maxCol, c.grid.col + c.grid.colSpan);
  }

  // 检查哪些行被占用
  const rowUsed = new Set<number>();
  const colUsed = new Set<number>();
  for (const c of container.children) {
    if (!c.grid) continue;
    for (let r = c.grid.row; r < c.grid.row + c.grid.rowSpan; r++) rowUsed.add(r);
    for (let co = c.grid.col; co < c.grid.col + c.grid.colSpan; co++) colUsed.add(co);
  }

  // 建立行映射：旧行号 → 新行号
  const rowMap = new Map<number, number>();
  let newRow = 0;
  for (let r = 0; r < maxRow; r++) {
    if (rowUsed.has(r)) { rowMap.set(r, newRow); newRow++; }
  }

  // 建立列映射
  const colMap = new Map<number, number>();
  let newCol = 0;
  for (let c = 0; c < maxCol; c++) {
    if (colUsed.has(c)) { colMap.set(c, newCol); newCol++; }
  }

  // 应用映射
  for (const child of container.children) {
    if (!child.grid) continue;
    child.grid = {
      ...child.grid,
      row: rowMap.get(child.grid.row) ?? child.grid.row,
      col: colMap.get(child.grid.col) ?? child.grid.col,
    };
  }
}
