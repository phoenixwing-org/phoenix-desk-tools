import { expect, it } from "vitest";
import { resolveTaskRules } from "./rules.js";
function resolve(pairs: Array<[string,string]>) { return resolveTaskRules({ name: "synthetic", roots: [], filenames: true, contents: true, include_stem: true, mappings: pairs.map(([old,target]) => ({ old,target,enabled:true })) }); }
it("does not re-expand imported stems over an explicit mapping", () => {
  const result = resolve([["Widget.Drawing", "Part.Drawing"], ["Widget.FCStd", "Part.ASSY.FCStd"], ["Widget", "Part.ASSY"]]);
  expect(result.conflicts).toEqual([]);
  expect(result.rules.filter(rule => rule.search === "Widget")).toEqual([expect.objectContaining({ replace: "Part.ASSY" })]);
});
it("keeps real derived ambiguities blocked and identifies both rows and targets", () => {
  const result = resolve([["Widget.pdf", "Drawing.pdf"], ["Widget.md", "Guide.md"]]);
  expect(result.rules).toEqual([]); expect(result.excluded_rules?.[0]?.reason).toContain("第 1 行（去扩展名）"); expect(result.excluded_rules?.[0]?.reason).toContain("第 2 行（去扩展名）");
  expect(result.excluded_rules?.[0]?.reason).toContain("Drawing"); expect(result.excluded_rules?.[0]?.reason).toContain("Guide");
});
it("does not hide conflicting explicit rules", () => {
  const result = resolve([["Widget", "Part"], ["Widget", "Other"]]);
  expect(result.excluded_rules?.[0]?.reason).toContain("目标冲突"); expect(result.rules).toEqual([]);
});

it("continues unrelated rules and protects ambiguous tokens", async () => {
  const { pnwCodeReplaceStringByRules } = await import("@phoenix-wing/code-core");
  const result = resolve([["Widget", "Part"], ["Widget", "Other"], ["Widget.pdf", "Drawing.pdf"], ["Note", "Guide"], ["Wid", "Small"]]);
  expect(result.conflicts).toEqual([]); expect(result.excluded_rules?.map(rule => rule.row)).toEqual([1,2]);
  expect(pnwCodeReplaceStringByRules("Widget Note Wid", result.rules).output).toBe("Widget Guide Small");
});

it("does not strip numeric part identifiers or semantic CAD name suffixes", () => {
  const result = resolve([["123.001-Old", "123.001-New"], ["123.002-Old", "123.002-New"], ["Widget.Drawing", "Part.Drawing"]]);
  expect(result.excluded_rules).toEqual([]);
  expect(result.rules.some(rule => rule.search === "123" || rule.search === "Widget")).toBe(false);
});
