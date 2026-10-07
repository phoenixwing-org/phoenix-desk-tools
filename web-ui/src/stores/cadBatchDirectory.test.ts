import { createPinia, setActivePinia } from "pinia";
import { computed, isReactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchCadBatchDirectories, pickWorkspaceDirectory, validateCadBatchDirectory,
  type CadBatchDirectories, type CadBatchDirectory,
} from "../api";
import { useCadBatchDirectoryStore } from "./cadBatchDirectory";

vi.mock("../api", () => ({
  fetchCadBatchDirectories: vi.fn(), pickWorkspaceDirectory: vi.fn(), validateCadBatchDirectory: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const saved = new Map<string, string>();
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { saved.set(key, value); }),
  });
  vi.mocked(fetchCadBatchDirectories).mockImplementation(async workspace => ({
    workspace, directories: [{ name: "零件", path: "parts" }],
  }));
  vi.mocked(validateCadBatchDirectory).mockImplementation(async (workspace, directory) => ({ workspace, directory }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("persisted CAD batch directory selection", () => {
  it("returns reactive state on the first visit so a rendered root selection can change", () => {
    const store = useCadBatchDirectoryStore();
    const state = store.entry("/first");
    const displayed = computed(() => state.directory);
    expect(displayed.value).toBe(".");
    store.setDirectory("/first", "parts/nested");
    expect(displayed.value).toBe("parts/nested");
    expect(isReactive(state)).toBe(true);
  });
  it("shares one workspace between tools and restores isolated selections after refresh", () => {
    const firstTool = useCadBatchDirectoryStore();
    const secondTool = useCadBatchDirectoryStore();
    firstTool.setDirectory("/a", "parts/sub");
    secondTool.setDirectory("/b", "assemblies");
    expect(secondTool.entry("/a").directory).toBe("parts/sub");
    expect(firstTool.entry("/b").directory).toBe("assemblies");
    const freshSession = useCadBatchDirectoryStore(createPinia());
    expect(freshSession.entry("/a").directory).toBe("parts/sub");
    expect(freshSession.entry("/b").directory).toBe("assemblies");
    expect(freshSession.entry("/new").directory).toBe(".");
    expect(fetchCadBatchDirectories).not.toHaveBeenCalled();
    expect(validateCadBatchDirectory).not.toHaveBeenCalled();
  });
  it("persists only the directory, never pending execution locks, lists or errors", async () => {
    const store = useCadBatchDirectoryStore();
    store.setDirectory("/a", "parts");
    await store.refresh("/a");
    store.lock("/a", "writing", true);
    Object.assign(store.entry("/a"), { pending: true, error: "old error" });
    expect([...saved.values()]).toEqual([JSON.stringify({ directory: "parts" })]);
    expect(useCadBatchDirectoryStore(createPinia()).entry("/a")).toEqual({
      directory: "parts", directories: [], loaded: false, loading: false, pending: false,
      error: "", discoveryError: "", revision: 0, locks: [],
    });
  });
  it("restores an empty or removed directory without widening the scope", async () => {
    useCadBatchDirectoryStore().setDirectory("/a", "");
    const fresh = useCadBatchDirectoryStore(createPinia());
    expect(fresh.entry("/a").directory).toBe("");
    expect(await fresh.validate("/a")).toBe(false);
    expect(validateCadBatchDirectory).not.toHaveBeenCalled();
    fresh.setDirectory("/a", "removed");
    const next = useCadBatchDirectoryStore(createPinia());
    vi.mocked(validateCadBatchDirectory).mockRejectedValueOnce(new Error("目录不存在"));
    expect(await next.validate("/a")).toBe(false);
    expect(next.entry("/a").directory).toBe("removed");
    expect(next.entry("/a").error).toContain("目录不存在");
  });
  it("tolerates malformed and unavailable storage", () => {
    vi.mocked(localStorage.getItem).mockReturnValueOnce("broken").mockReturnValueOnce('{"directory":123}');
    const store = useCadBatchDirectoryStore();
    expect(store.entry("/a").directory).toBe(".");
    expect(store.entry("/b").directory).toBe(".");
    vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error("unavailable"); });
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error("unavailable"); });
    expect(() => store.setDirectory("/c", "parts")).not.toThrow();
    expect(store.entry("/c").directory).toBe("parts");
  });

  it.each(["", " ", "\t\n"])("blocks empty scope %j instead of replacing it with the root", async value => {
    const store = useCadBatchDirectoryStore();
    store.setDirectory("/a", "previous/selection");
    store.setDirectory("/a", value);
    expect(await store.validate("/a")).toBe(false);
    expect(store.entry("/a").directory).toBe(value);
    expect(store.entry("/a").error).toContain("请明确填写 .");
    expect(validateCadBatchDirectory).not.toHaveBeenCalled();
  });

  it("accepts an explicit root and commits only a validated canonical scope", async () => {
    const store = useCadBatchDirectoryStore();
    expect(await store.validate("/a")).toBe(true);
    expect(validateCadBatchDirectory).toHaveBeenLastCalledWith("/a", ".");
    store.setDirectory("/a", "parts/./nested/");
    vi.mocked(validateCadBatchDirectory).mockResolvedValueOnce({ workspace: "/a", directory: "parts/nested" });
    expect(await store.validate("/a")).toBe(true);
    expect(store.entry("/a").directory).toBe("parts/nested");
    expect(useCadBatchDirectoryStore(createPinia()).entry("/a").directory).toBe("parts/nested");
  });

  it("blocks all directory actions without a workspace", async () => {
    const store = useCadBatchDirectoryStore();
    store.setDirectory("", "unsafe");
    await store.refresh("");
    await store.pick("", () => true);
    expect(await store.validate("")).toBe(false);
    expect(store.entry("").directory).toBe(".");
    expect(fetchCadBatchDirectories).not.toHaveBeenCalled();
    expect(pickWorkspaceDirectory).not.toHaveBeenCalled();
    expect(validateCadBatchDirectory).not.toHaveBeenCalled();
  });

  it("deduplicates directory discovery, supports refresh, and does not replace the selected scope", async () => {
    const store = useCadBatchDirectoryStore();
    const pending = deferred<CadBatchDirectories>();
    vi.mocked(fetchCadBatchDirectories).mockReturnValueOnce(pending.promise);
    store.setDirectory("/a", "parts/sub");
    const first = store.refresh("/a");
    await store.refresh("/a", true);
    expect(fetchCadBatchDirectories).toHaveBeenCalledTimes(1);
    pending.resolve({ workspace: "/a", directories: [{ name: "零件", path: "parts" }] });
    await first;
    await store.refresh("/a");
    expect(fetchCadBatchDirectories).toHaveBeenCalledTimes(1);
    await store.refresh("/a", true);
    expect(fetchCadBatchDirectories).toHaveBeenCalledTimes(2);
    expect(store.entry("/a").directory).toBe("parts/sub");
  });

  it("rejects directory lists and validation results for another workspace", async () => {
    const store = useCadBatchDirectoryStore();
    vi.mocked(fetchCadBatchDirectories).mockResolvedValueOnce({ workspace: "/b", directories: [{ name: "Wrong", path: "wrong" }] });
    await store.refresh("/a");
    expect(store.entry("/a")).toMatchObject({ loaded: false, loading: false, directories: [] });
    expect(store.entry("/a").discoveryError).toContain("工作空间已改变");
    store.setDirectory("/a", "parts");
    vi.mocked(validateCadBatchDirectory).mockResolvedValueOnce({ workspace: "/b", directory: "wrong" });
    expect(await store.validate("/a")).toBe(false);
    expect(store.entry("/a")).toMatchObject({ directory: "parts", pending: false });
  });

  it("keeps the previous scope when the native picker is cancelled", async () => {
    const store = useCadBatchDirectoryStore();
    store.setDirectory("/a", "previous");
    vi.mocked(pickWorkspaceDirectory).mockResolvedValueOnce({ cancelled: true, path: "" });
    await store.pick("/a", () => true);
    expect(store.entry("/a")).toMatchObject({ directory: "previous", pending: false, error: "" });
    expect(validateCadBatchDirectory).toHaveBeenCalledExactlyOnceWith("/a", "previous");
    expect(pickWorkspaceDirectory).toHaveBeenCalledWith("/a/previous");
  });

  it("validates picker results and rejects out-of-workspace or nonexistent selections without widening", async () => {
    const store = useCadBatchDirectoryStore();
    store.setDirectory("/a", "previous");
    vi.mocked(pickWorkspaceDirectory).mockResolvedValueOnce({ cancelled: false, path: "/outside" });
    vi.mocked(validateCadBatchDirectory).mockResolvedValueOnce({ workspace: "/a", directory: "previous" }).mockRejectedValueOnce(new Error("目录不在工作空间内"));
    await store.pick("/a", () => true);
    expect(validateCadBatchDirectory).toHaveBeenCalledWith("/a", "/outside");
    expect(store.entry("/a")).toMatchObject({ directory: "previous", pending: false });
    expect(store.entry("/a").error).toContain("目录不在工作空间内");
    vi.mocked(pickWorkspaceDirectory).mockResolvedValueOnce({ cancelled: false, path: "/a/parts/nested" });
    vi.mocked(validateCadBatchDirectory).mockResolvedValueOnce({ workspace: "/a", directory: "previous" }).mockResolvedValueOnce({ workspace: "/a", directory: "parts/nested" });
    await store.pick("/a", () => true);
    expect(store.entry("/a")).toMatchObject({ directory: "parts/nested", pending: false, error: "" });
    expect(useCadBatchDirectoryStore(createPinia()).entry("/a").directory).toBe("parts/nested");
  });

  it("ignores a picker selection when its owner is no longer on the captured workspace", async () => {
    const store = useCadBatchDirectoryStore();
    const pending = deferred<{ cancelled: boolean; path: string }>();
    vi.mocked(pickWorkspaceDirectory).mockReturnValueOnce(pending.promise);
    let current = true;
    const picking = store.pick("/a", () => current);
    current = false;
    pending.resolve({ cancelled: false, path: "/a/old" });
    await picking;
    expect(store.entry("/a")).toMatchObject({ directory: ".", pending: false });
    expect(validateCadBatchDirectory).not.toHaveBeenCalled();
  });

  it("starts in the current validated directory, falling back to the workspace for invalid input", async () => {
    const store = useCadBatchDirectoryStore();
    vi.mocked(pickWorkspaceDirectory).mockResolvedValue({ cancelled: true, path: "" });
    store.setDirectory("/a", "parts/./nested/");
    vi.mocked(validateCadBatchDirectory).mockResolvedValueOnce({ workspace: "/a", directory: "parts/nested" });
    await store.pick("/a", () => true);
    expect(pickWorkspaceDirectory).toHaveBeenLastCalledWith("/a/parts/nested");
    store.setDirectory("/a", "../missing");
    vi.mocked(validateCadBatchDirectory).mockRejectedValueOnce(new Error("outside"));
    await store.pick("/a", () => true);
    expect(pickWorkspaceDirectory).toHaveBeenLastCalledWith("/a");
    expect(store.entry("/a").directory).toBe("../missing");
  });

  it("holds a single pending validation and prevents editing or a competing picker until it settles", async () => {
    const store = useCadBatchDirectoryStore();
    const pending = deferred<CadBatchDirectory>();
    vi.mocked(validateCadBatchDirectory).mockReturnValueOnce(pending.promise);
    store.setDirectory("/a", "parts");
    const validating = store.validate("/a");
    store.setDirectory("/a", "other");
    await store.pick("/a", () => true);
    expect(await store.validate("/a")).toBe(false);
    expect(store.entry("/a")).toMatchObject({ directory: "parts", pending: true });
    expect(pickWorkspaceDirectory).not.toHaveBeenCalled();
    expect(validateCadBatchDirectory).toHaveBeenCalledTimes(1);
    pending.resolve({ workspace: "/a", directory: "parts" });
    expect(await validating).toBe(true);
    expect(store.entry("/a").pending).toBe(false);
  });

  it("keeps independent busy owners until each releases its own lock", async () => {
    const store = useCadBatchDirectoryStore();
    store.lock("/a", "attributes", true);
    store.lock("/a", "repair", true);
    store.lock("/a", "attributes", true);
    expect(store.entry("/a").locks).toHaveLength(2);
    store.lock("/a", "attributes", false);
    store.setDirectory("/a", "blocked");
    expect(await store.validate("/a")).toBe(false);
    await store.pick("/a", () => true);
    expect(store.entry("/a").directory).toBe(".");
    expect(validateCadBatchDirectory).not.toHaveBeenCalled();
    expect(pickWorkspaceDirectory).not.toHaveBeenCalled();
    store.setDirectory("/b", "independent");
    expect(store.entry("/b").directory).toBe("independent");
    store.lock("/a", "repair", false);
    store.setDirectory("/a", "unlocked");
    expect(store.entry("/a").directory).toBe("unlocked");
  });
});
