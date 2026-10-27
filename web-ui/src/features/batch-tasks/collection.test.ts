import fs from "node:fs";
import { computed } from "vue";
import { describe, expect, it } from "vitest";
import { createBatchTaskCollection, validateBatchCollectionPath } from "./collection";
import { collectTreeFilePaths } from "../../utils/treeFilePaths";
import { filterTreeNode } from "../../utils/workspaceTreeFilter";
import type { TreeNode } from "../../api";

function storage() {
  const values = new Map<string, string>();
  return { values, port: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } };
}

describe("batch input collection — preferences, not execution", () => {
  it("isolates workspace inputs, restores only relative files and never mutates the caller's array", () => {
    const { values, port } = storage(), collection = createBatchTaskCollection(port);
    const input = ["examples/Feature.FCStd"];
    expect(collection.add("/independent-one", input)).toEqual({ added: 1, duplicates: 0, total: 1, persisted: true });
    input.push("examples/NotSelected.FCStd");
    collection.add("/independent-two", ["notes/Readme.md"]);
    const restored = createBatchTaskCollection(port);
    expect(restored.pathsFor("/independent-one")).toEqual(["examples/Feature.FCStd"]);
    expect(restored.pathsFor("/independent-two")).toEqual(["notes/Readme.md"]);
    expect(restored.pathsFor("")).toEqual([]);
    expect([...values.values()].map(value => Object.keys(JSON.parse(value)))).toEqual([["version", "paths"], ["version", "paths"]]);
  });

  it("compares NFC / casefold identities while retaining the exact original file spelling", () => {
    const collection = createBatchTaskCollection(storage().port);
    const first = "examples/Cafe\u0301.FCStd";
    expect(collection.add("/one", [first, "examples/Caf\u00e9.fcstd", "EXAMPLES/CAFE\u0301.FCSTD"])).toMatchObject({ added: 1, duplicates: 2, total: 1 });
    expect(collection.pathsFor("/one")).toEqual([first]);
    expect(collection.add("/one", ["examples/Caf\u00e9.FCStd"])).toMatchObject({ added: 0, duplicates: 1, total: 1 });
    collection.remove("/one", "EXAMPLES/CAF\u00c9.FCSTD");
    expect(collection.pathsFor("/one")).toEqual([]);
    expect(collection.add("/one", ["examples/Stra\u00dfe.txt", "examples/STRASSE.txt"])).toMatchObject({ added: 1, duplicates: 1 });
  });

  it.each(["", "../outside.FCStd", "/absolute.FCStd", "C:/absolute.FCStd", "directory/", "one//two.txt", "./one.txt", "one/../two.txt", "one\\two.txt", ".hidden.FCStd", "one/.cache/model.FCStd", "one/__pycache__/item.txt", "one/NODE_MODULES/item.txt", "one/null\u0000.txt", "one/invisible\u200b.txt", " one.txt", "one.txt "])("rejects unsafe or directory-shaped input atomically: %j", path => {
    const collection = createBatchTaskCollection(storage().port);
    collection.add("/one", ["examples/Existing.FCStd"]);
    expect(() => collection.add("/one", ["examples/New.FCStd", path])).toThrow(/明确|相对文件/);
    expect(collection.pathsFor("/one")).toEqual(["examples/Existing.FCStd"]);
  });

  it("keeps both input and storage unchanged when a whole addition would exceed 200 files", () => {
    const { port, values } = storage(), collection = createBatchTaskCollection(port);
    const selected = Array.from({ length: 199 }, (_, i) => `examples/Feature-${i}.FCStd`);
    collection.add("/one", selected);
    const before = [...values.entries()];
    expect(() => collection.add("/one", ["examples/Extra-A.FCStd", "examples/Extra-B.FCStd"])).toThrow(/200/);
    expect(collection.pathsFor("/one")).toEqual(selected);
    expect([...values.entries()]).toEqual(before);
  });

  it("invalidates computed projections and exposes only immutable snapshots", () => {
    const collection = createBatchTaskCollection(storage().port), count = computed(() => collection.pathsFor("/one").length);
    expect(count.value).toBe(0);
    collection.add("/one", ["examples/Feature.FCStd"]);
    expect(count.value).toBe(1);
    const snapshot = collection.pathsFor("/one");
    expect(Object.isFrozen(snapshot)).toBe(true);
    collection.clear("/one");
    expect(count.value).toBe(0);
    expect(snapshot).toEqual(["examples/Feature.FCStd"]);
  });

  it("fails closed for tampered cached paths, unsupported versions and oversized caches", () => {
    for (const value of [JSON.stringify({ version: 1, paths: ["../outside.txt"] }), JSON.stringify({ version: 2, paths: ["examples/Feature.FCStd"] }), "x".repeat(500_001), "not json"]) {
      const collection = createBatchTaskCollection({ getItem: () => value, setItem: () => undefined, removeItem: () => undefined });
      expect(collection.pathsFor("/one")).toEqual([]);
      expect(collection.warningFor("/one")).toContain("未恢复");
    }
  });

  it("retains session-only input and explicitly reports failed persistence", () => {
    const collection = createBatchTaskCollection({ getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("denied"); } });
    expect(collection.add("/one", ["notes/Example.md"])).toMatchObject({ added: 1, total: 1, persisted: false });
    expect(collection.pathsFor("/one")).toEqual(["notes/Example.md"]);
    expect(collection.warningFor("/one")).toContain("仅在本次会话");
    expect(collection.clear("/one")).toBe(false);
    expect(collection.pathsFor("/one")).toEqual([]);
  });

  it("rejects missing workspaces without creating another implicit scope", () => {
    const { values, port } = storage(), collection = createBatchTaskCollection(port);
    expect(() => collection.add("", ["notes/Example.md"])).toThrow(/工作空间/);
    expect(values.size).toBe(0);
    expect(validateBatchCollectionPath("notes/Example.md")).toBe("notes/Example.md");
  });

  it("collects only the already filtered tree's concrete file nodes without expanding directories", () => {
    const tree: TreeNode = { name: "examples", path: "examples", type: "dir", children: [
      { name: "Selected.FCStd", path: "examples/Selected.FCStd", type: "file" },
      { name: "Other.FCStd", path: "examples/Other.FCStd", type: "file" },
      { name: "Selected directory", path: "examples/Selected-directory", type: "dir", children: [] },
    ] };
    const collection = createBatchTaskCollection(storage().port);
    collection.add("/one", collectTreeFilePaths(filterTreeNode(tree, "Selected")));
    expect(collection.pathsFor("/one")).toEqual(["examples/Selected.FCStd"]);
    expect(tree.children).toHaveLength(3);
  });

  it("wires source views to explicit file projections and keeps the basket import separate from saving", () => {
    const source = (path: string) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
    const tree = source("../../layout/WorkspaceTreeSidebar.vue"), gallery = source("../part-gallery/PartGalleryPage.vue"), detail = source("../../pages/FileDetailPage.vue"), basket = source("./BatchTaskBasket.vue");
    expect(tree).toContain("const paths = collectTreeFilePaths(displayTree.value)");
    expect(tree).toContain('@click="onAddVisibleToBatch"');
    expect(gallery).toContain("batchCollection.add(shell.workspacePath.value, visible.value.map(row => row.rel))");
    expect(detail).toContain("batchCollection.add(shell.workspacePath.value, [rel.value])");
    expect(basket).toContain('emit("import", [...paths.value])');
    for (const method of [".save(", ".admit(", "fetch(", "scan("]) expect(basket).not.toContain(method);
    expect(source("./collection.ts")).not.toMatch(/\b(fetch|fetchBatch|scan|Native|batchTasksApi)\s*\(/);
  });
});
