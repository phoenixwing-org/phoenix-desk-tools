import type { CaaDialogNode } from "./schema.js";

export const CAA_WIDGET_DECL_START = "CAA2 WIZARD WIDGET DECLARATION SECTION";
export const CAA_WIDGET_DECL_END = "END CAA2 WIZARD WIDGET DECLARATION SECTION";

export type WizardSectionPatchResult = {
  text: string;
  changed: boolean;
  warnings: string[];
};

function detectEol(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function wizardMemberName(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith("_") ? trimmed : `_${trimmed}`;
}

export function collectWizardWidgetNodes(root: CaaDialogNode): CaaDialogNode[] {
  const out: CaaDialogNode[] = [];
  function walk(node: CaaDialogNode, isRoot: boolean) {
    if (!isRoot) out.push(node);
    for (const child of node.children ?? []) walk(child, false);
  }
  walk(root, true);
  return out;
}

export function emitWizardHeaderDeclarations(root: CaaDialogNode): string {
  const lines = collectWizardWidgetNodes(root).map(
    (node) => ` ${node.type}*      ${wizardMemberName(node.id)};`,
  );
  return lines.join("\n");
}

export function replaceWizardSection(
  sourceText: string,
  startMarker: string,
  endMarker: string,
  bodyText: string,
): WizardSectionPatchResult {
  const eol = detectEol(sourceText);
  const lines = splitLines(sourceText);
  const startIndex = lines.findIndex((line) => line.includes(startMarker));
  const endIndex = lines.findIndex((line, idx) => idx > startIndex && line.includes(endMarker));
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    return {
      text: sourceText,
      changed: false,
      warnings: [`未找到 Wizard 标记段：${startMarker} → ${endMarker}`],
    };
  }

  const bodyLines = bodyText.length ? splitLines(bodyText) : [];
  const nextLines = [
    ...lines.slice(0, startIndex + 1),
    ...bodyLines,
    ...lines.slice(endIndex),
  ];
  const next = nextLines.join(eol);
  return { text: next, changed: next !== sourceText, warnings: [] };
}

export function patchWizardHeaderDeclarations(
  sourceText: string,
  root: CaaDialogNode,
): WizardSectionPatchResult {
  return replaceWizardSection(
    sourceText,
    CAA_WIDGET_DECL_START,
    CAA_WIDGET_DECL_END,
    emitWizardHeaderDeclarations(root),
  );
}
