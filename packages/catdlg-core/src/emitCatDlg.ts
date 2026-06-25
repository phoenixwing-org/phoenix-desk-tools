import type { CaaDialogNode } from "./schema.js";
import { nlsKeyForProp, type NlsStringProp } from "./nlsKeys.js";
import { isKnownCaaControlType } from "./controlCatalog.js";

export type CaaDialogIrValidation = {
  errors: string[];
  warnings: string[];
};

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function formatNumberList(values: number[] | undefined): string | null {
  if (!values?.length) return null;
  return `{ ${values.join(", ")} }`;
}

function emitOptionalNumber(lines: string[], key: string, value: unknown): void {
  if (value == null) return;
  const n = Number(value);
  if (Number.isFinite(n)) lines.push(`  ${key} = ${n};`);
}

function emitCatDlgNode(
  lines: string[],
  node: CaaDialogNode,
  opts: { nodeId: string; nodeType: string; parentId?: string },
): void {
  const { nodeId, nodeType, parentId } = opts;
  lines.push(`${nodeType} ${nodeId}`);
  lines.push("{");

  if (parentId) lines.push(`  FATHER = ${parentId};`);

  const styles = strArray(node.style);
  if (styles.length) lines.push(`  STYLE = ${styles.join("|")};`);

  const grid = node.grid;
  if (grid) {
    const values = [grid.row, grid.col, grid.rowSpan, grid.colSpan].map(Number);
    if (values.every(Number.isFinite)) {
      const parts = values.map(String);
      if (grid.anchor) parts.push(grid.anchor);
      lines.push(`  GRID = { ${parts.join(", ")} };`);
    }
  }

  const rowRes = formatNumberList(node.gridLayout?.rowResizable);
  if (rowRes) lines.push(`  ROWRES = ${rowRes};`);
  const colRes = formatNumberList(node.gridLayout?.colResizable);
  if (colRes) lines.push(`  COLRES = ${colRes};`);

  emitOptionalNumber(lines, "TH", node.size?.textHeight);
  emitOptionalNumber(lines, "TW", node.size?.textWidth);
  emitOptionalNumber(lines, "CC", node.size?.columnCount);
  emitOptionalNumber(lines, "VCC", node.size?.visibleColumnCount);
  emitOptionalNumber(lines, "MIN", node.spinner?.min);
  emitOptionalNumber(lines, "MAX", node.spinner?.max);
  emitOptionalNumber(lines, "STEP", node.spinner?.step);
  emitOptionalNumber(lines, "PREC", node.spinner?.prec);

  lines.push("}");
  lines.push("");

  for (const child of node.children ?? []) {
    if (!child?.id || !child?.type) continue;
    emitCatDlgNode(lines, child, { nodeId: child.id, nodeType: child.type, parentId: nodeId });
  }
}

export function emitCatDlgText(root: CaaDialogNode, opts?: { dialogName?: string }): string {
  const dialogName = opts?.dialogName?.trim() || root.id;
  const lines: string[] = [];
  emitCatDlgNode(
    lines,
    {
      ...root,
      id: dialogName,
      type: "CATDlgDialog",
      style: root.style?.length ? root.style : ["CATDlgWndBtn"],
    },
    { nodeId: dialogName, nodeType: "CATDlgDialog" },
  );
  return lines.join("\n");
}

export function collectCatNlsKeysFromNode(
  node: CaaDialogNode,
  segments: string[] = [],
  out: Record<string, string> = {},
): Record<string, string> {
  const nls = node.nls;
  const put = (prop: NlsStringProp, value: string | undefined) => {
    const text = value?.trim();
    if (!text) return;
    out[nlsKeyForProp(segments, prop)] = text;
  };

  put("title", nls?.title);
  put("help", nls?.help);
  put("shortHelp", nls?.shortHelp);
  put("longHelp", nls?.longHelp);
  for (const [idx, value] of (nls?.columnTitles ?? []).entries()) {
    const text = value?.trim();
    if (text) out[nlsKeyForProp(segments, "title", idx)] = text;
  }

  for (const child of node.children ?? []) {
    if (!child?.id) continue;
    collectCatNlsKeysFromNode(child, [...segments, child.id], out);
  }
  return out;
}

export function validateCaaDialogIrRoot(root: CaaDialogNode | undefined): CaaDialogIrValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!root || typeof root !== "object") {
    return { errors: ["ir.root 必须是 CAA 对话框 IR 节点"], warnings };
  }

  const ids = new Set<string>();

  function validateNode(node: CaaDialogNode, parent?: CaaDialogNode): void {
    if (!node.id?.trim()) errors.push("存在缺少 id 的控件节点");
    if (!node.type?.trim()) errors.push(`${node.id || "(unknown)"} 缺少 type`);
    if (node.id) {
      if (ids.has(node.id)) errors.push(`重复控件 id：${node.id}`);
      ids.add(node.id);
    }
    if (node.type && !isKnownCaaControlType(node.type)) {
      warnings.push(`未登记控件类型：${node.type} (${node.id})`);
    }
    if (!parent && node.type !== "CATDlgDialog") {
      errors.push(`根节点必须是 CATDlgDialog，当前为 ${node.type}`);
    }
    if (parent && node.father && node.father !== parent.id) {
      errors.push(`${node.id}.FATHER=${node.father} 与父节点 ${parent.id} 不一致`);
    }
    if (node.grid) {
      const { row, col, rowSpan, colSpan } = node.grid;
      if (![row, col, rowSpan, colSpan].every(Number.isFinite)) {
        errors.push(`${node.id}.GRID 包含非数字值`);
      }
      if (row < 0 || col < 0 || rowSpan <= 0 || colSpan <= 0) {
        errors.push(`${node.id}.GRID 行列必须非负，span 必须大于 0`);
      }
    }
    validateSiblingOverlaps(node);
    for (const child of node.children ?? []) validateNode(child, node);
  }

  function validateSiblingOverlaps(container: CaaDialogNode): void {
    const children = container.children ?? [];
    for (let i = 0; i < children.length; i++) {
      const a = children[i];
      if (!a.grid) continue;
      for (let j = i + 1; j < children.length; j++) {
        const b = children[j];
        if (!b.grid) continue;
        const rowOverlap = a.grid.row < b.grid.row + b.grid.rowSpan && b.grid.row < a.grid.row + a.grid.rowSpan;
        const colOverlap = a.grid.col < b.grid.col + b.grid.colSpan && b.grid.col < a.grid.col + a.grid.colSpan;
        if (rowOverlap && colOverlap) {
          errors.push(`${container.id} 内控件重叠：${a.id} 与 ${b.id}`);
        }
      }
    }
  }

  validateNode(root);
  return { errors, warnings };
}
