import type { CaaDialogBinding } from "./schema.js";

export type ExtractWizardBindingsOptions = {
  knownControlIds?: string[];
};

function countChar(text: string, char: string): number {
  let count = 0;
  for (const c of text) {
    if (c === char) count += 1;
  }
  return count;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function controlMatchesLine(line: string, controlId: string): boolean {
  const escaped = escapeRegExp(controlId);
  return new RegExp(`(^|[^A-Za-z0-9_])_?${escaped}([^A-Za-z0-9_]|$)`).test(line);
}

function inferControlIdsFromLine(line: string): string[] {
  const out: string[] = [];
  const re = /\b_([A-Za-z]\w*)\s*(?:->|\.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function targetLooksLikeDataPath(target: string): boolean {
  if (target.startsWith("_")) return false;
  const first = target.split(/->|\./)[0] ?? "";
  const last = target.split(/->|\./).at(-1) ?? "";
  if (/^(this|self)$/i.test(first)) return false;
  if (/^(Set|Get|Initialize|Add|Remove|Build|Update|Create|Delete)/.test(last)) return false;
  return /(?:->|\.)/.test(target);
}

function extractTargets(line: string): string[] {
  const out: string[] = [];
  const re = /\b[A-Za-z_]\w*(?:(?:->|\.)[A-Za-z_]\w*)+\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const target = m[0];
    if (!targetLooksLikeDataPath(target)) continue;
    if (!out.includes(target)) out.push(target);
  }
  return out;
}

function sourceLabelForLine(
  line: string,
  state: { inKevin: boolean; updatePending: boolean; inUpdate: boolean },
): CaaDialogBinding["source"] | undefined {
  if (state.inKevin) return "kevinWizard";
  if (state.inUpdate || state.updatePending || /\bUpdateDialog\s*\(/.test(line)) return "updateDialog";
  return undefined;
}

function updateStateAfterLine(
  line: string,
  state: { inKevin: boolean; updatePending: boolean; inUpdate: boolean; updateDepth: number },
): void {
  if (/START\s+KEVIN\s+CAA\s+WIZARD/i.test(line)) {
    state.inKevin = true;
  }

  if (!state.inUpdate && !state.updatePending && /\bUpdateDialog\s*\(/.test(line)) {
    state.updatePending = true;
    state.updateDepth = 0;
  }

  if (state.updatePending || state.inUpdate) {
    const opens = countChar(line, "{");
    const closes = countChar(line, "}");
    if (opens > 0) {
      state.inUpdate = true;
      state.updatePending = false;
    }
    if (state.inUpdate) {
      state.updateDepth += opens - closes;
      if (state.updateDepth <= 0) {
        state.inUpdate = false;
        state.updatePending = false;
        state.updateDepth = 0;
      }
    } else if (state.updatePending && /;\s*$/.test(line)) {
      state.updatePending = false;
    }
  }

  if (/END\s+KEVIN\s+CAA\s+WIZARD/i.test(line)) {
    state.inKevin = false;
  }
}

export function extractWizardBindingsFromCpp(
  sourceText: string,
  options: ExtractWizardBindingsOptions = {},
): CaaDialogBinding[] {
  const knownControlIds = [...new Set(options.knownControlIds?.filter(Boolean) ?? [])];
  const lines = sourceText.split(/\r?\n/);
  const bindings: CaaDialogBinding[] = [];
  const seen = new Set<string>();
  const state = {
    inKevin: false,
    updatePending: false,
    inUpdate: false,
    updateDepth: 0,
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const isStartMarker = /START\s+KEVIN\s+CAA\s+WIZARD/i.test(line);
    const isEndMarker = /END\s+KEVIN\s+CAA\s+WIZARD/i.test(line);
    if (isStartMarker) state.inKevin = true;

    const source = sourceLabelForLine(line, state);
    if (source && !isStartMarker && !isEndMarker) {
      const controlIds = knownControlIds.length
        ? knownControlIds.filter((id) => controlMatchesLine(line, id))
        : inferControlIdsFromLine(line);
      const targets = extractTargets(line);

      for (const controlId of controlIds) {
        for (const target of targets) {
          const key = `${source}|${i + 1}|${controlId}|${target}`;
          if (seen.has(key)) continue;
          seen.add(key);
          bindings.push({
            nodeId: controlId,
            controlId,
            target,
            source,
            line: i + 1,
            text: line.trim().slice(0, 240),
          });
        }
      }
    }

    updateStateAfterLine(line, state);
  }

  return bindings;
}
