import {
  gridFromProps,
  parseCatDlg,
  resizableFromProps,
  styleFlags,
} from "./parseCatDlg.js";
import { parseCatNls } from "./parseCatNls.js";
import type { CaaDialogIr, CaaDialogNode, CatDlgFlatNode, ControlNls } from "./schema.js";

function flatToNode(flat: CatDlgFlatNode): CaaDialogNode {
  const props = flat.properties;
  const node: CaaDialogNode = {
    id: flat.id,
    type: flat.type,
    children: [],
  };

  if (props.FATHER != null) node.father = String(props.FATHER);
  const style = styleFlags(props);
  if (style?.length) node.style = style;

  const grid = gridFromProps(props);
  if (grid) node.grid = grid;

  const rowRes = resizableFromProps(props, "ROWRES");
  const colRes = resizableFromProps(props, "COLRES");
  if (rowRes?.length || colRes?.length) {
    node.gridLayout = {};
    if (rowRes?.length) node.gridLayout.rowResizable = rowRes;
    if (colRes?.length) node.gridLayout.colResizable = colRes;
  }

  if (props.TH != null || props.TW != null || props.CC != null || props.VCC != null) {
    node.size = {};
    if (props.TH != null) node.size.textHeight = Number(props.TH);
    if (props.TW != null) node.size.textWidth = Number(props.TW);
    if (props.CC != null) node.size.columnCount = Number(props.CC);
    if (props.VCC != null) node.size.visibleColumnCount = Number(props.VCC);
  }

  if (props.MIN != null || props.MAX != null || props.STEP != null || props.PREC != null) {
    node.spinner = {};
    if (props.MIN != null) node.spinner.min = Number(props.MIN);
    if (props.MAX != null) node.spinner.max = Number(props.MAX);
    if (props.STEP != null) node.spinner.step = Number(props.STEP);
    if (props.PREC != null) node.spinner.prec = Number(props.PREC);
  }

  return node;
}

function buildTree(nodes: CaaDialogNode[]): CaaDialogNode {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let root: CaaDialogNode | undefined;

  for (const node of nodes) {
    if (node.type === "CATDlgDialog") {
      root = node;
      continue;
    }
    if (!node.father) continue;
    const parent = byId.get(node.father);
    if (parent) parent.children.push(node);
  }

  if (!root) {
    root = nodes.find((n) => n.type === "CATDlgDialog");
  }

  if (!root) {
    throw new Error("CATDlg: no CATDlgDialog root found");
  }

  const sortByGrid = (a: CaaDialogNode, b: CaaDialogNode) => {
    const ga = a.grid;
    const gb = b.grid;
    if (!ga || !gb) return a.id.localeCompare(b.id);
    return ga.row - gb.row || ga.col - gb.col;
  };

  const sortRecursive = (n: CaaDialogNode) => {
    n.children.sort(sortByGrid);
    n.children.forEach(sortRecursive);
  };
  sortRecursive(root);

  return root;
}

function findNodeBySegments(root: CaaDialogNode, segments: string[]): CaaDialogNode | null {
  if (segments.length === 0) return root;
  let current: CaaDialogNode = root;
  for (const seg of segments) {
    if (current.id === seg) continue;
    const child = current.children.find((c) => c.id === seg);
    if (!child) return null;
    current = child;
  }
  return current;
}

function applyNlsKey(root: CaaDialogNode, key: string, value: string) {
  const segments = key.split(".");
  for (let i = segments.length; i >= 1; i--) {
    const prop = segments[i - 1];
    const path = segments.slice(0, i - 1);
    const node = findNodeBySegments(root, path);
    if (!node) continue;

    if (!node.nls) node.nls = {};

    if (prop === "Title") {
      node.nls.title = value;
      return;
    }
    if (prop === "Help") {
      node.nls.help = value;
      return;
    }
    if (prop === "ShortHelp") {
      node.nls.shortHelp = value;
      return;
    }
    if (prop === "LongHelp") {
      node.nls.longHelp = value;
      return;
    }
    const col = prop.match(/^ColumnTitle(\d+)$/);
    if (col) {
      if (!node.nls.columnTitles) node.nls.columnTitles = [];
      const idx = Number.parseInt(col[1], 10) - 1;
      node.nls.columnTitles[idx] = value;
      return;
    }
  }
}

function mergeNls(root: CaaDialogNode, nls: Record<string, string>, dialogTitle?: { ref: { title?: string } }) {
  for (const [key, value] of Object.entries(nls)) {
    if (key === "Title") {
      if (dialogTitle) dialogTitle.ref.title = value;
      if (!root.nls) root.nls = {};
      root.nls.title = value;
      continue;
    }
    applyNlsKey(root, key, value);
  }
}

export function mergeDialogIr(opts: {
  catDlgText: string;
  catNlsText?: string;
  sources: CaaDialogIr["sources"];
}): CaaDialogIr {
  const flat = parseCatDlg(opts.catDlgText);
  const nodes = flat.map(flatToNode);
  const root = buildTree(nodes);
  const dialogName = root.id;

  const titleRef: { title?: string } = {};
  if (opts.catNlsText) {
    mergeNls(root, parseCatNls(opts.catNlsText), { ref: titleRef });
  }

  return {
    schemaVersion: 1,
    dialogName,
    title: titleRef.title ?? root.nls?.title,
    root,
    sources: opts.sources,
  };
}

export type { ControlNls };
