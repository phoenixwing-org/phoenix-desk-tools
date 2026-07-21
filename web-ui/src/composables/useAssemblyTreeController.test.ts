import { describe, expect, it, vi } from "vitest";
import type { AssemblyTreeNode } from "../api";
import { useAssemblyTreeController } from "./useAssemblyTreeController";

function node(overrides: Partial<AssemblyTreeNode> = {}): AssemblyTreeNode {
  return {
    id: "assembly",
    host_repo_rel: "Root.FCStd",
    repo_rel_path: "Assembly.FCStd",
    basename: "Assembly.FCStd",
    resolve_status: "resolved",
    xlink_file_attr: "Assembly.FCStd",
    part_number: "",
    part_version: "",
    part_key: "",
    TypeCode: "",
    ModelSeries: "",
    PartName: "",
    label: "",
    link_label: "",
    link_labels: [],
    xref_instances: [],
    ref_count: 1,
    file_role: "assembly",
    children: [],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("useAssemblyTreeController", () => {
  it("并发请求同一子树时共享 Promise 且只调用一次 transport", async () => {
    const pending = deferred<any>();
    const fetchSubtree = vi.fn(() => pending.promise);
    const controller = useAssemblyTreeController({ fetchSubtree, onStatus: vi.fn() });
    const root = node();

    const first = controller.ensureSubtree(root);
    const second = controller.ensureSubtree(root);
    expect(fetchSubtree).toHaveBeenCalledTimes(1);
    expect(controller.loadingSubtree.value.has(root.id)).toBe(true);

    const child = node({ id: "child", file_role: "part", repo_rel_path: "Child.FCStd" });
    pending.resolve({ nodes: [child] });
    await expect(first).resolves.toEqual([child]);
    await expect(second).resolves.toEqual([child]);
    expect(controller.childrenOf(root)).toEqual([child]);
    expect(controller.loadingSubtree.value.has(root.id)).toBe(false);
  });

  it("失败回退为空并清理 loading，toggle 给出可理解状态", async () => {
    const onStatus = vi.fn();
    const controller = useAssemblyTreeController({
      fetchSubtree: vi.fn(async () => { throw new Error("offline"); }),
      onStatus,
    });
    await controller.toggle(node());
    expect(onStatus).toHaveBeenNthCalledWith(1, "Error: offline");
    expect(onStatus).toHaveBeenNthCalledWith(2, "该装配无已索引的下级引用，请先在「引用」Tab 重建索引");
    expect(controller.loadingSubtree.value.size).toBe(0);
    expect(controller.expanded.value.size).toBe(0);
  });

  it("全部展开递归加载装配，全部折叠只清视觉状态", async () => {
    const child = node({ id: "part", file_role: "part", repo_rel_path: "Part.FCStd" });
    const fetchSubtree = vi.fn(async () => ({ nodes: [child] }));
    const controller = useAssemblyTreeController({ fetchSubtree, onStatus: vi.fn() });
    const root = node({ ref_count: 2 });

    await controller.expandAllTree([root]);
    expect(controller.expanded.value).toEqual(new Set([root.id]));
    expect(controller.expandedLabels.value).toEqual(new Set([root.id]));
    expect(controller.flatRows([root]).map(({ node: row }) => row.id)).toEqual([root.id, child.id]);

    controller.collapseAll();
    expect(controller.expanded.value.size).toBe(0);
    expect(controller.childrenOf(root)).toEqual([child]);
  });

  it("nodes 重置后忽略旧请求，不污染同 id 的新树", async () => {
    const oldRequest = deferred<any>();
    const freshChild = node({ id: "fresh", file_role: "part" });
    const fetchSubtree = vi.fn()
      .mockImplementationOnce(() => oldRequest.promise)
      .mockResolvedValueOnce({ nodes: [freshChild] });
    const onStatus = vi.fn();
    const controller = useAssemblyTreeController({ fetchSubtree, onStatus });
    const oldRoot = node();
    const stale = controller.toggle(oldRoot);

    controller.reset([node()]);
    await controller.ensureSubtree(node());
    oldRequest.resolve({ nodes: [node({ id: "stale", file_role: "part" })] });
    await stale;

    expect(controller.childrenOf(node()).map((child) => child.id)).toEqual(["fresh"]);
    expect(controller.loadingSubtree.value.size).toBe(0);
    expect(controller.expanded.value.size).toBe(0);
    expect(onStatus).not.toHaveBeenCalled();
  });
});
