import crypto from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(new URL("../../scripts/verify-windows-release.ps1", import.meta.url), "utf8");
const boundary = "$RepoRoot =";
const gateCode = "WINDOWS_ISOLATION_UNSUPPORTED";
const gateLine = source.split("\n").find(line => line.startsWith(`throw "${gateCode}:`))!;

type Token = { kind: "word" | "string" | "symbol" | "newline"; value: string };
type Node =
  | { kind: "binding" | "parameters" | "command" | "assignment"; tokens: Token[] }
  | { kind: "if"; condition: Token[]; children: Node[] }
  | { kind: "throw"; literal: string };

// This deliberately restricted prefix AST is not a PowerShell parser/runtime.
// It accepts only the safe prelude below; all other syntax fails the contract.
// In particular, text inside comments/strings and conditional/function bodies
// cannot masquerade as an unconditional top-level throw. No script is executed.
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (let offset = 0; offset < text.length;) {
    const c = text[offset];
    if (c === "\n") { tokens.push({ kind: "newline", value: c }); offset++; continue; }
    if (/\s/u.test(c)) { offset++; continue; }
    if (text.startsWith("<#", offset)) {
      const end = text.indexOf("#>", offset + 2);
      if (end < 0) throw new Error("unterminated block comment");
      offset = end + 2; continue;
    }
    if (c === "#") {
      const end = text.indexOf("\n", offset);
      offset = end < 0 ? text.length : end; continue;
    }
    if (c === '"' || c === "'") {
      const quote = c; let value = ""; let closed = false; offset++;
      while (offset < text.length) {
        const next = text[offset++];
        // Only plain literal strings belong to this safe prefix grammar.
        if (next === "`" || (quote === '"' && next === "$")) throw new Error("nonliteral string");
        if (next === quote) { closed = true; break; }
        value += next;
      }
      if (!closed) throw new Error("unterminated string");
      tokens.push({ kind: "string", value }); continue;
    }
    const word = /^(?:\$[A-Za-z_][A-Za-z0-9_:]*|[A-Za-z_][A-Za-z0-9_:-]*|-[A-Za-z_][A-Za-z0-9_-]*)/u.exec(text.slice(offset));
    if (word) { tokens.push({ kind: "word", value: word[0] }); offset += word[0].length; continue; }
    if ("[](){},=".includes(c)) { tokens.push({ kind: "symbol", value: c }); offset++; continue; }
    throw new Error("unsupported prefix syntax");
  }
  return tokens;
}

function prefixAst(text: string): Node[] {
  const start = text.indexOf(boundary);
  if (start < 0) throw new Error("missing carry boundary");
  const tokens = tokenize(text.slice(0, start)); let cursor = 0;
  function consume(value: string) {
    if (tokens[cursor]?.value !== value) throw new Error(`expected ${value}`);
    return tokens[cursor++];
  }
  function skipLines() { while (tokens[cursor]?.kind === "newline") cursor++; }
  function balanced(open: string, close: string): Token[] {
    const result: Token[] = []; consume(open); let depth = 1;
    while (cursor < tokens.length) {
      const token = tokens[cursor++];
      if (token.value === open) depth++;
      if (token.value === close) { depth--; if (depth === 0) return result; }
      result.push(token);
    }
    throw new Error("unclosed prefix declaration");
  }
  function line(): Token[] {
    const result: Token[] = [];
    while (cursor < tokens.length && tokens[cursor].kind !== "newline" && tokens[cursor].value !== "}") {
      if (["{", "}"].includes(tokens[cursor].value)) throw new Error("unsupported control flow");
      result.push(tokens[cursor++]);
    }
    return result;
  }
  function statements(block = false): Node[] {
    const result: Node[] = []; skipLines();
    while (cursor < tokens.length && tokens[cursor].value !== "}") {
      const token = tokens[cursor];
      if (token.value === "[") result.push({ kind: "binding", tokens: balanced("[", "]") });
      else if (token.value === "param") { cursor++; result.push({ kind: "parameters", tokens: balanced("(", ")") }); }
      else if (token.value === "if") {
        cursor++; const condition = balanced("(", ")"); skipLines(); consume("{");
        const children = statements(true); consume("}"); result.push({ kind: "if", condition, children });
      } else if (token.value === "throw") {
        cursor++; const expression = line();
        if (expression.length !== 1 || expression[0].kind !== "string") throw new Error("throw is not a literal");
        result.push({ kind: "throw", literal: expression[0].value });
      } else {
        result.push({ kind: token.value.startsWith("$") ? "assignment" : "command", tokens: line() });
      }
      skipLines();
    }
    if (!block && cursor !== tokens.length) throw new Error("unexpected prefix block");
    return result;
  }
  return statements();
}

function values(tokens: Token[]) { return tokens.filter(token => token.kind !== "newline").map(token => token.value); }
function requireGate(text: string): Node[] {
  const tree = prefixAst(text);
  if (tree.length !== 6) throw new Error("unexpected prefix statements");
  const [binding, parameters, strict, preference, os, gate] = tree;
  const requireTokens = (node: Node, kind: Node["kind"], expected: string[]) => {
    if (node.kind !== kind || !("tokens" in node) || JSON.stringify(values(node.tokens)) !== JSON.stringify(expected)) {
      throw new Error("unsafe prelude");
    }
  };
  requireTokens(binding, "binding", ["CmdletBinding", "(", ")"]);
  requireTokens(parameters, "parameters", ["[", "switch", "]", "$SkipBuild", ",", "[", "string", "]", "$ReceiptPath", "=", ""]);
  requireTokens(strict, "command", ["Set-StrictMode", "-Version", "Latest"]);
  requireTokens(preference, "assignment", ["$ErrorActionPreference", "=", "Stop"]);
  if (os.kind !== "if" || JSON.stringify(values(os.condition)) !== JSON.stringify(["$env:OS", "-ne", "Windows_NT"]) ||
      os.children.length !== 1 || os.children[0].kind !== "throw" || os.children[0].literal !== "The Windows release gate must run on Windows") {
    throw new Error("unsafe platform prelude");
  }
  if (gate.kind !== "throw" || !gate.literal.startsWith(`${gateCode}:`) ||
      !gate.literal.includes("file-ID and ACL ownership checks are not implemented") ||
      !gate.literal.includes("Build/install/uninstall and passed receipts are disabled")) {
    throw new Error("missing unconditional unsupported gate");
  }
  return tree;
}

describe("Windows release unsupported profile static prefix contract (not native validation)", () => {
  it("has an unconditional root throw after the safe platform prelude", () => {
    const tree = requireGate(source);
    expect(tree[5].kind).toBe("throw");
    expect(tree[4].kind).toBe("if");
  });
  it("stops before filesystem reads, builds, installs, cleanup, and any passed receipt", () => {
    requireGate(source);
    const stop = source.indexOf(gateLine), carry = source.indexOf(boundary);
    expect(stop).toBeGreaterThan(0); expect(stop).toBeLessThan(carry);
    for (const operation of ["Get-Content", "New-Item", 'Invoke-Checked "cargo"', "Start-Process", "[IO.File]::WriteAllText", "gate passed", "Remove-Item"]) {
      expect(source.indexOf(operation)).toBeGreaterThan(carry);
    }
    // schema 2 carry (and any future schema 3 carry) cannot execute past throw.
    expect(source.indexOf("schemaVersion = 2")).toBeGreaterThan(carry);
    expect(source.indexOf("try {")).toBeGreaterThan(carry);
  });
  it("preserves the original parameters without an enable/install/receipt bypass", () => {
    const tree = requireGate(source);
    expect(tree[1].kind).toBe("parameters");
    expect(gateLine).not.toMatch(/\$SkipBuild|\$ReceiptPath|\$env:/u);
  });
  it("preserves all later installer carry bytes unchanged", () => {
    const carry = source.slice(source.indexOf(boundary));
    expect(crypto.createHash("sha256").update(carry).digest("hex")).toBe("b9250edebd6db7215a3442504e381f981662e68645f60bb4fa8ea001eef777a9");
  });
  it("ignores harmless comments instead of treating their text as commands", () => {
    expect(() => requireGate(source.replace(gateLine, `<# Start-Process; schemaVersion = 3; throw \"fake\" #>\n${gateLine}`))).not.toThrow();
  });
  it.each([
    { label: "comment-only throw", replacement: `# ${gateLine}` },
    { label: "block-comment throw", replacement: `<# ${gateLine} #>` },
    { label: "literal-string throw", replacement: `$Message = '${gateLine}'` },
    { label: "SkipBuild conditional throw", replacement: `if ($SkipBuild) {\n${gateLine}\n}` },
    { label: "function-only throw", replacement: `function UnsupportedProfile {\n${gateLine}\n}` },
    { label: "catchable throw", replacement: `try {\n${gateLine}\n} catch { }` },
    { label: "dynamic error text", replacement: "throw $Message" },
    { label: "early installer invocation", replacement: `Start-Process \"synthetic.exe\"\n${gateLine}` },
    { label: "environment bypass statement", replacement: `if ($env:ENABLE_WINDOWS_GATE) { return }\n${gateLine}` },
    { label: "return before throw", replacement: `return\n${gateLine}` },
  ])("rejects $label instead of accepting a textual marker", ({ replacement }) => {
    expect(() => requireGate(source.replace(gateLine, replacement))).toThrow();
  });
});
