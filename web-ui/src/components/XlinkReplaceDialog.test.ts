import { effectScope, nextTick, reactive, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetch: vi.fn(), apply: vi.fn(), confirm: vi.fn(), emit: vi.fn(),
  shell: { appendLog: vi.fn(), setStatus: vi.fn() },
}));
vi.mock("vue", async original => ({
  ...await original<typeof import("vue")>(), useSSRContext: () => ({ modules: new Set<string>() }),
}));
vi.mock("../api", () => ({ fetchXlinkFixCandidates: state.fetch, applyXlinkFixOverride: state.apply }));
vi.mock("../composables/useAppShell", () => ({ useAppShell: () => state.shell }));
import XlinkReplaceDialog from "./XlinkReplaceDialog.vue";

// Synthetic metadata only; no CAD documents, native runtime or server process.
const candidate = {
  id: 1, repo_rel_path: "./synthetic/DEMO.002-Sample.FCStd", filename: "DEMO.002-Sample.FCStd",
  part_number: "DEMO", part_version: "002", part_key: "DEMO.002", file_status: "present",
};
let scope: EffectScope | undefined;
async function settle() { await nextTick(); await Promise.resolve(); await nextTick(); }
function setup() {
  const props = reactive({ open: false, hostRepoRel: "./synthetic/Host.FCStd", edge: {
    xlink_file_attr: "../old/DEMO.001-Sample.FCStd", target_basename: "DEMO.001-Sample.FCStd", resolve_status: "missing",
  } });
  scope = effectScope();
  const form = scope.run(() => (XlinkReplaceDialog as any).setup(props, { expose: () => undefined, emit: state.emit }));
  return { props, form };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: state.confirm });
  // A legacy response carrying the old revision must not repopulate the optional filter.
  state.fetch.mockResolvedValue({ part_number: "DEMO", part_version: "001", files: [candidate] });
  state.apply.mockResolvedValue({ unchanged: true });
  state.confirm.mockReturnValue(true);
});
afterEach(() => { scope?.stop(); vi.unstubAllGlobals(); });

describe("XLink replacement candidate search", () => {
  it("opens with all versions and requires explicit selection even for a single candidate", async () => {
    const { form, props } = setup();
    props.open = true; await settle();
    expect(state.fetch).toHaveBeenCalledWith({
      basename: "DEMO.001-Sample.FCStd", part_number: undefined, part_version: undefined,
      exclude_repo_rel: "./synthetic/Host.FCStd",
    });
    expect(form.partNumber.value).toBe("DEMO");
    expect(form.partVersion.value).toBe("");
    expect(form.selectedTargetRel.value).toBe("");
    await form.onApply();
    expect(state.confirm).not.toHaveBeenCalled();
    expect(state.apply).not.toHaveBeenCalled();
  });

  it("sends an optional version, clears the previous selection, and returns to all versions when cleared", async () => {
    const { form, props } = setup();
    props.open = true; await settle();
    form.selectedTargetRel.value = candidate.repo_rel_path;
    form.partVersion.value = " 002 ";
    await form.loadCandidates();
    expect(state.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ part_number: "DEMO", part_version: "002" }));
    expect(form.selectedTargetRel.value).toBe("");
    form.partVersion.value = "";
    await form.loadCandidates();
    expect(state.fetch).toHaveBeenLastCalledWith(expect.objectContaining({ part_version: undefined }));
    expect(form.partVersion.value).toBe("");
    props.open = false; await settle(); props.open = true; await settle();
    expect(form.partVersion.value).toBe("");
    expect(form.selectedTargetRel.value).toBe("");
  });

  it("writes only an explicitly selected current candidate after confirmation", async () => {
    const { form, props } = setup();
    props.open = true; await settle();
    form.selectedTargetRel.value = "./synthetic/NotInCandidates.FCStd";
    await form.onApply();
    expect(state.apply).not.toHaveBeenCalled();
    form.selectedTargetRel.value = candidate.repo_rel_path;
    state.confirm.mockReturnValueOnce(false);
    await form.onApply();
    expect(state.apply).not.toHaveBeenCalled();
    await form.onApply();
    expect(state.apply).toHaveBeenCalledExactlyOnceWith({
      host_repo_rel: "./synthetic/Host.FCStd", old_path: "../old/DEMO.001-Sample.FCStd", target_repo_rel: candidate.repo_rel_path,
    });
    expect(state.emit).toHaveBeenCalledWith("applied");
    expect(state.emit).toHaveBeenCalledWith("close");
  });
});
