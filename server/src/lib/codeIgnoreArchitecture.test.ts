import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ignoreService = readFileSync(new URL("./codeIgnoreService.ts", import.meta.url), "utf8");

describe("Desk Ignore shared-core boundary", () => {
  it("delegates matching and normalization to Wing while retaining Host storage", () => {
    expect(ignoreService).toContain('from "@phoenix-wing/code-core"');
    expect(ignoreService).toContain("pnwCodeNormalizeIgnorePatterns(patterns");
    expect(ignoreService).toContain("pnwCodeIsIgnoredName(name, patterns");
    expect(ignoreService).toContain('const IGNORE_FILENAME = "code.ignore"');
    expect(ignoreService).not.toContain("function wildcardMatch(");
  });
});
