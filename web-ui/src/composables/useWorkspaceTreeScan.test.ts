import { effectScope, ref } from "vue";
import { beforeEach, expect, it, vi } from "vitest";
import { fetchTree, type TreeResponse } from "../api";
import { useWorkspaceTreeScan } from "./useWorkspaceTreeScan";
vi.mock("../api", () => ({ fetchTree: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
function deferred() {
  let resolve!: (value: TreeResponse) => void;
  const promise = new Promise<TreeResponse>(done => { resolve = done; });
  return { promise, resolve };
}
const result = (name: string): TreeResponse => ({ workspace: "/fixture", workspace_name: "Fixture", tree: { type: "dir", name, path: "", children: [] }, file_count: 1 });
it("rejects an older scan completing after the post-rename refresh", async () => {
  const scope = effectScope(), error = vi.fn();
  const tree = scope.run(() => useWorkspaceTreeScan(ref("/fixture"), error))!;
  const old = deferred(), fresh = deferred();
  vi.mocked(fetchTree).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  try {
    const first = tree.scan({}), second = tree.scan({});
    fresh.resolve(result("new")); expect(await second).toBe(true);
    old.resolve(result("old")); expect(await first).toBe(false);
    expect(tree.tree.value?.name).toBe("new"); expect(tree.loading.value).toBe(false);
    expect(error).not.toHaveBeenCalled();
  } finally { scope.stop(); }
});
it.each(["workspace", "clear", "unmount"])("ignores in-flight replies after %s invalidation", async kind => {
  const scope = effectScope(), workspace = ref("/fixture");
  const tree = scope.run(() => useWorkspaceTreeScan(workspace, vi.fn()))!;
  const pending = deferred(); vi.mocked(fetchTree).mockReturnValue(pending.promise);
  const run = tree.scan({});
  if (kind === "workspace") { workspace.value = "/other"; workspace.value = "/fixture"; }
  else if (kind === "clear") tree.clear();
  else scope.stop();
  pending.resolve(result("stale")); expect(await run).toBe(false);
  expect(tree.tree.value).toBeNull(); scope.stop();
});
it("reports current scan failures and preserves the last tree", async () => {
  const scope = effectScope(), error = vi.fn();
  const tree = scope.run(() => useWorkspaceTreeScan(ref("/fixture"), error))!;
  try {
    vi.mocked(fetchTree).mockResolvedValueOnce(result("last")).mockRejectedValueOnce(Error("offline"));
    await tree.scan({}); expect(await tree.scan({})).toBe(false);
    expect(tree.tree.value?.name).toBe("last"); expect(error).toHaveBeenCalledWith("Error: offline");
    expect(tree.loading.value).toBe(false);
  } finally { scope.stop(); }
});
