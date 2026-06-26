/**
 * Model → .CATDlg 文件序列化 + NLS 收集 + IR 校验。
 *
 * 两套 emit 接口：
 *   - emitCatDlg(root)          — 按原始属性顺序 emit（Sam）
 *   - emitCatDlgText(root, opts) — 新 emit，支持 dialogName 覆盖（Sariko）
 *
 * NLS 收集：
 *   - collectNlsFlat / collectNlsOrdered  — DFS grid 排序（Sam）
 *   - collectCatNlsKeysFromNode           — nlsKeyForProp 统一 key 生成（Sariko）
 *
 * IR 校验：
 *   - validateCaaDialogIrRoot(root) → { errors, warnings }（Sariko）
 *
 * .CATDlg 格式：
 *   CATDlg<Type> <Id>
 *   {
 *     ROWRES = { 1 };              ← 容器
 *     COLRES = { 0, 1 };           ← 容器
 *     TH = 1;                      ← size.textHeight
 *     TW = 20;                     ← size.textWidth
 *     CC = 3;                      ← size.columnCount
 *     VCC = 5;                     ← size.visibleColumnCount
 *     MIN = 0;                     ← spinner.min
 *     MAX = 100;                   ← spinner.max
 *     STEP = 1;                    ← spinner.step
 *     PREC = 0;                    ← spinner.prec
 *     FATHER = <parentId>;
 *     STYLE = Flag1|Flag2;
 *     GRID = { row, col, rowSpan, colSpan, CATGRID_4SIDES };
 *   }
 */

import type { CaaDialogNode } from "./schema.js";
import { nlsKeyForProp, type NlsStringProp } from "./nlsKeys.js";
import { isKnownCaaControlType } from "./controlCatalog.js";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type CaaDialogIrValidation = {
  errors: string[];
  warnings: string[];
};

/** NLS 有序条目 */
export interface NlsEntry {
  key: string;
  value: string;
}

// ═══════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════

const INDENT = "  ";

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function formatNumberList(values: number[] | undefined): string | null {
  if (!values?.length) return null;
  return `{ ${values.join(", ")} }`;
}

/** 按 grid 位置排序子节点（row 升序，同 row 按 col 升序） */
function sortChildrenByGrid(children: CaaDialogNode[]): CaaDialogNode[] {
  return [...children].sort((a, b) => {
    const ga = a.grid;
    const gb = b.grid;
    if (!ga || !gb) return a.id.localeCompare(b.id);
    return ga.row - gb.row || ga.col - gb.col;
  });
}

// ═══════════════════════════════════════════════════════════════════
// emitCatDlg (Sam) — 按原始属性顺序 emit
//   顺序：FATHER → STYLE → size → spinner → GRID → ROWRES/COLRES
// ═══════════════════════════════════════════════════════════════════

function formatGrid(g: NonNullable<CaaDialogNode["grid"]>): string {
  const anchor = g.anchor ?? "CATGRID_4SIDES";
  return `{ ${g.row}, ${g.col}, ${g.rowSpan}, ${g.colSpan}, ${anchor} }`;
}

function formatResizable(values: number[]): string {
  return `{ ${values.join(", ")} }`;
}

function formatStyle(style: string[]): string {
  return style.join("|");
}

/**
 * 从 model 树 emit 完整 .CATDlg 文本（depth-first）。
 *
 * 属性顺序（与原文件一致）：
 *   FATHER → STYLE → size/spinner → GRID → ROWRES/COLRES
 * 根 Dialog 无 FATHER/GRID。
 */
export function emitCatDlg(root: CaaDialogNode): string {
  const lines: string[] = [];
  lines.push("// DO NOT EDIT :: THE CAA2 WIZARD WILL REPLACE ALL THE CODE HERE");

  walk(root, null);

  function walk(node: CaaDialogNode, parentId: string | null) {
    // 声明
    lines.push(`${node.type} ${node.id}`);
    lines.push("{");

    // ── body 属性：FATHER → STYLE → size → spinner → GRID → ROWRES/COLRES ──

    // FATHER（根 Dialog 无）
    if (parentId) {
      lines.push(`${INDENT}FATHER = ${parentId};`);
    }

    // STYLE
    if (node.style?.length) {
      lines.push(`${INDENT}STYLE = ${formatStyle(node.style)};`);
    }

    // size
    const sz = node.size;
    if (sz) {
      if (sz.textHeight != null) lines.push(`${INDENT}TH = ${sz.textHeight};`);
      if (sz.textWidth != null) lines.push(`${INDENT}TW = ${sz.textWidth};`);
      if (sz.columnCount != null) lines.push(`${INDENT}CC = ${sz.columnCount};`);
      if (sz.visibleColumnCount != null) lines.push(`${INDENT}VCC = ${sz.visibleColumnCount};`);
    }

    // spinner
    const sp = node.spinner;
    if (sp) {
      if (sp.min != null) lines.push(`${INDENT}MIN = ${sp.min};`);
      if (sp.max != null) lines.push(`${INDENT}MAX = ${sp.max};`);
      if (sp.step != null) lines.push(`${INDENT}STEP = ${sp.step};`);
      if (sp.prec != null) lines.push(`${INDENT}PREC = ${sp.prec};`);
    }

    // GRID（根 Dialog 无）
    if (node.grid) {
      lines.push(`${INDENT}GRID = ${formatGrid(node.grid)};`);
    }

    // ROWRES / COLRES（容器，放在最后）
    const gl = node.gridLayout;
    if (gl?.rowResizable?.length) {
      lines.push(`${INDENT}ROWRES = ${formatResizable(gl.rowResizable)};`);
    }
    if (gl?.colResizable?.length) {
      lines.push(`${INDENT}COLRES = ${formatResizable(gl.colResizable)};`);
    }

    lines.push("}");
    lines.push("");

    // 递归子节点
    for (const child of node.children) {
      walk(child, node.id);
    }
  }

  // 去掉末尾多余空行
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}

// ═══════════════════════════════════════════════════════════════════
// collectNlsFlat / collectNlsOrdered (Sam) — DFS grid 排序
//   Key 格式：Title / FrameParams.Title / FrameParams.Label001.Title
//   Root Dialog ID 不作为路径前缀。
// ═══════════════════════════════════════════════════════════════════

/**
 * 从 model 树收集 NLS 扁平键值对。
 * 遍历顺序：深度优先，子节点按 grid 位置排序（从上到下、从左到右）。
 */
export function collectNlsFlat(root: CaaDialogNode): Record<string, string> {
  const flat: Record<string, string> = {};

  if (root.nls?.title != null) flat["Title"] = root.nls.title;

  function walk(node: CaaDialogNode, prefix: string) {
    const nls = node.nls;
    if (nls) {
      if (nls.title != null) flat[`${prefix}.Title`] = nls.title;
      if (nls.help != null) flat[`${prefix}.Help`] = nls.help;
      if (nls.shortHelp != null) flat[`${prefix}.ShortHelp`] = nls.shortHelp;
      if (nls.longHelp != null) flat[`${prefix}.LongHelp`] = nls.longHelp;
      if (nls.columnTitles) {
        nls.columnTitles.forEach((v, i) => {
          if (v != null) flat[`${prefix}.ColumnTitle${i + 1}`] = v;
        });
      }
    }
    for (const child of sortChildrenByGrid(node.children)) {
      walk(child, `${prefix}.${child.id}`);
    }
  }

  for (const child of sortChildrenByGrid(root.children)) {
    walk(child, child.id);
  }
  return flat;
}

/**
 * 同 collectNlsFlat，但返回有序数组（深度优先 grid 排序 + 按 Title/Help/ShortHelp/LongHelp/ColumnTitle 固定顺序）。
 */
export function collectNlsOrdered(root: CaaDialogNode): NlsEntry[] {
  const entries: NlsEntry[] = [];

  // Root Title 最先
  if (root.nls?.title != null) entries.push({ key: "Title", value: root.nls.title });

  function walk(node: CaaDialogNode, prefix: string) {
    const nls = node.nls;
    if (nls) {
      // 固定属性顺序：Title → Help → ShortHelp → LongHelp → ColumnTitle*
      if (nls.title != null) entries.push({ key: `${prefix}.Title`, value: nls.title });
      if (nls.help != null) entries.push({ key: `${prefix}.Help`, value: nls.help });
      if (nls.shortHelp != null) entries.push({ key: `${prefix}.ShortHelp`, value: nls.shortHelp });
      if (nls.longHelp != null) entries.push({ key: `${prefix}.LongHelp`, value: nls.longHelp });
      if (nls.columnTitles) {
        nls.columnTitles.forEach((v, i) => {
          if (v != null) entries.push({ key: `${prefix}.ColumnTitle${i + 1}`, value: v });
        });
      }
    }
    for (const child of sortChildrenByGrid(node.children)) {
      walk(child, `${prefix}.${child.id}`);
    }
  }

  for (const child of sortChildrenByGrid(root.children)) {
    walk(child, child.id);
  }
  return entries;
}

// ═══════════════════════════════════════════════════════════════════
// emitCatDlgText (Sariko) — 新 emit，支持 dialogName 覆盖
//   属性顺序：FATHER → STYLE → GRID → ROWRES/COLRES → size → spinner
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// collectCatNlsKeysFromNode (Sariko) — nlsKeyForProp 统一 key 生成
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// validateCaaDialogIrRoot (Sariko) — IR 校验
// ═══════════════════════════════════════════════════════════════════

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
