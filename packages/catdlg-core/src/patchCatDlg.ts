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
