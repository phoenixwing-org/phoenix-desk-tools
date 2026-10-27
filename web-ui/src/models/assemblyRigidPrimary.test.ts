import { expect, it } from "vitest";
import type { BomPreview } from "../api";
import { assemblyRigidPrimary } from "./assemblyRigidPrimary";

const assy = { document_kinds: { assembly: true } } as BomPreview;
it("shows each saved instance independently and never substitutes true for unknown", () => {
  const sections = assemblyRigidPrimary({ ...assy, assembly_links: [true, false, null].map((rigid, i) => ({ object_name: `Sub${i}`, label: `Stage ${i}`, target_file: "Child.FCStd", target_object_name: "Assembly", rigid })) });
  expect(sections).toHaveLength(1);
  expect(sections[0].controls?.map(control => control.kind === "readonly" && control.value)).toEqual(["是 · 刚性", "否 · 柔性", "未知"]);
  expect(sections[0].controls?.map(control => control.id)).toEqual(["rigid-Sub0", "rigid-Sub1", "rigid-Sub2"]);
  expect(sections[0].actions).toBeUndefined();
  expect(sections[0].description).toContain("不切换刚柔性");
});
it("handles an ASSY without subassembly instances without calling the whole file rigid", () => {
  expect(assemblyRigidPrimary(assy)[0].description).toContain("不是整个 ASSY");
  expect(assemblyRigidPrimary(assy)[0].controls).toEqual([]);
});
it("does not show this block on normal parts, standalone drawings or an unloaded page", () => {
  expect(assemblyRigidPrimary(null)).toEqual([]);
  expect(assemblyRigidPrimary({ ...assy, document_kinds: null })).toEqual([]);
  expect(assemblyRigidPrimary({ ...assy, bom_readonly: true })).toEqual([]);
});
it("separately exposes disconnected joint ends without providing a destructive repair action", () => {
  const issue = { object_name: "Joint", label: "Pivot", reference: "Reference2" as const, reason: "empty_reference" as const, target_object_name: null };
  const sections = assemblyRigidPrimary({ ...assy, assembly_joint_issues: [issue] });
  expect(sections[1]).toMatchObject({ id: "assembly-joint-issues", controls: [expect.objectContaining({ value: "连接端为空，需人工确认" })] });
  expect(sections[1].description).toContain("不代表已验证外部引用");
  expect(sections[1].actions).toBeUndefined();
});
