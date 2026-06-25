import { describe, it, expect } from "vitest";
import { parseVitestList, parseVitestResult, type VitestModule } from "./unit-tests.js";

const SAMPLE_LIST = `web-ui/src/utils/caaDialogTree.test.ts > removeChildNode > 正常移除
web-ui/src/utils/caaDialogTree.test.ts > removeChildNode > ID 不存在 → removed=null
web-ui/src/utils/caaDialogTree.test.ts > removeChildNode > 不修改原数组
web-ui/src/utils/caaDialogTree.test.ts > collectDescendantIds > 叶子 → []
web-ui/src/utils/caaDropZone.test.ts > resolveDropEdge > 空 cell → inside
web-ui/src/utils/caaDropZone.test.ts > resolveDropEdge > occupied cell left edge
`;

const SAMPLE_VERBOSE = `✓ removeChildNode > 正常移除
✓ removeChildNode > ID 不存在
✗ resolveDropEdge > 空 cell
✓ collectDescendantIds > 叶子
`;

describe("parseVitestList", () => {
  it("空字符串 → 空数组", () => {
    expect(parseVitestList("")).toEqual([]);
  });

  it("解析标准 vitest list 输出", () => {
    const result = parseVitestList(SAMPLE_LIST);
    expect(result).toHaveLength(2); // 两个文件
    expect(result[0].file).toContain("caaDialogTree.test.ts");
    expect(result[0].count).toBe(4);
    expect(result[0].tests).toHaveLength(4);
    expect(result[1].file).toContain("caaDropZone.test.ts");
    expect(result[1].count).toBe(2);
  });

  it("同一文件连续行合并为一个 module", () => {
    const out = `a.test.ts > suite1 > test1\na.test.ts > suite1 > test2\nb.test.ts > test3`;
    const result = parseVitestList(out);
    expect(result).toHaveLength(2);
    expect(result[0].count).toBe(2);
    expect(result[1].count).toBe(1);
  });

  it("相同文件不连续时分开", () => {
    const out = `a.test.ts > test1\nb.test.ts > test2\na.test.ts > test3`;
    const result = parseVitestList(out);
    expect(result).toHaveLength(3); // a, b, a
  });

  it("忽略不匹配的行（空行/噪音）", () => {
    const out = "some noise\na.test.ts > test1\n\nanother line\nb.test.ts > test2";
    const result = parseVitestList(out);
    expect(result).toHaveLength(2);
  });
});

describe("parseVitestResult", () => {
  it("全通过", () => {
    const out = "✓ test1\n✓ test2\n✓ test3";
    expect(parseVitestResult(out)).toEqual({ passed: 3, failed: 0 });
  });

  it("有失败", () => {
    expect(parseVitestResult(SAMPLE_VERBOSE)).toEqual({ passed: 3, failed: 1 });
  });

  it("空输出", () => {
    expect(parseVitestResult("")).toEqual({ passed: 0, failed: 0 });
  });
});
