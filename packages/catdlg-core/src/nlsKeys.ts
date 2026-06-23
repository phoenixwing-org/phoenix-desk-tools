import type { CaaDialogNode } from "./schema.js";

export type NlsStringProp = "title" | "help" | "shortHelp" | "longHelp";

const PROP_SUFFIX: Record<NlsStringProp, string> = {
  title: "Title",
  help: "Help",
  shortHelp: "ShortHelp",
  longHelp: "LongHelp",
};

/** 自根对话框向下构建 id → 节点索引（不含重复遍历）。 */
export function indexDialogNodes(root: CaaDialogNode): Map<string, CaaDialogNode> {
  const map = new Map<string, CaaDialogNode>();
  const walk = (n: CaaDialogNode) => {
    map.set(n.id, n);
    n.children.forEach(walk);
  };
  walk(root);
  return map;
}

/** 从对话框根到该控件的 id 路径（不含对话框根 id）。 */
export function nlsPathSegments(node: CaaDialogNode, root: CaaDialogNode): string[] {
  if (node.id === root.id) return [];
  const byId = indexDialogNodes(root);
  const segments: string[] = [];
  let current: CaaDialogNode | undefined = node;
  while (current && current.id !== root.id) {
    segments.unshift(current.id);
    const fatherId: string | undefined = current.father;
    current = fatherId ? byId.get(fatherId) : undefined;
  }
  return segments;
}

export function nlsKeyForProp(
  segments: string[],
  prop: NlsStringProp,
  columnIndex?: number,
): string {
  if (columnIndex != null) {
    const prefix = segments.join(".");
    return `${prefix}.ColumnTitle${columnIndex + 1}`;
  }
  if (prop === "title" && segments.length === 0) return "Title";
  const suffix = PROP_SUFFIX[prop];
  return `${segments.join(".")}.${suffix}`;
}

export function nlsDisplayBinding(
  node: CaaDialogNode,
  root: CaaDialogNode,
  opts?: { selectorPlaceholder?: string },
): { text: string; prop: NlsStringProp; key: string; isPlaceholder?: boolean } {
  const segments = nlsPathSegments(node, root);
  const nls = node.nls;
  if (nls?.title?.trim()) {
    return { text: nls.title.trim(), prop: "title", key: nlsKeyForProp(segments, "title") };
  }
  if (nls?.shortHelp?.trim()) {
    return {
      text: nls.shortHelp.trim(),
      prop: "shortHelp",
      key: nlsKeyForProp(segments, "shortHelp"),
    };
  }
  if (nls?.help?.trim()) {
    return { text: nls.help.trim(), prop: "help", key: nlsKeyForProp(segments, "help") };
  }
  if (node.type === "CATDlgSelectorList") {
    const ph = opts?.selectorPlaceholder ?? "（选择列表）";
    return {
      text: ph,
      prop: "shortHelp",
      key: nlsKeyForProp(segments, "shortHelp"),
      isPlaceholder: true,
    };
  }
  return { text: node.id, prop: "title", key: nlsKeyForProp(segments, "title") };
}

export function applyNlsPropToNode(
  node: CaaDialogNode,
  prop: NlsStringProp,
  value: string,
  columnIndex?: number,
): void {
  if (!node.nls) node.nls = {};
  const trimmed = value.trim();
  if (columnIndex != null) {
    if (!node.nls.columnTitles) node.nls.columnTitles = [];
    node.nls.columnTitles[columnIndex] = trimmed;
    return;
  }
  switch (prop) {
    case "title":
      node.nls.title = trimmed;
      break;
    case "help":
      node.nls.help = trimmed;
      break;
    case "shortHelp":
      node.nls.shortHelp = trimmed;
      break;
    case "longHelp":
      node.nls.longHelp = trimmed;
      break;
  }
}
