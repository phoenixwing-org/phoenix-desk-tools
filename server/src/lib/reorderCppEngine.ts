export type CppReorderResult = {
  text: string;
  changed: boolean;
  className?: string;
};

type CppBlock = {
  implName: string;
  text: string;
  separator: string;
};

const DEFAULT_SEPARATOR = "//----------------------------------------\n";
const SEPARATOR_RE = /^\/\/-+\s*$/;
const ANNOTATION_SEPARATOR_RE = /^\/\/-{2,}\s*[A-Za-z].*-{2,}\s*$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSeparator(separator: string): string {
  const stripped = separator.replace(/[\r\n]+$/g, "").trim();
  return stripped ? `${stripped}\n` : DEFAULT_SEPARATOR;
}

function stripOuterBlankLines(text: string): string {
  const lines = text.split(/(?<=\n)/);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return "";
  const output = lines.join("");
  return output.endsWith("\n") ? output : `${output}\n`;
}

function cleanBlockText(text: string): string {
  let output = stripOuterBlankLines(text);
  if (!output) return "";
  output = output.trimEnd().replace(/\}\s*(\/\/-+\s*)$/, "}\n");
  output = output.replace(/^(?:\/\/-+\s*\n)+/, "");
  output = output.trimEnd().replace(/(?:\/\/-+\s*\n)+$/, "");
  output = output.replace(/^(?:\/\/-{2,}\s*[A-Za-z].*-{2,}\s*\n)+/, "");
  return output ? `${output.replace(/\n*$/, "")}\n` : "";
}

function isCodePosition(text: string, target: number): boolean {
  let i = 0;
  while (i < text.length && i < target) {
    if (text[i] === "/" && text[i + 1] === "/") {
      let end = i + 2;
      while (end < text.length && text[end] !== "\r" && text[end] !== "\n") end += 1;
      if (target < end) return false;
      i = end;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      let end = i + 2;
      while (end + 1 < text.length && !(text[end] === "*" && text[end + 1] === "/")) end += 1;
      end = Math.min(end + 2, text.length);
      if (target < end) return false;
      i = end;
      continue;
    }
    if (text[i] === "\"" || text[i] === "'") {
      const quote = text[i];
      let end = i + 1;
      while (end < text.length) {
        if (text[end] === "\\") end += 2;
        else if (text[end] === quote) {
          end += 1;
          break;
        } else end += 1;
      }
      if (target < end) return false;
      i = end;
      continue;
    }
    i += 1;
  }
  return true;
}

function findClassName(text: string, fileStem: string): string | null {
  const counts = new Map<string, number>();
  const regex = /\b([A-Za-z_]\w*)::((?:~[A-Za-z_]\w*)|~?[A-Za-z_]\w*|operator\s*[^\s(]+)\s*[<(]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const className = match[1];
    if (/^[A-Z]/.test(className)) counts.set(className, (counts.get(className) || 0) + 1);
  }
  if (!counts.size) return null;
  if (counts.has(fileStem)) return fileStem;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function isReturnTypeLine(line: string, className: string): boolean {
  const stripped = line.trim();
  if (!stripped || SEPARATOR_RE.test(stripped)) return false;
  if (stripped.startsWith("//") || stripped.startsWith("/*") || stripped.startsWith("#")) return false;
  if (/[};{]$/.test(stripped) || new RegExp(`\\b${escapeRegExp(className)}::`).test(stripped)) return false;
  if (/[()]/.test(stripped)) return false;
  return /^[\w:<>,\s*&]+(?:const|volatile|static|virtual|constexpr|inline|unsigned|signed|long|short|friend|explicit|mutable|\*)*\s*$/.test(stripped);
}

function includeReturnTypeLines(text: string, blockStart: number, previousEnd: number, className: string): number {
  let start = blockStart;
  let pos = blockStart;
  while (pos > previousEnd) {
    let lineEnd = pos - 1;
    while (lineEnd > previousEnd && (text[lineEnd] === "\r" || text[lineEnd] === "\n")) lineEnd -= 1;
    if (lineEnd <= previousEnd) break;
    const lineStart = text.lastIndexOf("\n", lineEnd - 1) + 1;
    if (!isReturnTypeLine(text.slice(lineStart, lineEnd + 1), className)) break;
    start = lineStart;
    pos = lineStart;
  }
  return start;
}

function splitPreambleAndBody(text: string, className: string): { preamble: string; body: string } {
  const escaped = escapeRegExp(className);
  const constructor = new RegExp(
    `^[ \\t]*(?:[\\w:<>,\\s*&]+\\s+)?\\b${escaped}::${escaped}\\s*\\(`,
    "m",
  );
  // Match the Python engine's safety boundary: files without a constructor
  // are left untouched because their generated/Wizard regions may be ordered.
  if (!constructor.test(text)) return { preamble: text, body: "" };

  const memberName = `(?:~${escaped}|~?[A-Za-z_]\\w*|operator\\s*[^\\s(]+)`;
  const returnType = `(?:[\\w:<>,~*&]+(?:[ \\t]+[\\w:<>,~*&]+)*[ \\t]+)?`;
  const regex = new RegExp(
    `^[ \\t]*${returnType}\\b${escaped}::${memberName}\\s*[<(]`,
    "m",
  );
  const match = regex.exec(text);
  if (!match) return { preamble: text, body: "" };
  let start = includeReturnTypeLines(text, match.index, 0, className);
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const previousLineEnd = lineStart - 1;
  if (previousLineEnd > 0) {
    const previousLineStart = text.lastIndexOf("\n", previousLineEnd - 1) + 1;
    if (SEPARATOR_RE.test(text.slice(previousLineStart, previousLineEnd + 1).trim())) start = previousLineStart;
  }
  return { preamble: text.slice(0, start), body: text.slice(start) };
}

function advancePastFunctionEnd(text: string, start: number): { end: number; gluedSeparator: string } {
  let i = start;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i += 1;
  let gluedSeparator = "";
  if (text[i] === "/" && text[i + 1] === "/") {
    const separatorStart = i;
    while (i < text.length && text[i] !== "\r" && text[i] !== "\n") i += 1;
    gluedSeparator = normalizeSeparator(text.slice(separatorStart, i));
  }
  while (i < text.length && (text[i] === "\r" || text[i] === "\n")) i += 1;
  return { end: i, gluedSeparator };
}

function findFunctionBodyEnd(text: string, implementationStart: number): { end: number; gluedSeparator: string } {
  const parenStart = text.indexOf("(", implementationStart);
  if (parenStart < 0) return { end: text.length, gluedSeparator: "" };
  let paren = 1;
  let i = parenStart + 1;
  while (i < text.length && paren > 0) {
    if (text[i] === "(") paren += 1;
    else if (text[i] === ")") paren -= 1;
    i += 1;
  }

  while (i < text.length) {
    while (i < text.length && /[ \t\r\n]/.test(text[i])) i += 1;
    if (i >= text.length) return { end: text.length, gluedSeparator: "" };
    const ch = text[i];
    if (ch === "{") {
      let depth = 1;
      i += 1;
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth += 1;
        else if (text[i] === "}") depth -= 1;
        i += 1;
      }
      return advancePastFunctionEnd(text, i);
    }
    if (ch === ";") {
      i += 1;
      while (i < text.length && text[i] !== "\r" && text[i] !== "\n") i += 1;
      return advancePastFunctionEnd(text, i);
    }
    if (ch === ":") {
      i += 1;
      let parenDepth = 0;
      let braceDepth = 0;
      while (i < text.length) {
        while (i < text.length && /[ \t\r\n]/.test(text[i])) i += 1;
        if (i >= text.length) return { end: text.length, gluedSeparator: "" };
        const current = text[i];
        if (current === "(") {
          parenDepth += 1;
          i += 1;
        } else if (current === ")") {
          parenDepth = Math.max(0, parenDepth - 1);
          i += 1;
        } else if (current === "{") {
          if (parenDepth === 0 && braceDepth === 0) {
            let previous = i - 1;
            while (previous >= 0 && (text[previous] === " " || text[previous] === "\t")) previous -= 1;
            if (text[previous] === ")") break;
            if (previous >= 0 && (/[_=,]/.test(text[previous]) || /[A-Za-z0-9]/.test(text[previous]))) {
              braceDepth += 1;
              i += 1;
            } else break;
          } else {
            braceDepth += 1;
            i += 1;
          }
        } else if (current === "}") {
          braceDepth = Math.max(0, braceDepth - 1);
          i += 1;
        } else i += 1;
      }
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      while (i < text.length && /[A-Za-z0-9_:]/.test(text[i])) i += 1;
      continue;
    }
    i += 1;
  }
  return { end: text.length, gluedSeparator: "" };
}

function walkBackBlockStart(
  text: string,
  functionLineStart: number,
  previousEnd: number,
  className: string,
): { blockStart: number; separator: string } {
  let blockStart = functionLineStart;
  let separator = "";
  let pos = functionLineStart;
  while (pos > previousEnd) {
    let lineEnd = pos - 1;
    while (lineEnd > previousEnd && (text[lineEnd] === "\r" || text[lineEnd] === "\n")) lineEnd -= 1;
    if (lineEnd <= previousEnd) break;
    let lineStart = text.lastIndexOf("\n", lineEnd - 1) + 1;
    if (lineStart <= previousEnd && previousEnd > 0) lineStart = previousEnd;
    const line = text.slice(lineStart, lineEnd + 1);
    const stripped = line.trim();
    if (!stripped) break;

    const glued = stripped.match(/^}\s*(\/\/-+\s*)$/);
    if (glued) {
      separator = normalizeSeparator(glued[1]);
      break;
    }
    if (SEPARATOR_RE.test(stripped)) {
      separator = normalizeSeparator(stripped);
      break;
    }
    if (stripped.endsWith("*/")) {
      const commentStart = text.lastIndexOf("/*", lineStart);
      if (commentStart >= previousEnd) {
        blockStart = commentStart;
        pos = commentStart;
        continue;
      }
      break;
    }
    if (ANNOTATION_SEPARATOR_RE.test(stripped)) {
      if (!separator) separator = normalizeSeparator(stripped);
      pos = lineStart;
      continue;
    }
    if (stripped.startsWith("//")) {
      blockStart = lineStart;
      pos = lineStart;
      continue;
    }
    if (stripped.startsWith("#")) break;
    break;
  }
  blockStart = includeReturnTypeLines(text, blockStart, previousEnd, className);
  return { blockStart, separator };
}

function scanBlocks(body: string, className: string): CppBlock[] {
  const escaped = escapeRegExp(className);
  const regex = new RegExp(`\\b${escaped}::((?:~${escaped})|~?[A-Za-z_]\\w*|operator\\s*[^\\s(]+)\\s*[<(]`, "g");
  const blocks: CppBlock[] = [];
  let previousEnd = 0;
  let pendingGluedSeparator = "";
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body))) {
    if (!isCodePosition(body, match.index) || match.index < previousEnd) continue;
    const implName = match[1].replace(/[<(]$/, "").trim();
    const functionLineStart = body.lastIndexOf("\n", Math.max(0, match.index - 1)) + 1;
    const walked = walkBackBlockStart(body, functionLineStart, previousEnd, className);
    const separator = walked.separator || pendingGluedSeparator;
    pendingGluedSeparator = "";
    const found = findFunctionBodyEnd(body, match.index);
    pendingGluedSeparator = found.gluedSeparator;
    const text = cleanBlockText(body.slice(walked.blockStart, found.end));
    if (!text.includes("{") && !text.includes("= delete") && !text.includes("= default")) {
      previousEnd = found.end;
      regex.lastIndex = Math.max(regex.lastIndex, found.end);
      continue;
    }
    blocks.push({ implName, text, separator });
    previousEnd = found.end;
    regex.lastIndex = Math.max(regex.lastIndex, found.end);
  }
  return blocks;
}

function classifySpecial(className: string, block: CppBlock): number | null {
  const name = block.implName.replace(/\s+/g, "");
  const flat = block.text.replace(/\s+/g, " ");
  if (name.startsWith("~") || name === `~${className}`) return 2;
  if (name.startsWith("operator")) {
    if (name.startsWith("operator=")) return /operator\s*=\s*\([^)]*&&/.test(flat) ? 6 : 5;
    return 7;
  }
  if (name === className) {
    const escaped = escapeRegExp(className);
    if (new RegExp(`\\b${escaped}\\s*\\(\\s*const\\s+${escaped}\\s*&`).test(flat)) return 3;
    if (new RegExp(`\\b${escaped}\\s*\\(\\s*${escaped}\\s*&&`).test(flat)) return 4;
    if (new RegExp(`\\b${escaped}\\s*\\(\\s*\\)`).test(flat)) return 0;
    return 1;
  }
  return null;
}

function compareNames(left: CppBlock, right: CppBlock): number {
  return left.implName.localeCompare(right.implName, "en", { sensitivity: "base" });
}

function rebuildBlocks(blocks: CppBlock[], className: string): string {
  const special = blocks.filter((block) => classifySpecial(className, block) != null);
  const members = blocks.filter((block) => classifySpecial(className, block) == null);
  special.sort((a, b) => classifySpecial(className, a)! - classifySpecial(className, b)! || compareNames(a, b));
  members.sort(compareNames);
  let output = "";
  for (const block of [...special, ...members]) {
    const text = cleanBlockText(block.text);
    if (text) output += normalizeSeparator(block.separator) + text;
  }
  return output;
}

function reorderNormalizedCpp(text: string, fileStem: string): { text: string; className?: string } {
  const className = findClassName(text, fileStem);
  if (!className) return { text };
  const split = splitPreambleAndBody(text, className);
  if (!split.body) return { text, className };
  const blocks = scanBlocks(split.body, className);
  if (!blocks.length) return { text, className };
  return { text: split.preamble + rebuildBlocks(blocks, className), className };
}

export function reorderCppText(text: string, fileStem: string): CppReorderResult {
  const eol = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
  const normalized = text.replace(/\r\n|\r/g, "\n");
  const result = reorderNormalizedCpp(normalized, fileStem);
  const output = eol === "\n" ? result.text : result.text.replace(/\n/g, eol);
  return { text: output, changed: output !== text, className: result.className };
}
