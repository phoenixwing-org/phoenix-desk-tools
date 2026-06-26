import type { CaaDialogNode } from "./schema.js";
import { replaceWizardSection } from "./wizardHeader.js";

export const CAA_WIDGET_CONSTRUCTION_START = "CAA2 WIZARD WIDGET CONSTRUCTION SECTION";
export const CAA_WIDGET_CONSTRUCTION_END = "END CAA2 WIZARD WIDGET CONSTRUCTION SECTION";

function memberName(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith("_") ? trimmed : `_${trimmed}`;
}

function cppString(value: string): string {
  return JSON.stringify(value);
}

function cppIdentifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, "_");
  const safe = cleaned || "Control";
  return /^[A-Za-z_]/.test(safe) ? safe : `_${safe}`;
}

function styleExpr(node: CaaDialogNode): string {
  const styles = node.style?.map((s) => s.trim()).filter(Boolean) ?? [];
  return styles.length ? styles.join(" | ") : "0";
}

function parentExpr(node: CaaDialogNode, root: CaaDialogNode): string {
  const father = node.father?.trim();
  if (!father || father === root.id) return "this";
  return memberName(father);
}

function gridAnchorExpr(node: CaaDialogNode): string {
  return node.grid?.anchor?.trim() || "CATGRID_4SIDES";
}

function columnTitleValues(node: CaaDialogNode): string[] {
  const titles = node.nls?.columnTitles ?? [];
  const count = Math.max(node.size?.columnCount ?? 0, titles.length);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push((titles[i] ?? "").trim());
  }
  return out;
}

function emitColumnTitles(lines: string[], node: CaaDialogNode, opts: { skipForIds: Set<string> }): void {
  if (node.type !== "CATDlgMultiList") return;
  if (opts.skipForIds.has(node.id)) return;
  const titles = columnTitleValues(node);
  if (!titles.length) return;
  const name = memberName(node.id);
  const varName = `${cppIdentifier(node.id)}ColumnTitles`;
  lines.push(`CATUnicodeString ${varName}[] = {`);
  for (const title of titles) {
    lines.push(`  CATUnicodeString(${cppString(title)}),`);
  }
  lines.push("};");
  lines.push(`${name}->SetColumnTitles(${varName}, ${titles.length});`);
}

function emitNodeConstruction(
  lines: string[],
  root: CaaDialogNode,
  node: CaaDialogNode,
  opts: { skipGeneratedColumnTitlesFor: Set<string> },
) {
  const name = memberName(node.id);
  lines.push(`${name} = new ${node.type}(${parentExpr(node, root)}, ${cppString(node.id)}, ${styleExpr(node)});`);
  if (node.grid) {
    lines.push(
      `${name}->SetGridConstraints(${node.grid.row}, ${node.grid.col}, ${node.grid.rowSpan}, ${node.grid.colSpan}, ${gridAnchorExpr(node)});`,
    );
  }
  if (node.gridLayout?.rowResizable?.length) {
    for (const row of node.gridLayout.rowResizable) {
      lines.push(`${name}->SetGridRowResizable(${row});`);
    }
  }
  if (node.gridLayout?.colResizable?.length) {
    for (const col of node.gridLayout.colResizable) {
      lines.push(`${name}->SetGridColumnResizable(${col});`);
    }
  }
  emitColumnTitles(lines, node, { skipForIds: opts.skipGeneratedColumnTitlesFor });
  for (const child of node.children ?? []) emitNodeConstruction(lines, root, child, opts);
}

function sectionBodyLines(sourceText: string): string[] {
  const lines = sourceText.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.includes(CAA_WIDGET_CONSTRUCTION_START));
  const endIndex = lines.findIndex((line, idx) => idx > startIndex && line.includes(CAA_WIDGET_CONSTRUCTION_END));
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) return [];
  return lines.slice(startIndex + 1, endIndex);
}

function nodeIdTokens(root: CaaDialogNode): Map<string, string> {
  const tokens = new Map<string, string>();
  function walk(node: CaaDialogNode) {
    tokens.set(node.id, node.id);
    tokens.set(memberName(node.id), node.id);
    for (const child of node.children ?? []) walk(child);
  }
  walk(root);
  return tokens;
}

function setColumnTitlesReceiver(line: string): string | null {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*->\s*SetColumnTitles\b/);
  return match?.[1] ?? null;
}

function preservedColumnTitleCalls(sourceText: string, root: CaaDialogNode): { lines: string[]; nodeIds: Set<string> } {
  const ids = nodeIdTokens(root);
  const kept: string[] = [];
  const nodeIds = new Set<string>();
  for (const line of sectionBodyLines(sourceText)) {
    const receiver = setColumnTitlesReceiver(line);
    if (!receiver) continue;
    const nodeId = ids.get(receiver);
    if (!nodeId) continue;
    kept.push(line);
    nodeIds.add(nodeId);
  }
  return { lines: kept, nodeIds };
}

function collectConstructionWarnings(root: CaaDialogNode, preservedColumnTitleNodeIds: Set<string>): string[] {
  const warnings: string[] = [];
  function walk(node: CaaDialogNode) {
    if (columnTitleValues(node).length) {
      if (preservedColumnTitleNodeIds.has(node.id)) {
        warnings.push(
          `Wizard .cpp 构造段保留了既有 SetColumnTitles 调用；请在预览中核对列标题是否仍匹配：${node.id}`,
        );
      } else {
        warnings.push(
          `Wizard .cpp 构造段已生成 SetColumnTitles；请编译核对 CATUnicodeString[] 签名：${node.id}`,
        );
      }
    }
    for (const child of node.children ?? []) walk(child);
  }
  walk(root);
  return warnings;
}

export function emitWizardCppConstruction(
  root: CaaDialogNode,
  opts?: { skipGeneratedColumnTitlesFor?: Set<string> },
): string {
  const lines: string[] = [];
  const skipGeneratedColumnTitlesFor = opts?.skipGeneratedColumnTitlesFor ?? new Set<string>();
  for (const child of root.children ?? []) {
    emitNodeConstruction(lines, root, child, { skipGeneratedColumnTitlesFor });
  }
  return lines.join("\n");
}

export function patchWizardCppConstruction(sourceText: string, root: CaaDialogNode) {
  const preserved = preservedColumnTitleCalls(sourceText, root);
  const body = [
    emitWizardCppConstruction(root, { skipGeneratedColumnTitlesFor: preserved.nodeIds }),
    preserved.lines.length
      ? ["", "// Preserved existing SetColumnTitles calls; verify against current NLS.", ...preserved.lines].join("\n")
      : "",
  ].filter(Boolean).join("\n");
  const result = replaceWizardSection(
    sourceText,
    CAA_WIDGET_CONSTRUCTION_START,
    CAA_WIDGET_CONSTRUCTION_END,
    body,
  );
  return {
    ...result,
    warnings: [...result.warnings, ...collectConstructionWarnings(root, preserved.nodeIds)],
  };
}
