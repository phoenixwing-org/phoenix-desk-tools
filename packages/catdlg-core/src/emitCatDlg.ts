/**
 * Model → .CATDlg 文件序列化。
 *
 * 从 CaaDialogNode 树 emit 完整的 .CATDlg 文本。
 * 所有属性（含 FATHER / STYLE / GRID）统一放在 { } 内，保证 round-trip 解析正确。
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

const INDENT = "  ";

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

/** 按 grid 位置排序子节点（row 升序，同 row 按 col 升序） */
function sortChildrenByGrid(children: CaaDialogNode[]): CaaDialogNode[] {
  return [...children].sort((a, b) => {
    const ga = a.grid;
    const gb = b.grid;
    if (!ga || !gb) return a.id.localeCompare(b.id);
    return ga.row - gb.row || ga.col - gb.col;
  });
}

/**
 * 从 model 树收集 NLS 扁平键值对。
 * 遍历顺序：深度优先，子节点按 grid 位置排序（从上到下、从左到右）。
 *
 * Key 格式（与 .CATNls 文件一致）：
 *   Title                           ← Dialog root 自身
 *   FrameParams.Title               ← 一级子容器
 *   FrameParams.Label001.Title      ← 叶子控件
 *
 * Root Dialog ID 不作为路径前缀。
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

/** NLS 有序条目 */
export interface NlsEntry {
  key: string;
  value: string;
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
