import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./pdtCodeService.ts", import.meta.url), "utf8");

describe("Desk code rename shared core boundary", () => {
  it("delegates literal matching, replacement counts and line projection to Wing", () => {
    expect(source).toContain("pnwCodeResolveReplacementRules");
    expect(source).toContain("pnwCodeReplaceTextByRules(text, replacementRules)");
    expect(source).toContain("pnwCodeReplaceTextByRules(payload.text, replacementRules).output");
    expect(source).not.toContain("function replaceAllLiteral");
    expect(source).not.toContain("function countOccurrences");
    expect(source).not.toContain("function hitLines");
  });
});
