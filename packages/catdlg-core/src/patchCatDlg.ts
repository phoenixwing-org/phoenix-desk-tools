/**
 * 在 .CATDlg 源文本中修改指定容器的 ROWRES / COLRES 行。
 *
 * .CATDlg 格式示例：
 *   CATDlgFrame FrameParams
 *   {
 *     ROWRES = { 1 };
 *     COLRES = { 0, 1 };
 *   }
 *     FATHER = PNXBomAnalysisDlg;
 *     STYLE = CATDlgFraNoFrame|CATDlgGridLayout;
 *     GRID = { 0, 0, 1, 1, CATGRID_4SIDES };
 */

const CONTAINER_RE = /^(\s*)(CATDlg\w+)\s+(\w+)\s*$/;
const ROWRES_RE = /^(\s*)(ROWRES)\s*=\s*\{([^}]*)\}\s*;?\s*$/;
const COLRES_RE = /^(\s*)(COLRES)\s*=\s*\{([^}]*)\}\s*;?\s*$/;

export interface GridLayoutPatch {
  nodeId: string;
  rowResizable?: number[];
  colResizable?: number[];
}

function formatResizable(values: number[]): string {
  return `{ ${values.join(", ")} }`;
}

/** 跳过 Wizard 标头和重复声明行 */
function isSkippable(line: string, lastId: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("//")) return true;
  // 连续重复的容器声明（CAA2 Wizard bug）
  const m = line.match(CONTAINER_RE);
  if (m && m[3] === lastId) return true;
  return false;
}

export function patchCatDlgGridLayout(
  sourceText: string,
  patches: GridLayoutPatch[],
): string {
  const patchMap = new Map<string, GridLayoutPatch>();
  for (const p of patches) patchMap.set(p.nodeId, p);

  const lines = sourceText.split(/\r?\n/);
  const out: string[] = [];
  const done = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(CONTAINER_RE);

    if (!m) {
      out.push(line);
      continue;
    }

    const indent = m[1];
    const id = m[3];
    const patch = patchMap.get(id);

    // 跳过重复声明（CAA2 Wizard bug）
    if (isSkippable(line, id) && i > 0 && lines[i - 1].trim().startsWith("CATDlg")) {
      continue;
    }

    out.push(line); // 容器声明行

    // 收集 body 行（从 { 到 }）
    const bodyLines: string[] = [];
    let j = i + 1;

    // 跳过可选的 {
    if (j < lines.length && lines[j].trim() === "{") {
      bodyLines.push(lines[j]);
      j++;
    }

    // 收集到闭合 } 为止
    let braceDepth = 1;
    for (; j < lines.length; j++) {
      const bline = lines[j];
      const trimmed = bline.trim();
      if (trimmed === "{") braceDepth++;
      else if (trimmed === "}") {
        braceDepth--;
        if (braceDepth === 0) {
          bodyLines.push(bline);
          j++;
          break;
        }
      }
      // 跳过重复声明行
      if (isSkippable(bline, id)) continue;
      bodyLines.push(bline);
    }

    if (patch && !done.has(id)) {
      done.add(id);

      // 在 body 中查找并替换 ROWRES/COLRES
      let foundRow = false;
      let foundCol = false;
      const patchedBody: string[] = [];

      for (const bline of bodyLines) {
        const rowMatch = bline.match(ROWRES_RE);
        const colMatch = bline.match(COLRES_RE);

        if (rowMatch && patch.rowResizable !== undefined) {
          if (patch.rowResizable.length > 0) {
            patchedBody.push(`${rowMatch[1]}ROWRES = ${formatResizable(patch.rowResizable)};`);
          }
          foundRow = true;
          continue;
        }
        if (colMatch && patch.colResizable !== undefined) {
          if (patch.colResizable.length > 0) {
            patchedBody.push(`${colMatch[1]}COLRES = ${formatResizable(patch.colResizable)};`);
          }
          foundCol = true;
          continue;
        }
        patchedBody.push(bline);
      }

      // 未找到 → 在闭合 } 前插入
      const closeIdx = patchedBody.findIndex(l => l.trim() === "}");
      const insertAt = closeIdx >= 0 ? closeIdx : patchedBody.length;
      const newLines: string[] = [];
      if (!foundRow && patch.rowResizable !== undefined && patch.rowResizable.length > 0) {
        newLines.push(`${indent}  ROWRES = ${formatResizable(patch.rowResizable)};`);
      }
      if (!foundCol && patch.colResizable !== undefined && patch.colResizable.length > 0) {
        newLines.push(`${indent}  COLRES = ${formatResizable(patch.colResizable)};`);
      }
      if (newLines.length > 0) {
        patchedBody.splice(insertAt, 0, ...newLines);
      }

      out.push(...patchedBody);
    } else {
      out.push(...bodyLines);
    }

    i = j - 1;
  }

  return out.join("\n");
}

// ── GRID / FATHER 位置补丁 ──

export interface NodePositionPatch {
  nodeId: string;
  grid?: { row: number; col: number; rowSpan: number; colSpan: number; anchor?: string };
  father?: string;
}

function formatGrid(grid: NonNullable<NodePositionPatch["grid"]>): string {
  const anchor = grid.anchor ?? "CATGRID_4SIDES";
  return `{ ${grid.row}, ${grid.col}, ${grid.rowSpan}, ${grid.colSpan}, ${anchor} }`;
}

/** GRID 行正则：GRID = { ... };  */
const GRID_RE = /^(\s*)GRID\s*=\s*\{[^}]*\}\s*;?\s*$/;
/** FATHER 行正则：FATHER = ...; */
const FATHER_RE = /^(\s*)FATHER\s*=\s*(.+?)\s*;?\s*$/;

/**
 * 在 .CATDlg 源文本中修改所有节点的 GRID 位置和 FATHER 归属。
 * 仅 patch 补丁中列出的节点，其他节点保持不变。
 */
export function patchCatDlgNodePositions(
  sourceText: string,
  patches: NodePositionPatch[],
): string {
  const patchMap = new Map<string, NodePositionPatch>();
  for (const p of patches) patchMap.set(p.nodeId, p);

  const lines = sourceText.split(/\r?\n/);
  const out: string[] = [];
  const done = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(CONTAINER_RE);

    if (!m) {
      out.push(line);
      continue;
    }

    const indent = m[1];
    const id = m[3];
    const patch = patchMap.get(id);

    // 跳过重复声明
    if (isSkippable(line, id) && i > 0 && lines[i - 1].trim().startsWith("CATDlg")) {
      continue;
    }

    out.push(line); // 声明行

    // 收集到闭合 } 为止的所有行（body + 外部属性）
    const bodyLines: string[] = [];
    let j = i + 1;

    if (j < lines.length && lines[j].trim() === "{") {
      bodyLines.push(lines[j]);
      j++;
    }

    let braceDepth = 1;
    for (; j < lines.length; j++) {
      const bline = lines[j];
      const trimmed = bline.trim();
      if (trimmed === "{") braceDepth++;
      else if (trimmed === "}") {
        braceDepth--;
        if (braceDepth === 0) {
          bodyLines.push(bline);
          j++;
          break;
        }
      }
      if (isSkippable(bline, id)) continue;
      bodyLines.push(bline);
    }

    // 收集 } 之后的属性行（FATHER, STYLE, GRID 可能在外）
    const tailLines: string[] = [];
    for (; j < lines.length; j++) {
      const tline = lines[j];
      const ttrimmed = tline.trim();
      // 遇到下一个声明或空行后不再继续
      if (CONTAINER_RE.test(ttrimmed)) break;
      if (ttrimmed === "") { tailLines.push(tline); continue; }
      if (PROP_LINE.test(ttrimmed) || GRID_RE.test(ttrimmed) || FATHER_RE.test(ttrimmed)) {
        tailLines.push(tline);
      } else if (ttrimmed.startsWith("//")) {
        tailLines.push(tline);
      } else {
        break; // 不认识的格式，停止
      }
    }
    i = j - 1;

    if (patch && !done.has(id)) {
      done.add(id);

      // 在 bodyLines + tailLines 中查找并替换 GRID 和 FATHER
      const allPropLines = [...bodyLines, ...tailLines];
      let foundGrid = false;
      let foundFather = false;
      const patched: string[] = [];

      for (const pline of allPropLines) {
        const gridMatch = pline.match(GRID_RE);
        const fatherMatch = pline.match(FATHER_RE);

        if (gridMatch && patch.grid) {
          patched.push(`${gridMatch[1]}GRID = ${formatGrid(patch.grid)};`);
          foundGrid = true;
          continue;
        }
        if (fatherMatch && patch.father) {
          patched.push(`${fatherMatch[1]}FATHER = ${patch.father};`);
          foundFather = true;
          continue;
        }
        patched.push(pline);
      }

      // 未找到 → 在 } 之后插入
      const closeIdx = patched.findIndex((l) => l.trim() === "}");
      const insertAt = closeIdx >= 0 ? closeIdx + 1 : patched.length;
      const newLines: string[] = [];
      if (!foundGrid && patch.grid) {
        newLines.push(`${indent}  GRID = ${formatGrid(patch.grid)};`);
      }
      if (!foundFather && patch.father) {
        newLines.push(`${indent}  FATHER = ${patch.father};`);
      }
      if (newLines.length > 0) {
        patched.splice(insertAt, 0, ...newLines);
      }

      out.push(...patched);
    } else {
      out.push(...bodyLines, ...tailLines);
    }
  }

  return out.join("\n");
}
