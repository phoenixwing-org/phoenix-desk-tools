type KevinSystemCodeMode = "merge_strip" | "keep_markers" | "off";

export type HeaderReorderOptions = {
  sortMembers?: boolean;
  kevinSystemCodeMode?: KevinSystemCodeMode;
};

export type HeaderReorderResult = {
  text: string;
  changed: boolean;
  warnings: string[];
};

type LockedRule = {
  id: string;
  start: RegExp;
  end: RegExp;
};

export type LockedRegion = {
  start: number;
  end: number;
  content: string;
  ruleId: string;
};

type DeclKind = "special" | "method" | "member" | "group" | "nested" | "macro" | "other" | "locked" | "system_code";

type DeclItem = {
  text: string;
  name: string;
  kind: DeclKind;
  trailingGap: boolean;
};

type AccessSection = {
  label: string;
  indent: string;
  labelText: string;
  items: DeclItem[];
  trailingGap: boolean;
};

const LOCKED_RULES: LockedRule[] = [
  {
    id: "clang-format",
    start: /^\s*\/\/\s*clang-format\s+off\s*(?:\/\/.*)?$/,
    end: /^\s*\/\/\s*clang-format\s+on\s*(?:\/\/.*)?$/,
  },
  {
    id: "kevin-caa-wizard",
    start: /^\s*\/\/\s*START\s+KEVIN\s+CAA\s+WIZARD\s+SECTION\b/i,
    end: /^\s*\/\/\s*END\s+KEVIN\s+CAA\s+WIZARD\s+SECTION\b/i,
  },
  {
    id: "caa2-wizard",
    start: /^\s*\/\/\s*CAA2\s+WIZARD\b/,
    end: /^\s*\/\/\s*END\s+CAA2\s+WIZARD\b/,
  },
  {
    id: "pragma-region",
    start: /^\s*#\s*pragma\s+region\b/,
    end: /^\s*#\s*pragma\s+endregion\b/,
  },
];

const ACCESS_RE = /^([ \t]*)((?:public|private|protected)(?:[ \t]+slots)?|signals)[ \t]*:[ \t]*(?:\/\/[^\n]*)?[ \t]*$/gm;
const CLASS_RE = /\bclass\s+((?:[A-Za-z_]\w*\s+)*?[A-Za-z_]\w*)\s*(?=final\b|:|\{)(?:final\s*)?(?::\s*[^{;]+)?\s*\{/g;
const DOXYGEN_GROUP_OPEN_RE = /^\s*\/\/\/@\{/;
const DOXYGEN_GROUP_CLOSE_RE = /^\s*\/\/\/@\}/;
const KEVIN_SYSTEM_CODE_START_RE = /^\s*\/\/\s*KEVIN_SYSTEM_CODE\s+START\b/;
const KEVIN_SYSTEM_CODE_END_RE = /^\s*\/\/\s*KEVIN_SYSTEM_CODE\s+END\b/;
const KEVIN_SYSTEM_CODE_NOTE_RE = /@note\s+KEVIN_SYSTEM_CODE\b/;
const NUMBERED_DOXY_ITEM_RE = /\/\*\*\s*\d+\.|^\s*\*\s+\d+\./m;

const CPP_KEYWORDS = new Set([
  "if", "for", "while", "switch", "return", "explicit", "virtual", "static", "constexpr", "inline",
  "friend", "const", "volatile", "noexcept", "override", "final", "mutable", "thread_local", "extern",
  "typedef", "typename", "class", "struct", "enum", "union", "template", "decltype", "consteval",
  "concept", "requires", "operator", "using",
]);

function splitLinesKeepEnds(text: string): string[] {
  const out: string[] = [];
  const re = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (!match[0]) break;
    out.push(match[0]);
  }
  return out;
}

function matchRule(line: string, side: "start" | "end"): LockedRule | undefined {
  const content = line.replace(/[\r\n]+$/, "");
  return LOCKED_RULES.find((rule) => rule[side].test(content));
}

function mergedRuleId(left: LockedRegion, right: LockedRegion): string {
  if (left.ruleId === right.ruleId) return left.ruleId;
  if (left.ruleId === "clang-format" || right.ruleId === "clang-format") return "clang-format";
  const outer = left.start <= right.start ? left : right;
  const inner = outer === left ? right : left;
  return inner.start >= outer.start && inner.end <= outer.end ? outer.ruleId : "mixed";
}

export function findLockedRegions(text: string): LockedRegion[] {
  const raw: LockedRegion[] = [];
  const pending: Array<{ id: string; start: number }> = [];
  let offset = 0;
  for (const line of splitLinesKeepEnds(text)) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    const endRule = matchRule(line, "end");
    if (endRule) {
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        if (pending[i].id !== endRule.id) continue;
        const opened = pending.splice(i, 1)[0];
        raw.push({ start: opened.start, end: lineEnd, content: text.slice(opened.start, lineEnd), ruleId: endRule.id });
        break;
      }
    } else {
      const startRule = matchRule(line, "start");
      if (startRule) pending.push({ id: startRule.id, start: lineStart });
    }
    offset = lineEnd;
  }

  const ordered = raw.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: LockedRegion[] = [];
  for (const span of ordered) {
    const previous = merged[merged.length - 1];
    if (!previous || span.start > previous.end) {
      merged.push(span);
      continue;
    }
    const end = Math.max(previous.end, span.end);
    merged[merged.length - 1] = {
      start: previous.start,
      end,
      content: text.slice(previous.start, end),
      ruleId: mergedRuleId(previous, span),
    };
  }
  return merged;
}

export function extractLockedRegionContents(text: string): string[] {
  return findLockedRegions(text).map((span) => span.content);
}

function splitByLockedRegions(text: string): Array<{ text: string; locked: boolean }> {
  const spans = findLockedRegions(text);
  if (!spans.length) return [{ text, locked: false }];
  const out: Array<{ text: string; locked: boolean }> = [];
  let pos = 0;
  for (const span of spans) {
    if (span.start > pos) out.push({ text: text.slice(pos, span.start), locked: false });
    out.push({ text: span.content, locked: true });
    pos = span.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), locked: false });
  return out;
}

function normalizeMode(raw: unknown): KevinSystemCodeMode {
  return raw === "keep_markers" || raw === "off" || raw === "merge_strip" ? raw : "merge_strip";
}

function normalizeAccessLabel(raw: string): string {
  return `${raw.trim().replace(/:$/, "")}:`;
}

function isClassBodyMacro(stripped: string): boolean {
  return stripped.startsWith("Q_") || stripped.startsWith("friend ") || /^[A-Z][A-Z0-9_]*.*(?:DECLARE|IMPLEMENT)\w*\s*\(/.test(stripped);
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\r\n]*/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function declarationSignature(decl: string): string {
  const sig = stripComments(decl);
  const brace = sig.indexOf("{");
  if (brace < 0) return sig;
  const before = sig.slice(0, brace).trimEnd();
  if (/\w_\s*$/.test(before) && /\{[^}]*\}\s*;/.test(sig.slice(brace))) return sig;
  return before;
}

function firstTopLevelParen(sig: string): number {
  let angle = 0;
  for (let i = 0; i < sig.length; i += 1) {
    if (sig[i] === "<") angle += 1;
    else if (sig[i] === ">") angle = Math.max(0, angle - 1);
    else if (sig[i] === "(" && angle === 0) return i;
  }
  return -1;
}

function isDoxygenGroupBlock(text: string): boolean {
  let hasOpen = false;
  let hasClose = false;
  for (const line of splitLinesKeepEnds(text)) {
    if (DOXYGEN_GROUP_OPEN_RE.test(line)) hasOpen = true;
    if (DOXYGEN_GROUP_CLOSE_RE.test(line)) hasClose = true;
  }
  return hasOpen && hasClose;
}

function parseMemberName(decl: string): string {
  const sig = declarationSignature(decl) || stripComments(decl);
  return (
    sig.match(/(\w+_)\s*\{[^}]*\}\s*;/)?.[1] ||
    sig.match(/(\w+_)\s*(?:\/\/\/<|;)/)?.[1] ||
    sig.match(/(\w+)\s*(?:\/\/\/<|;)/)?.[1] ||
    sig.slice(0, 30)
  );
}

function parseMethodName(decl: string): string {
  const sig = declarationSignature(decl) || decl.replace(/\s+/g, " ").slice(0, 200);
  if (sig.includes("operator=")) return "operator=";
  const op = sig.match(/\boperator\s*[^\s(]+\s*\(/);
  if (op) return op[0].split("(")[0].trim();
  const paren = firstTopLevelParen(sig);
  if (paren < 0) return sig.slice(0, 40);
  const name = sig.slice(0, paren).trimEnd().match(/([A-Za-z_]\w*)\s*$/)?.[1];
  return name && !CPP_KEYWORDS.has(name) ? name : sig.slice(0, 40);
}

function parseSpecialName(decl: string, className: string): string {
  if (decl.includes(`~${className}`)) return `~${className}`;
  if (decl.includes("operator=")) return "operator=";
  if (new RegExp(`\\b${escapeRegExp(className)}\\s*\\(`).test(decl)) return className;
  return decl.match(/operator\s*\S+\s*\(/)?.[0].split("(")[0].trim() || decl.slice(0, 30);
}

function firstMethodNameInBlock(text: string, className: string): string {
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("/**") || stripped.startsWith("*") || stripped.startsWith("//") || !stripped.includes("(")) continue;
    const item = classifyDeclaration(stripped, className);
    if ((item.kind === "method" || item.kind === "special") && item.name) return item.name;
  }
  return "group";
}

function classifyDeclaration(text: string, className: string): DeclItem {
  const stripped = text.trim();
  const item: DeclItem = { text, name: "", kind: "other", trailingGap: false };
  if (!stripped) return item;
  if (isClassBodyMacro(stripped)) return { ...item, kind: "macro", name: stripped };
  if (isDoxygenGroupBlock(text)) return { ...item, kind: "group", name: firstMethodNameInBlock(text, className) };

  const sig = declarationSignature(text);
  const code = stripComments(text);
  const usingMatch = code.match(/\busing\s+([A-Za-z_]\w*)\s*=/);
  if (usingMatch) return { ...item, kind: "nested", name: usingMatch[1] };
  const enumMatch = code.match(/\benum\s+(?:class\s+)?([A-Za-z_]\w*)/);
  if (enumMatch && text.includes("{")) return { ...item, kind: "nested", name: enumMatch[1] };
  const structMatch = code.match(/\bstruct\s+([A-Za-z_]\w*)/);
  if (structMatch && text.includes("{")) return { ...item, kind: "nested", name: structMatch[1] };

  if (sig.includes("= delete") || sig.includes("= default")) {
    if (new RegExp(`\\b~?${escapeRegExp(className)}\\s*\\(`).test(sig) || sig.includes("operator=")) {
      return { ...item, kind: "special", name: parseSpecialName(sig, className) };
    }
    return { ...item, kind: "method", name: parseMethodName(text) };
  }
  if (new RegExp(`\\b~?${escapeRegExp(className)}\\s*\\(`).test(sig)) {
    return { ...item, kind: "special", name: parseSpecialName(sig, className) };
  }
  if (sig.includes("(")) {
    const memberName = parseMemberName(text);
    if (memberName.endsWith("_") && new RegExp(`\\b${escapeRegExp(memberName)}\\s*;`).test(sig) && !new RegExp(`\\b${escapeRegExp(memberName)}\\s*\\(`).test(sig)) {
      return { ...item, kind: "member", name: memberName };
    }
    return { ...item, kind: "method", name: parseMethodName(text) };
  }
  if (sig.includes(";") && !sig.trimEnd().endsWith(");")) return { ...item, kind: "member", name: parseMemberName(text) };
  return { ...item, name: stripped.slice(0, 40) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function skipInterItemGap(chunk: string, start: number): number {
  let i = start;
  while (i < chunk.length) {
    let end = i;
    while (end < chunk.length && chunk[end] !== "\r" && chunk[end] !== "\n") end += 1;
    if (chunk.slice(i, end).trim()) break;
    i = end;
    if (chunk[i] === "\r" && chunk[i + 1] === "\n") i += 2;
    else if (chunk[i] === "\r" || chunk[i] === "\n") i += 1;
  }
  return i;
}

function stripOrphanGroupMarkers(text: string): string {
  return splitLinesKeepEnds(text).filter((line) => !DOXYGEN_GROUP_OPEN_RE.test(line) && !DOXYGEN_GROUP_CLOSE_RE.test(line)).join("");
}

function splitDeclarationRun(input: string, className: string): DeclItem[] {
  const chunk = stripOrphanGroupMarkers(input);
  if (!chunk.trim()) return [];
  const items: DeclItem[] = [];
  let i = 0;
  while (i < chunk.length) {
    i = skipInterItemGap(chunk, i);
    if (i >= chunk.length) break;
    const itemStart = i;

    const firstLineEnd = chunk.indexOf("\n", i) < 0 ? chunk.length : chunk.indexOf("\n", i) + 1;
    const firstLine = chunk.slice(i, firstLineEnd);
    if ((firstLine.trimStart().startsWith("#") || isClassBodyMacro(firstLine.trim())) && !firstLine.includes(";")) {
      const classified = classifyDeclaration(firstLine, className);
      items.push(classified);
      i = firstLineEnd;
      continue;
    }

    let brace = 0;
    let paren = 0;
    let hadBody = false;
    let lineComment = false;
    let blockComment = false;
    let quote: string | null = null;
    while (i < chunk.length) {
      const ch = chunk[i];
      const next = chunk[i + 1];
      if (lineComment) {
        if (ch === "\r" || ch === "\n") lineComment = false;
        i += 1;
        continue;
      }
      if (blockComment) {
        if (ch === "*" && next === "/") {
          blockComment = false;
          i += 2;
        } else i += 1;
        continue;
      }
      if (quote) {
        if (ch === "\\") i += 2;
        else {
          if (ch === quote) quote = null;
          i += 1;
        }
        continue;
      }
      if (ch === "/" && next === "/") {
        lineComment = true;
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        blockComment = true;
        i += 2;
        continue;
      }
      if (ch === "\"" || ch === "'") {
        quote = ch;
        i += 1;
        continue;
      }
      if (ch === "(") paren += 1;
      else if (ch === ")") paren = Math.max(0, paren - 1);
      else if (ch === "{" && paren === 0) {
        brace += 1;
        if (brace === 1) hadBody = true;
      } else if (ch === "}" && paren === 0) {
        brace -= 1;
        if (brace === 0 && hadBody) {
          let j = i + 1;
          while (j < chunk.length && /\s/.test(chunk[j])) j += 1;
          if (chunk[j] === ";") hadBody = false;
          else {
            i += 1;
            break;
          }
        }
      } else if (ch === ";" && brace === 0 && paren === 0) {
        i += 1;
        while (i < chunk.length && chunk[i] !== "\r" && chunk[i] !== "\n") i += 1;
        break;
      }
      i += 1;
    }

    const raw = chunk.slice(itemStart, i);
    if (!raw.trim()) continue;
    const nextStart = skipInterItemGap(chunk, i);
    const trailingGap = /\r?\n\s*\r?\n/.test(chunk.slice(i, nextStart));
    items.push({ ...classifyDeclaration(raw, className), trailingGap });
    i = nextStart;
  }
  return items;
}

function splitByDoxygenGroups(chunk: string): string[] {
  const lines = splitLinesKeepEnds(chunk);
  const segments: string[] = [];
  let buffer: string[] = [];
  let pendingName: string[] = [];
  let inGroup = false;
  const flush = () => {
    if (buffer.length) segments.push(buffer.join(""));
    buffer = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trim();
    if (!inGroup && stripped.startsWith("/**")) {
      pendingName = [line];
      i += 1;
      while (i < lines.length) {
        if (DOXYGEN_GROUP_OPEN_RE.test(lines[i])) {
          flush();
          inGroup = true;
          buffer = [...pendingName, lines[i]];
          pendingName = [];
          i += 1;
          break;
        }
        const current = lines[i].trim();
        if (current && !current.startsWith("*") && !current.startsWith("/**")) {
          buffer.push(...pendingName);
          pendingName = [];
          break;
        }
        pendingName.push(lines[i]);
        i += 1;
      }
      continue;
    }
    if (DOXYGEN_GROUP_OPEN_RE.test(line)) {
      flush();
      inGroup = true;
      buffer = [line];
      i += 1;
      continue;
    }
    if (inGroup && DOXYGEN_GROUP_CLOSE_RE.test(line)) {
      buffer.push(line);
      flush();
      inGroup = false;
      i += 1;
      continue;
    }
    if (pendingName.length) {
      buffer.push(...pendingName);
      pendingName = [];
    }
    buffer.push(line);
    i += 1;
  }
  if (pendingName.length) buffer.push(...pendingName);
  flush();
  return segments;
}

function splitDoxygenAndDeclarations(chunk: string, className: string): DeclItem[] {
  return splitByDoxygenGroups(chunk).flatMap((part) => {
    if (isDoxygenGroupBlock(part)) return [{ ...classifyDeclaration(part, className), trailingGap: false }];
    return splitDeclarationRun(part, className);
  });
}

function compareNames(a: DeclItem, b: DeclItem): number {
  return (a.name || a.text).localeCompare(b.name || b.text, "en", { sensitivity: "base" });
}

function specialRank(className: string, item: DeclItem): number {
  const flat = stripComments(item.text).replace(/\s+/g, " ");
  if (item.name === `~${className}`) return 2;
  if (item.name.startsWith("operator")) {
    if (item.name === "operator=") return /operator\s*=\s*\([^)]*&&/.test(flat) ? 6 : 5;
    return 7;
  }
  if (item.name === className) {
    const escaped = escapeRegExp(className);
    if (new RegExp(`\\b${escaped}\\s*\\(\\s*const\\s+${escaped}\\s*&`).test(flat)) return 3;
    if (new RegExp(`\\b${escaped}\\s*\\(\\s*${escaped}\\s*&&`).test(flat)) return 4;
    if (new RegExp(`\\b${escaped}\\s*\\(\\s*\\)`).test(flat)) return 0;
    return 1;
  }
  return 99;
}

function sortableRank(item: DeclItem): number {
  return item.kind === "group" || item.kind === "method" || item.kind === "other" || item.kind === "macro" ? 0 : 99;
}

function sortPool(items: DeclItem[], className: string): DeclItem[] {
  const specials = items.filter((item) => item.kind === "special");
  const rest = items.filter((item) => item.kind !== "special");
  specials.sort((a, b) => specialRank(className, a) - specialRank(className, b) || compareNames(a, b));
  rest.sort((a, b) => sortableRank(a) - sortableRank(b) || compareNames(a, b));
  return [...specials, ...rest];
}

function joinItems(items: DeclItem[]): string {
  return items.map((item, index) => emitItem(item, index < items.length - 1 && item.trailingGap)).join("");
}

function splitNonLockedChunk(chunk: string, className: string, mode: KevinSystemCodeMode): DeclItem[] {
  if (!chunk.trim()) return [];
  if (mode === "off") return splitDoxygenAndDeclarations(chunk, className);
  const items: DeclItem[] = [];
  const lines = splitLinesKeepEnds(chunk);
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length) items.push(...splitDoxygenAndDeclarations(buffer.join(""), className));
    buffer = [];
  };

  let i = 0;
  while (i < lines.length) {
    if (!KEVIN_SYSTEM_CODE_START_RE.test(lines[i])) {
      buffer.push(lines[i]);
      i += 1;
      continue;
    }
    flush();
    const startLine = lines[i];
    const inner: string[] = [];
    i += 1;
    let endLine = "";
    while (i < lines.length) {
      if (KEVIN_SYSTEM_CODE_END_RE.test(lines[i])) {
        endLine = lines[i];
        i += 1;
        break;
      }
      inner.push(lines[i]);
      i += 1;
    }
    if (!endLine) {
      buffer.push(startLine, ...inner);
      continue;
    }
    const sorted = sortPool(splitDeclarationRun(inner.join(""), className), className);
    let innerText = joinItems(sorted);
    if (innerText && !innerText.endsWith("\n")) innerText += "\n";
    items.push({
      text: mode === "keep_markers" ? `${startLine}${innerText}${endLine}` : innerText,
      name: "kevin_system_code",
      kind: "system_code",
      trailingGap: false,
    });
  }
  flush();
  return items;
}

function splitDeclarations(chunk: string, className: string, mode: KevinSystemCodeMode): DeclItem[] {
  const items: DeclItem[] = [];
  const parts = splitByLockedRegions(chunk);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.locked) {
      if (part.text.trim()) {
        items.push({
          text: part.text,
          name: "locked",
          kind: "locked",
          trailingGap: i + 1 < parts.length && /^[ \t]*\r?\n/.test(parts[i + 1].text),
        });
      }
      continue;
    }
    let text = part.text;
    if (items.at(-1)?.kind === "locked" && /^[ \t]*\r?\n/.test(text)) text = text.replace(/^[ \t]*\r?\n/, "");
    items.push(...splitNonLockedChunk(text, className, mode));
  }
  return items;
}

function splitClassSections(body: string, className: string, mode: KevinSystemCodeMode): { preamble: string; sections: AccessSection[] } {
  const regex = new RegExp(ACCESS_RE.source, ACCESS_RE.flags);
  const matches = [...body.matchAll(regex)];
  if (!matches.length) return { preamble: body, sections: [] };
  const sections = matches.map((match, index) => {
    const start = match.index! + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index! : body.length;
    const rawChunk = body.slice(start, end);
    const trailingGap = /(?:\n[ \t]*){2,}$/.test(rawChunk);
    const chunk = trailingGap ? rawChunk.replace(/(?:\n[ \t]*){2,}$/, "\n") : rawChunk;
    return {
      label: normalizeAccessLabel(match[2]),
      indent: match[1],
      labelText: match[0].trimEnd(),
      items: splitDeclarations(chunk, className, mode),
      trailingGap,
    };
  });
  return { preamble: body.slice(0, matches[0].index), sections };
}

function sectionKind(label: string): "signals" | "slots" | "public" | "private" | "protected" | "other" {
  const normalized = label.toLowerCase().replace(/:$/, "");
  if (normalized === "signals") return "signals";
  if (normalized.includes("slots")) return "slots";
  if (normalized.startsWith("public")) return "public";
  if (normalized.startsWith("private")) return "private";
  if (normalized.startsWith("protected")) return "protected";
  return "other";
}

function isMemberOnly(section: AccessSection, className: string): boolean {
  return section.items.length > 0 && section.items.every((item) => classifyDeclaration(item.text, className).kind === "member");
}

function hasNumberedDoxygenSequence(section: AccessSection): boolean {
  return section.items.filter((item) => NUMBERED_DOXY_ITEM_RE.test(item.text)).length >= 2;
}

function collectWarnings(sections: AccessSection[], className: string): string[] {
  const warnings: string[] = [];
  for (const section of sections) {
    if (hasNumberedDoxygenSequence(section)) {
      warnings.push(`${className}: ${section.label} contains numbered Doxygen declarations; source order was preserved`);
      continue;
    }
    const nested = section.items.filter((item) => item.kind === "nested");
    if (nested.length) {
      warnings.push(`${className}: ${section.label} contains nested declarations (${nested.slice(0, 3).map((item) => item.name).join(", ")}); source order was preserved`);
      continue;
    }
    for (const group of section.items.filter((item) => item.kind === "group")) {
      warnings.push(`${className}: ${section.label} contains a Doxygen group near ${group.name || "group"}`);
    }
  }
  return warnings;
}

function declarationItemsFromChunk(chunk: string, className: string): DeclItem[] {
  const cleaned = splitLinesKeepEnds(chunk)
    .filter((line) => !KEVIN_SYSTEM_CODE_START_RE.test(line) && !KEVIN_SYSTEM_CODE_END_RE.test(line))
    .join("");
  return cleaned.trim() ? splitDoxygenAndDeclarations(cleaned, className) : [];
}

function isStaticMethod(item: DeclItem, className: string): boolean {
  const classified = classifyDeclaration(item.text, className);
  return classified.kind === "method" && /\bstatic\b/.test(stripComments(item.text));
}

function normalizeSystemCodeSections(sections: AccessSection[], className: string): void {
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    if (!section.labelText.includes("KEVIN_SYSTEM_CODE")) continue;
    const fixed: DeclItem[] = [];
    const pool: DeclItem[] = [];
    for (const item of section.items) {
      if (item.kind === "locked") fixed.push(item);
      else {
        const expanded = declarationItemsFromChunk(item.text, className);
        if (item.trailingGap && expanded.length) expanded[expanded.length - 1].trailingGap = true;
        pool.push(...expanded);
      }
    }

    const next = sections[i + 1];
    if (next && /\bfunctions\b/i.test(next.labelText)) {
      const keep: DeclItem[] = [];
      for (const item of next.items) {
        if (item.kind === "locked") {
          keep.push(item);
          continue;
        }
        const classified = classifyDeclaration(item.text, className);
        const preserved = { ...classified, trailingGap: item.trailingGap };
        if (KEVIN_SYSTEM_CODE_NOTE_RE.test(item.text) || isStaticMethod(preserved, className)) pool.push(preserved);
        else keep.push(preserved);
      }
      next.items = keep;
      if (!keep.length) sections.splice(i + 1, 1);
    }

    section.items = fixed;
    if (pool.length) {
      section.items.push({ text: joinItems(sortPool(pool, className)), name: "kevin_system_code", kind: "system_code", trailingGap: false });
    }
  }
}

function sortSection(section: AccessSection, className: string, sortMembers: boolean): void {
  section.items = section.items.map((item) => item.kind === "locked" || item.kind === "system_code" ? item : { ...classifyDeclaration(item.text, className), trailingGap: item.trailingGap });
  if (isMemberOnly(section, className) || hasNumberedDoxygenSequence(section) || section.items.some((item) => item.kind === "nested")) return;

  const kind = sectionKind(section.label);
  const fixedKinds = new Set<DeclKind>(["member", "nested", "locked", "system_code"]);
  if (kind === "signals" || kind === "slots") {
    const movable = section.items.filter((item) => !fixedKinds.has(item.kind)).sort(compareNames);
    let cursor = 0;
    section.items = section.items.map((item) => fixedKinds.has(item.kind) ? item : movable[cursor++]);
    return;
  }
  if (kind === "public" || kind === "private" || kind === "protected") {
    const movable = sortPool(section.items.filter((item) => !fixedKinds.has(item.kind)), className);
    const fixed = section.items.filter((item) => fixedKinds.has(item.kind));
    const sortedMembers = sortMembers ? fixed.filter((item) => item.kind === "member").sort(compareNames) : [];
    let movableCursor = 0;
    let memberCursor = 0;
    section.items = section.items.map((item) => {
      if (!fixedKinds.has(item.kind)) return movable[movableCursor++];
      if (sortMembers && item.kind === "member") return sortedMembers[memberCursor++];
      return item;
    });
    return;
  }
  section.items.sort(compareNames);
}

function startsWithDoxygen(text: string): boolean {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim().startsWith("/**") || false;
}

function emitItem(item: DeclItem, trailingGap = item.trailingGap): string {
  let out: string;
  if (item.kind === "locked") out = item.text.endsWith("\n") ? item.text : `${item.text}\n`;
  else out = `${item.text.replace(/[\r\n \t]+$/g, "")}\n`;
  return trailingGap && !out.endsWith("\n\n") ? `${out}\n` : out;
}

function rebuildClassBody(preamble: string, sections: AccessSection[], className: string, sortMembers: boolean): string {
  const ordinary: AccessSection[] = [];
  const signals: AccessSection[] = [];
  const slots: AccessSection[] = [];
  const privateMembers: AccessSection[] = [];
  for (const section of sections) {
    sortSection(section, className, sortMembers);
    const kind = sectionKind(section.label);
    if (kind === "signals") signals.push(section);
    else if (kind === "slots") slots.push(section);
    else if (kind === "private" && isMemberOnly(section, className)) privateMembers.push(section);
    else ordinary.push(section);
  }

  let out = preamble;
  for (const section of [...ordinary, ...signals, ...slots, ...privateMembers]) {
    out += `${section.labelText || `${section.indent}${section.label}`}\n`;
    for (let i = 0; i < section.items.length; i += 1) {
      const item = section.items[i];
      let trailing = item.trailingGap;
      const next = section.items[i + 1];
      if (!hasNumberedDoxygenSequence(section) && !section.items.some((entry) => entry.kind === "nested")) {
        if (item.kind === "member" && startsWithDoxygen(item.text)) trailing = true;
        else if (next && startsWithDoxygen(next.text)) trailing = true;
      }
      out += emitItem(item, trailing);
    }
    if (section.trailingGap && !out.endsWith("\n\n")) out += "\n";
  }
  return out;
}

function isCodePosition(text: string, target: number): boolean {
  let lineComment = false;
  let blockComment = false;
  let quote: string | null = null;
  for (let i = 0; i < target; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
    } else if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
    } else if (ch === "\"" || ch === "'") quote = ch;
  }
  return !lineComment && !blockComment && !quote;
}

function findClosingBrace(text: string, open: number): number {
  let depth = 0;
  let lineComment = false;
  let blockComment = false;
  let quote: string | null = null;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

function reorderNormalizedHeader(text: string, options: Required<HeaderReorderOptions>): { text: string; warnings: string[] } {
  let output = text;
  let searchFrom = 0;
  const warnings: string[] = [];
  while (searchFrom < output.length) {
    const regex = new RegExp(CLASS_RE.source, CLASS_RE.flags);
    regex.lastIndex = searchFrom;
    const match = regex.exec(output);
    if (!match) break;
    if (!isCodePosition(output, match.index)) {
      searchFrom = match.index + match[0].length;
      continue;
    }
    const open = match.index + match[0].lastIndexOf("{");
    const close = findClosingBrace(output, open);
    if (close < 0) break;
    const className = match[1].trim().split(/\s+/).at(-1)!;
    const body = output.slice(open + 1, close);
    const parsed = splitClassSections(body, className, options.kevinSystemCodeMode);
    if (!parsed.sections.length) {
      searchFrom = close + 1;
      continue;
    }
    if (options.kevinSystemCodeMode === "merge_strip") normalizeSystemCodeSections(parsed.sections, className);
    warnings.push(...collectWarnings(parsed.sections, className));
    const nextBody = rebuildClassBody(parsed.preamble, parsed.sections, className, options.sortMembers);
    output = `${output.slice(0, open + 1)}${nextBody}${output.slice(close)}`;
    searchFrom = open + 1 + nextBody.length + 1;
  }
  return { text: output, warnings: [...new Set(warnings)] };
}

export function reorderHeaderText(text: string, options: HeaderReorderOptions = {}): HeaderReorderResult {
  const eol = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
  const normalized = text.replace(/\r\n|\r/g, "\n");
  const result = reorderNormalizedHeader(normalized, {
    sortMembers: Boolean(options.sortMembers),
    kevinSystemCodeMode: normalizeMode(options.kevinSystemCodeMode),
  });
  const output = eol === "\n" ? result.text : result.text.replace(/\n/g, eol);
  return { text: output, changed: output !== text, warnings: result.warnings };
}
