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

// ── Builder 模式：IR 树操作 ──

/** 类型短名 → 默认节点 ID 前缀 */
const TYPE_ID_PREFIX: Record<string, string> = {
  CATDlgLabel: "Label",
  CATDlgEditor: "Editor",
  CATDlgPushButton: "PushButton",
  CATDlgCombo: "Combo",
  CATDlgCheckButton: "CheckButton",
  CATDlgRadioButton: "RadioButton",
  CATDlgSpinner: "Spinner",
  CATDlgSelectorList: "SelectorList",
  CATDlgMultiList: "MultiList",
  CATDlgFrame: "Frame",
  CATDlgTabContainer: "TabContainer",
  CATDlgContainer: "Container",
  CATDlgSeparator: "Separator",
};

/** 在容器内生成唯一节点 ID */
export function generateNodeId(container: CaaDialogNode, type: string): string {
  const prefix = TYPE_ID_PREFIX[type] ?? type.replace(/^CATDlg/, "");
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
  const prefix = TYPE_ID_PREFIX[type];
  if (prefix && type !== "CATDlgFrame" && type !== "CATDlgContainer" && type !== "CATDlgSeparator") {
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

/** 插入新行：beforeRow 及之后的行号 +1 */
export function insertGridRow(container: CaaDialogNode, beforeRow: number): void {
  for (const child of container.children) {
    if (child.grid && child.grid.row >= beforeRow) {
      child.grid = { ...child.grid, row: child.grid.row + 1 };
    }
  }
}

/** 插入新列：beforeCol 及之后的列号 +1 */
export function insertGridCol(container: CaaDialogNode, beforeCol: number): void {
  for (const child of container.children) {
    if (child.grid && child.grid.col >= beforeCol) {
      child.grid = { ...child.grid, col: child.grid.col + 1 };
    }
  }
}

/** 判断节点是否为容器（可接受子控件拖入） */
export function isContainerNode(node: CaaDialogNode): boolean {
  return node.type === "CATDlgDialog" ||
    node.type === "CATDlgFrame" ||
    node.type === "CATDlgContainer" ||
    node.type === "CATDlgTabPage";
}
