import { describe, expect, it } from "vitest";
import { handoffDraft, quickRenameDraft } from "./handoff";
describe("rename handoff", () => {
  it("rejects another workspace and unsupported versions", () => {
    const value = { version: 1 as const, workspace: "/sample", source: "test", draft: quickRenameDraft("A", "B", "/sample") };
    expect(() => handoffDraft(value, "/other")).toThrow("工作空间");
    expect(() => handoffDraft({ ...value, version: 2 as 1 }, "/sample")).toThrow();
  });
  it("copies configuration only without plan, file selection or shared arrays", () => {
    const draft = quickRenameDraft("A", "B", "/sample");
    const result = handoffDraft({ version: 1, workspace: "/sample", source: "test", draft: { ...draft, plan_id: "stale", selected: ["file"] } as typeof draft }, "/sample");
    expect(result).toEqual(draft);
    result.roots.push("/other"); result.mappings[0]!.target = "C";
    expect(draft.roots).toEqual(["/sample"]); expect(draft.mappings[0]!.target).toBe("B");
  });
  it("uses current scope and options but replaces the rules in a separate draft", () => {
    const current = { ...quickRenameDraft("X", "Y", "/docs"), filenames: true, contents: true, include_stem: true };
    const result = quickRenameDraft("A", "B", "/workspace", current);
    expect(result).toMatchObject({ roots: ["/docs"], directories: false, filenames: true, contents: true, include_stem: false, mappings: [{ old: "A", target: "B", enabled: true }] });
    expect(current.mappings[0]!.old).toBe("X");
    expect(quickRenameDraft("A", "B", "/workspace", { ...current, roots: [] }).roots).toEqual(["/workspace"]);
    expect(() => quickRenameDraft("A", "A", "/workspace")).toThrow();
  });
});

it.each([
  ["files", false, true, false],
  ["folders", true, false, false],
  ["contents", false, false, true],
] as const)("quick %s changes only its selected scope", (mode, directories, filenames, contents) => {
  expect(quickRenameDraft("A", "B", "/docs", undefined, mode)).toMatchObject({ directories, filenames, contents });
});

it("inherits the right-side folder choice and rejects an empty scope", () => {
  const current = { ...quickRenameDraft("X", "Y", "/docs"), directories: true, filenames: false, contents: false };
  expect(quickRenameDraft("A", "B", "/docs", current)).toMatchObject({ directories: true, filenames: false, contents: false });
  expect(() => quickRenameDraft("A", "B", "/docs", { ...current, directories: false })).toThrow("至少勾选");
});
