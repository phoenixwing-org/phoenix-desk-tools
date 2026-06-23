import type { CatDlgFlatNode } from "./schema.js";

const BLOCK_START_INLINE = /^(CATDlg\w+)\s+(\w+)\s*\{\s*$/;
const BLOCK_START_NAME = /^(CATDlg\w+)\s+(\w+)\s*$/;
const PROP_LINE = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*;\s*$/;

function parseValue(raw: string): string | number | string[] | number[] {
  const t = raw.trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    const parts = inner.split(",").map((p) => p.trim());
    if (parts.every((p) => /^-?\d+(\.\d+)?$/.test(p))) {
      return parts.map((p) => (p.includes(".") ? Number.parseFloat(p) : Number.parseInt(p, 10)));
    }
    return parts;
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    return t.includes(".") ? Number.parseFloat(t) : Number.parseInt(t, 10);
  }
  if (t.includes("|")) {
    return t;
  }
  return t;
}

function splitFlags(value: string | number | string[] | number[]): string[] {
  if (typeof value !== "string") return [];
  return value.split("|").map((s) => s.trim()).filter(Boolean);
}

export function parseCatDlg(text: string): CatDlgFlatNode[] {
  const nodes: CatDlgFlatNode[] = [];
  let current: CatDlgFlatNode | null = null;
  let pendingStart: { type: string; id: string } | null = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    if (pendingStart && trimmed === "{") {
      current = { type: pendingStart.type, id: pendingStart.id, properties: {} };
      nodes.push(current);
      pendingStart = null;
      continue;
    }

    const startInline = trimmed.match(BLOCK_START_INLINE);
    if (startInline) {
      current = { type: startInline[1], id: startInline[2], properties: {} };
      nodes.push(current);
      pendingStart = null;
      continue;
    }

    const startName = trimmed.match(BLOCK_START_NAME);
    if (startName) {
      pendingStart = { type: startName[1], id: startName[2] };
      continue;
    }

    if (trimmed === "}" || trimmed === "};") {
      current = null;
      pendingStart = null;
      continue;
    }

    if (!current) continue;

    const prop = trimmed.match(PROP_LINE);
    if (prop) {
      current.properties[prop[1]] = parseValue(prop[2]);
    }
  }

  return nodes;
}

export function styleFlags(props: CatDlgFlatNode["properties"]): string[] | undefined {
  const style = props.STYLE;
  if (style == null) return undefined;
  if (Array.isArray(style)) return style.map(String);
  return splitFlags(style);
}

export function gridFromProps(props: CatDlgFlatNode["properties"]) {
  const grid = props.GRID;
  if (!Array.isArray(grid) || grid.length < 4) return undefined;
  const [row, col, rowSpan, colSpan, anchor] = grid;
  return {
    row: Number(row),
    col: Number(col),
    rowSpan: Number(rowSpan),
    colSpan: Number(colSpan),
    anchor: anchor != null ? String(anchor) : undefined,
  };
}

export function resizableFromProps(props: CatDlgFlatNode["properties"], key: "ROWRES" | "COLRES") {
  const v = props[key];
  if (!Array.isArray(v)) return undefined;
  return v.map((n) => Number(n));
}
