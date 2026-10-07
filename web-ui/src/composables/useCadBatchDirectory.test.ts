import fs from "node:fs";
import { createPinia, setActivePinia } from "pinia";
import { effectScope, nextTick, ref, toValue, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCadBatchDirectories, pickWorkspaceDirectory, validateCadBatchDirectory, type CadBatchDirectory } from "../api";
import type { PagePrimaryDirectoryControl } from "./usePagePrimaryContribution";
import { useCadBatchDirectoryStore } from "../stores/cadBatchDirectory";
import { useCadBatchDirectory } from "./useCadBatchDirectory";

vi.mock("../api", () => ({
  fetchCadBatchDirectories: vi.fn(), pickWorkspaceDirectory: vi.fn(), validateCadBatchDirectory: vi.fn(),
}));

const scopes: EffectScope[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(workspace = ref("/a")) {
  const scope = effectScope();
  scopes.push(scope);
  const state = scope.run(() => useCadBatchDirectory(workspace))!;
  const control = state.section.controls?.[0] as PagePrimaryDirectoryControl;
  const busy = ref(false);
  scope.run(() => state.bindBusy(busy));
  return { state, workspace, scope, control, busy };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  vi.mocked(fetchCadBatchDirectories).mockImplementation(async workspace => ({
    workspace, directories: [{ name: "零件", path: "parts" }],
  }));
  vi.mocked(validateCadBatchDirectory).mockImplementation(async (workspace, directory) => ({ workspace, directory }));
});
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); });

describe("shared directory Primary contribution", () => {
  it("updates the already-rendered root after picking a subdirectory on the first tool visit", async () => {
    const { state, control } = setup();
    expect(state.directory.value).toBe(".");
    expect(toValue(control.modelValue)).toBe(".");
    vi.mocked(pickWorkspaceDirectory).mockResolvedValueOnce({ cancelled: false, path: "/a/parts/nested" });
    vi.mocked(validateCadBatchDirectory).mockResolvedValueOnce({ workspace: "/a", directory: "parts/nested" });
    await control.onPick();
    expect(pickWorkspaceDirectory).toHaveBeenCalledWith("/a");
    expect(state.directory.value).toBe("parts/nested");
    expect(toValue(control.modelValue)).toBe("parts/nested");
    expect(state.scopeKey.value).toBe(JSON.stringify(["/a", "parts/nested"]));
    expect(setup().state.directory.value).toBe("parts/nested");
  });

  it("shares every keystroke across tool instances and blocks an empty latest input", async () => {
    const first = setup();
    const second = setup();
    for (const value of ["p", "parts", "parts/nested", ""]) {
      const previousKey = first.state.scopeKey.value;
      first.control.onUpdate(value);
      expect(first.state.directory.value).toBe(value);
      expect(second.state.directory.value).toBe(value);
      expect(toValue(second.control.modelValue)).toBe(value);
      expect(first.state.scopeKey.value).not.toBe(previousKey);
    }
    expect(await second.state.validate()).toBe(false);
    expect(validateCadBatchDirectory).not.toHaveBeenCalled();
    expect(toValue(second.state.section.description)).toContain("请明确填写 .");
  });

  it("keeps workspace scope caches separate and exposes discovered options without changing selection", async () => {
    const { state, workspace, control } = setup();
    control.onUpdate("parts/nested");
    await control.onRefresh();
    expect(toValue(control.options)).toEqual([
      { value: ".", label: "工作空间根目录（.）" }, { value: "parts", label: "零件" },
    ]);
    workspace.value = "/b";
    expect(state.directory.value).toBe(".");
    control.onUpdate("assemblies");
    workspace.value = "/a";
    expect(state.directory.value).toBe("parts/nested");
    expect(state.scopeKey.value).toBe(JSON.stringify(["/a", "parts/nested"]));
  });

  it("shares busy state synchronously and releases only the disposed tool's lock", () => {
    const first = setup();
    const second = setup();
    first.busy.value = true;
    second.busy.value = true;
    expect(first.state.disabled.value).toBe(true);
    expect(toValue(second.control.disabled)).toBe(true);
    second.control.onUpdate("blocked");
    expect(second.state.directory.value).toBe(".");
    first.scope.stop();
    expect(second.state.disabled.value).toBe(true);
    second.busy.value = false;
    expect(second.state.disabled.value).toBe(false);
    second.control.onUpdate("allowed");
    expect(second.state.directory.value).toBe("allowed");
  });

  it("never enables controls without a workspace", () => {
    const { state, control } = setup(ref(""));
    expect(state.disabled.value).toBe(true);
    control.onUpdate("must-not-set");
    expect(state.directory.value).toBe(".");
    expect(fetchCadBatchDirectories).not.toHaveBeenCalled();
  });

  it("does no directory IO on entering a View or switching workspaces until requested", async () => {
    const { workspace, control } = setup();
    setup(workspace);
    await nextTick();
    workspace.value = "/b";
    await nextTick();
    expect(fetchCadBatchDirectories).not.toHaveBeenCalled();
    expect(validateCadBatchDirectory).not.toHaveBeenCalled();
    expect(pickWorkspaceDirectory).not.toHaveBeenCalled();
    await control.onRefresh();
    expect(fetchCadBatchDirectories).toHaveBeenCalledOnce();
    expect(fetchCadBatchDirectories).toHaveBeenCalledWith("/b");
  });

  it("rejects a late validation after switching workspaces without contaminating the new selection", async () => {
    const { state, workspace } = setup();
    const pending = deferred<CadBatchDirectory>();
    vi.mocked(validateCadBatchDirectory).mockReturnValueOnce(pending.promise);
    state.directory.value = "parts";
    const validating = state.validate();
    workspace.value = "/b";
    state.directory.value = "b-only";
    pending.resolve({ workspace: "/a", directory: "parts" });
    expect(await validating).toBe(false);
    expect(state.directory.value).toBe("b-only");
  });

  it("discards picker validation if the workspace changes while validation is pending", async () => {
    const { state, workspace, control } = setup();
    const pending = deferred<CadBatchDirectory>();
    vi.mocked(pickWorkspaceDirectory).mockResolvedValueOnce({ cancelled: false, path: "/a/chosen" });
    vi.mocked(validateCadBatchDirectory).mockReturnValueOnce(pending.promise);
    const picking = control.onPick();
    await nextTick();
    expect(validateCadBatchDirectory).toHaveBeenCalledWith("/a", "/a/chosen");
    workspace.value = "/b";
    pending.resolve({ workspace: "/a", directory: "chosen" });
    await picking;
    expect(state.directory.value).toBe(".");
    expect(useCadBatchDirectoryStore().entry("/a").directory).toBe(".");
  });

  it("invalidates validation after A → B → A instead of accepting the old operation", async () => {
    const { state, workspace } = setup();
    const pending = deferred<CadBatchDirectory>();
    vi.mocked(validateCadBatchDirectory).mockReturnValueOnce(pending.promise);
    const validating = state.validate();
    workspace.value = "/b";
    workspace.value = "/a";
    pending.resolve({ workspace: "/a", directory: "." });
    expect(await validating).toBe(false);
  });

  it("invalidates picker results after A → B → A instead of overwriting the returning workspace", async () => {
    const { state, workspace, control } = setup();
    const pending = deferred<{ cancelled: boolean; path: string }>();
    vi.mocked(pickWorkspaceDirectory).mockReturnValueOnce(pending.promise);
    state.directory.value = "previous";
    const picking = control.onPick();
    workspace.value = "/b";
    workspace.value = "/a";
    pending.resolve({ cancelled: false, path: "stale-selection" });
    await picking;
    expect(state.directory.value).toBe("previous");
    expect(validateCadBatchDirectory).toHaveBeenCalledTimes(1);
    expect(validateCadBatchDirectory).toHaveBeenCalledWith("/a", "previous");
  });

  it("does not permit a late validation to continue a disposed tool's operation", async () => {
    const { state, scope } = setup();
    const pending = deferred<CadBatchDirectory>();
    vi.mocked(validateCadBatchDirectory).mockReturnValueOnce(pending.promise);
    const validating = state.validate();
    scope.stop();
    pending.resolve({ workspace: "/a", directory: "." });
    expect(await validating).toBe(false);
  });

  it("does not let an unmounted picker overwrite another tool's shared scope", async () => {
    const first = setup();
    const second = setup();
    const pending = deferred<{ cancelled: boolean; path: string }>();
    vi.mocked(pickWorkspaceDirectory).mockReturnValueOnce(pending.promise);
    first.state.directory.value = "previous";
    const picking = first.control.onPick();
    first.scope.stop();
    pending.resolve({ cancelled: false, path: "stale-selection" });
    await picking;
    expect(second.state.directory.value).toBe("previous");
  });

  it("wires autocomplete input updates immediately and exposes disabled picker/refresh controls", () => {
    const source = fs.readFileSync(new URL("../components/primary/PrimaryDirectoryControl.vue", import.meta.url), "utf8");
    expect(source).toContain('@update:model-value="control.onUpdate');
    expect(source).toContain(':debounce="0"');
    expect(source).not.toMatch(/@change=|v-model\.lazy/);
    expect(source.match(/:disabled="disabled"/g)).toHaveLength(3);
    expect(source).toContain('@click="control.onPick"');
    expect(source).toContain('@click="control.onRefresh"');
  });
});
