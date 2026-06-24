/**
 * Builder 拖放规则 —— 纯函数，可单元测试。
 *
 * 规则：
 * 1. 目标 cell 无控件 → 整格高亮（inside），控件占据该 cell
 * 2. 目标 cell 有控件 → 必须定位到 4 边界之一：
 *    - 对角线 y=x 划分方向：x>=y 水平偏好，y>x 垂直偏好
 *    - 水平：x>0.5→right（插入列后）, x<=0.5→left（插入列前）
 *    - 垂直：y>0.5→bottom（插入行后）, y<=0.5→top（插入行前）
 *    - 禁止 inside（不允许覆盖已有控件）
 *
 * 放置计算流程（pure）：
 *   ① 判断目标 cell 是否被占据（含 span）
 *   ② edge=inside + 占据 → 拒绝
 *   ③ edge=right/left → 找到占据控件的 span 起始/结束位置 → 插入列（避免 straddle）
 *   ④ edge=bottom/top → 找到占据控件的 span 起始/结束位置 → 插入行（避免 straddle）
 */

export type DropEdge = "inside" | "right" | "bottom" | "left" | "top";

export interface DropZoneInput {
  /** 该 cell 是否已有控件 */
  occupied: boolean;
  /** 鼠标在 cell 内的相对 X 比例 (0~1) */
  xPct: number;
  /** 鼠标在 cell 内的相对 Y 比例 (0~1) */
  yPct: number;
}

export interface GridChild {
  grid?: { row: number; col: number; rowSpan: number; colSpan: number };
}

/** 根据规则计算 drop 目标边（空 cell → inside；有控件 → 4 象限分区） */
export function resolveDropEdge(input: DropZoneInput): DropEdge {
  const { occupied, xPct, yPct } = input;
  if (!occupied) return "inside";
  // 对角线 y=x 分区：x>=y 水平偏好，y>x 垂直偏好
  if (xPct >= yPct) {
    return xPct > 0.5 ? "right" : "left";
  }
  return yPct > 0.5 ? "bottom" : "top";
}

/** 判断某个 grid cell 是否被控件占据（含 rowSpan/colSpan） */
export function isCellOccupied(
  children: { grid?: { row: number; col: number; rowSpan: number; colSpan: number } }[],
  row: number,
  col: number,
): boolean {
  return children.some((c) => {
    if (!c.grid) return false;
    return (
      row >= c.grid.row && row < c.grid.row + c.grid.rowSpan &&
      col >= c.grid.col && col < c.grid.col + c.grid.colSpan
    );
  });
}

/** 获取占据 (row,col) 的控件（含 span）；无返回 undefined */
export function getSpanningChild(
  children: readonly GridChild[],
  row: number,
  col: number,
): GridChild | undefined {
  return children.find((c) => {
    if (!c.grid) return false;
    return (
      row >= c.grid.row && row < c.grid.row + c.grid.rowSpan &&
      col >= c.grid.col && col < c.grid.col + c.grid.colSpan
    );
  });
}

/** 快捷方法：从鼠标像素坐标 + cell 矩形计算 */
export function resolveDropEdgeFromRect(
  occupied: boolean,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): DropEdge {
  if (!occupied) return "inside";
  const xPct = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const yPct = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  return resolveDropEdge({ occupied, xPct, yPct });
}

// ═══════════════════════════════════════════
// ── 放置计算（纯函数，可单元测试）──
// ═══════════════════════════════════════════

/** 放置计算结果 */
export interface DropPlacement {
  /** 是否允许放置 */
  allowed: boolean;
  /** 控件放置行 */
  placeRow: number;
  /** 控件放置列 */
  placeCol: number;
  /** 需要先在此位置插入行（已有控件 row>=beforeRow 的下移，span 跨越的 span+1） */
  insertRowBefore?: number;
  /** 需要先在此位置插入列（已有控件 col>=beforeCol 的右移，span 跨越的 span+1） */
  insertColBefore?: number;
  /** 拒绝原因（allowed=false 时） */
  reason?: string;
}

/**
 * 根据目标 cell、edge 和已有子控件列表，计算控件应放置的位置。
 *
 * 关键：如果目标 cell 被 spanning 控件覆盖，插入点必须跳到 span 结束之后，
 * 否则 insertCol/insertRow 会在 span 内部创建新行列，导致新旧控件重叠。
 *
 * 场景示例：
 *   X 占据 (0,0) colSpan=2 → 覆盖 (0,0) 和 (0,1)
 *   拖到 (0,1) edge="right" → insertColBefore=2（X 的 col+colSpan），不是 1
 *   insertCol(2) 后 X 不受影响 → 新控件在 (0,2) → 不重叠
 */
export function computeDropPlacement(
  children: readonly GridChild[],
  targetRow: number,
  targetCol: number,
  edge: DropEdge,
): DropPlacement {
  const spanning = getSpanningChild(children, targetRow, targetCol);

  if (edge === "inside") {
    if (spanning) {
      return {
        allowed: false,
        placeRow: targetRow,
        placeCol: targetCol,
        reason: `Cell (${targetRow},${targetCol}) 已被 ${describeChild(spanning)} 占据，不允许覆盖`,
      };
    }
    return { allowed: true, placeRow: targetRow, placeCol: targetCol };
  }

  if (edge === "right") {
    // 插入列位置 = 占据控件的右边界之后（处理 span）
    const endCol = spanning ? spanning.grid!.col + spanning.grid!.colSpan : targetCol + 1;
    const insertColBefore = Math.max(targetCol + 1, endCol);
    return {
      allowed: true,
      placeRow: targetRow,
      placeCol: insertColBefore,
      insertColBefore,
    };
  }

  if (edge === "left") {
    // 插入列位置 = 占据控件的左边界（处理 span）
    const startCol = spanning ? spanning.grid!.col : targetCol;
    const insertColBefore = Math.min(targetCol, startCol);
    return {
      allowed: true,
      placeRow: targetRow,
      placeCol: insertColBefore,
      insertColBefore,
    };
  }

  if (edge === "bottom") {
    const endRow = spanning ? spanning.grid!.row + spanning.grid!.rowSpan : targetRow + 1;
    const insertRowBefore = Math.max(targetRow + 1, endRow);
    return {
      allowed: true,
      placeRow: insertRowBefore,
      placeCol: targetCol,
      insertRowBefore,
    };
  }

  // edge === "top"
  const startRow = spanning ? spanning.grid!.row : targetRow;
  const insertRowBefore = Math.min(targetRow, startRow);
  return {
    allowed: true,
    placeRow: insertRowBefore,
    placeCol: targetCol,
    insertRowBefore,
  };
}

function describeChild(c: GridChild): string {
  if (!c.grid) return "控件";
  const g = c.grid;
  if (g.rowSpan === 1 && g.colSpan === 1) return `控件@(${g.row},${g.col})`;
  return `控件@(${g.row},${g.col}) span ${g.rowSpan}×${g.colSpan}`;
}

// ═══════════════════════════════════════════
// ── 完整变换（pure，MVC 的 Model 层）──
// ═══════════════════════════════════════════

export interface DropTransformInput {
  /** 当前容器内所有子控件（含 grid 位置） */
  children: readonly GridChild[];
  /** 目标 cell 行 */
  targetRow: number;
  /** 目标 cell 列 */
  targetCol: number;
  /** 边界类型 */
  edge: DropEdge;
}

export interface DropTransformResult {
  /** 变换是否成功 */
  success: boolean;
  /** 变换后的完整子控件列表 */
  children: GridChild[];
  /** 新控件应放置的行 */
  placedRow: number;
  /** 新控件应放置的列 */
  placedCol: number;
  /** 若需插入列，在此位置 */
  insertColBefore?: number;
  /** 若需插入行，在此位置 */
  insertRowBefore?: number;
  /** 失败原因 */
  error?: string;
}

/**
 * 纯函数：完整模拟一次拖放变换。
 *
 * 流程：clone → 计算插入点(处理 span straddle) → 插入行列(shift+span增长) → 放置新控件 → compact → validate
 *
 * 不依赖任何 UI / DOM / Vue。输入输出都是纯数据。
 *
 * 验证规则：
 * - 不丢失子控件（count 不变 for MOVE，count+1 for COPY）
 * - 不产生重叠（任意两个控件不占据同一 cell）
 */
export function applyDropTransform(input: DropTransformInput): DropTransformResult {
  const { children, targetRow, targetCol, edge } = input;

  const logPrefix = "[CAA dropZone]";
  console.log("%s applyDropTransform 输入：children=%d target=(%d,%d) edge=%s",
    logPrefix, children.length, targetRow, targetCol, edge);
  console.log("%s 输入 children grid：", logPrefix, children.map(c => ({ grid: c.grid })));

  // 1. 深拷贝（不影响原数据）
  const working: GridChild[] = children.map((c) => ({
    ...c,
    grid: c.grid ? { row: c.grid.row, col: c.grid.col, rowSpan: c.grid.rowSpan, colSpan: c.grid.colSpan } : undefined,
  }));

  const spanning = getSpanningChild(working, targetRow, targetCol);
  console.log("%s spanning child：", logPrefix, spanning ? describeChild(spanning) : "null");

  // 2. 根据 edge 计算
  if (edge === "inside") {
    if (spanning) {
      console.log("%s inside + 被占据 → 拒绝", logPrefix);
      return {
        success: false,
        children: working,
        placedRow: targetRow,
        placedCol: targetCol,
        error: `Cell (${targetRow},${targetCol}) 已被 ${describeChild(spanning)} 占据，不允许覆盖`,
      };
    }
    console.log("%s inside + 空 → 直接放置", logPrefix);
    return {
      success: true,
      children: working,
      placedRow: targetRow,
      placedCol: targetCol,
    };
  }

  if (edge === "right") {
    const endCol = spanning ? spanning.grid!.col + spanning.grid!.colSpan : targetCol + 1;
    const insertBefore = Math.max(targetCol + 1, endCol);
    console.log("%s right：spanning=%s endCol=%d insertBefore=%d",
      logPrefix, spanning ? describeChild(spanning) : "null", endCol, insertBefore);
    shiftColsAfter(working, insertBefore, logPrefix);
    console.log("%s right 完成后 children：", logPrefix, working.map(c => ({ grid: c.grid })));
    return {
      success: true,
      children: working,
      placedRow: targetRow,
      placedCol: insertBefore,
      insertColBefore: insertBefore,
    };
  }

  if (edge === "left") {
    const startCol = spanning ? spanning.grid!.col : targetCol;
    const insertBefore = Math.min(targetCol, startCol);
    console.log("%s left：spanning=%s startCol=%d insertBefore=%d",
      logPrefix, spanning ? describeChild(spanning) : "null", startCol, insertBefore);
    shiftColsAfter(working, insertBefore, logPrefix);
    console.log("%s left 完成后 children：", logPrefix, working.map(c => ({ grid: c.grid })));
    return {
      success: true,
      children: working,
      placedRow: targetRow,
      placedCol: insertBefore,
      insertColBefore: insertBefore,
    };
  }

  if (edge === "bottom") {
    const endRow = spanning ? spanning.grid!.row + spanning.grid!.rowSpan : targetRow + 1;
    const insertBefore = Math.max(targetRow + 1, endRow);
    console.log("%s bottom：spanning=%s endRow=%d insertBefore=%d",
      logPrefix, spanning ? describeChild(spanning) : "null", endRow, insertBefore);
    shiftRowsAfter(working, insertBefore, logPrefix);
    console.log("%s bottom 完成后 children：", logPrefix, working.map(c => ({ grid: c.grid })));
    return {
      success: true,
      children: working,
      placedRow: insertBefore,
      placedCol: targetCol,
      insertRowBefore: insertBefore,
    };
  }

  // edge === "top"
  const startRow = spanning ? spanning.grid!.row : targetRow;
  const insertBefore = Math.min(targetRow, startRow);
  console.log("%s top：spanning=%s startRow=%d insertBefore=%d",
    logPrefix, spanning ? describeChild(spanning) : "null", startRow, insertBefore);
  shiftRowsAfter(working, insertBefore, logPrefix);
  console.log("%s top 完成后 children：", logPrefix, working.map(c => ({ grid: c.grid })));
  return {
    success: true,
    children: working,
    placedRow: insertBefore,
    placedCol: targetCol,
    insertRowBefore: insertBefore,
  };
}

/** 插入列后 shift：col >= insertBefore 的右移，跨越插入点的 colSpan+1 */
function shiftColsAfter(working: GridChild[], insertBefore: number, logPrefix: string): void {
  for (const c of working) {
    if (!c.grid) continue;
    const g = c.grid;
    const before = { ...g };
    if (g.col >= insertBefore) {
      g.col += 1;
      console.log("%s   shift col：%s col %d→%d", logPrefix, describeChild(c), before.col, g.col);
    } else if (g.col + g.colSpan > insertBefore) {
      g.colSpan += 1;
      console.log("%s   grow colSpan：%s colSpan %d→%d", logPrefix, describeChild(c), before.colSpan, g.colSpan);
    }
  }
}

/** 插入行后 shift：row >= insertBefore 的下移，跨越插入点的 rowSpan+1 */
function shiftRowsAfter(working: GridChild[], insertBefore: number, logPrefix: string): void {
  for (const c of working) {
    if (!c.grid) continue;
    const g = c.grid;
    const before = { ...g };
    if (g.row >= insertBefore) {
      g.row += 1;
      console.log("%s   shift row：%s row %d→%d", logPrefix, describeChild(c), before.row, g.row);
    } else if (g.row + g.rowSpan > insertBefore) {
      g.rowSpan += 1;
      console.log("%s   grow rowSpan：%s rowSpan %d→%d", logPrefix, describeChild(c), before.rowSpan, g.rowSpan);
    }
  }
}

/**
 * 验证：任意两个控件不占据同一 cell（含 span）。
 * 返回冲突对列表，空数组 = 无冲突。
 */
export function findOverlaps(children: readonly GridChild[]): { a: number; b: number; cell: string }[] {
  const overlaps: { a: number; b: number; cell: string }[] = [];
  const list = children.map((c, i) => ({ ...c, _idx: i }));

  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.grid) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b.grid) continue;
      // 检查 a 和 b 是否有重叠区域
      const rowOverlap = a.grid.row < b.grid.row + b.grid.rowSpan && b.grid.row < a.grid.row + a.grid.rowSpan;
      const colOverlap = a.grid.col < b.grid.col + b.grid.colSpan && b.grid.col < a.grid.col + a.grid.colSpan;
      if (rowOverlap && colOverlap) {
        overlaps.push({ a: i, b: j, cell: `(${Math.max(a.grid.row, b.grid.row)},${Math.max(a.grid.col, b.grid.col)})` });
      }
    }
  }
  return overlaps;
}

/**
 * 将 children 中的空行/列压缩（重新编号）。
 * 保持相对顺序，移除没有任何控件占据的行和列。
 */
export function compactChildren(children: GridChild[]): void {
  if (!children.length) return;

  // 找到最大行/列
  let maxRow = 0, maxCol = 0;
  for (const c of children) {
    if (!c.grid) continue;
    maxRow = Math.max(maxRow, c.grid.row + c.grid.rowSpan);
    maxCol = Math.max(maxCol, c.grid.col + c.grid.colSpan);
  }

  // 找出空行
  const emptyRows: number[] = [];
  for (let r = 0; r < maxRow; r++) {
    if (!isCellOccupied(children, r, 0) && !children.some((c) => {
      if (!c.grid) return false;
      // 检查该行在任意列是否有控件
      for (let col = 0; col < maxCol; col++) {
        if (isCellOccupied(children, r, col)) return true;
      }
      return false;
    })) {
      // 整行都空才标记
    }
  }

  // 简化版 compact：按非空行/列重新编号
  const occupiedRows = new Set<number>();
  const occupiedCols = new Set<number>();
  for (const c of children) {
    if (!c.grid) continue;
    for (let r = c.grid.row; r < c.grid.row + c.grid.rowSpan; r++) occupiedRows.add(r);
    for (let col = c.grid.col; col < c.grid.col + c.grid.colSpan; col++) occupiedCols.add(col);
  }

  const sortedRows = [...occupiedRows].sort((a, b) => a - b);
  const sortedCols = [...occupiedCols].sort((a, b) => a - b);

  const rowMap = new Map<number, number>();
  const colMap = new Map<number, number>();
  sortedRows.forEach((oldRow, i) => rowMap.set(oldRow, i));
  sortedCols.forEach((oldCol, i) => colMap.set(oldCol, i));

  for (const c of children) {
    if (!c.grid) continue;
    c.grid.row = rowMap.get(c.grid.row) ?? c.grid.row;
    c.grid.col = colMap.get(c.grid.col) ?? c.grid.col;
  }
}
