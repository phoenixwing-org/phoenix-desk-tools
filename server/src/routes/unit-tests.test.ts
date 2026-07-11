import { describe, expect, it } from "vitest";
import { parseVitestList, parseVitestResult } from "./unit-tests.js";

const SAMPLE_LIST = `src/a.test.ts > suite a > first case
src/a.test.ts > suite a > second case
src/b.test.ts > suite b > third case
src/a.test.ts > suite a > fourth case
`;

const SAMPLE_JSON = JSON.stringify({
  numPassedTests: 2,
  numFailedTests: 1,
  testResults: [],
});

describe("parseVitestList", () => {
  it("returns an empty list for empty output", () => {
    expect(parseVitestList("")).toEqual([]);
  });

  it("groups vitest list output by test file", () => {
    const result = parseVitestList(SAMPLE_LIST);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ file: "src/a.test.ts", count: 3 });
    expect(result[0].tests).toEqual(["suite a > first case", "suite a > second case", "suite a > fourth case"]);
    expect(result[1]).toMatchObject({ file: "src/b.test.ts", count: 1 });
  });

  it("ignores non-matching noise", () => {
    const result = parseVitestList("noise\nsrc/a.test.ts > test 1\n\nanother line");
    expect(result).toEqual([{ file: "src/a.test.ts", count: 1, tests: ["test 1"] }]);
  });
});

describe("parseVitestResult", () => {
  it("reads JSON reporter counts", () => {
    expect(parseVitestResult(SAMPLE_JSON)).toEqual({ passed: 2, failed: 1 });
  });

  it("falls back to common textual markers", () => {
    expect(parseVitestResult("✓ case 1\n✓ case 2\n× case 3\n")).toEqual({ passed: 2, failed: 1 });
  });
});
