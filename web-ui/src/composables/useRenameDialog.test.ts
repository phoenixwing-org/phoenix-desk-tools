import { ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BomFields } from "../api";
import { useRenameDialog } from "./useRenameDialog";

const api = vi.hoisted(() => ({
  executeFileRename: vi.fn(),
  fetchRenameLogs: vi.fn().mockResolvedValue({ entries: [] }),
  analyzeRenameReferences: vi.fn(),
  applyRenameAnalysisCorrections: vi.fn(),
  applyReferenceLabelCorrections: vi.fn(),
}));
vi.mock("../api", () => api);
const shell = vi.hoisted(() => ({ appendLog: vi.fn(), setStatus: vi.fn(), openRenameAnalysis: vi.fn(), requestTreeRescan: vi.fn(), workspacePath: { value: "/fixture" } }));
vi.mock("./useAppShell", () => ({
  useAppShell: () => shell,
}));

function createDialog(filename?: string) {
  const form = ref<Partial<BomFields>>({ filename });
  return { form, dialog: useRenameDialog(ref("parts/Old.FCStd"), ref("Old.FCStd"), form, ref({ filename: "Old.FCStd" })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  shell.workspacePath.value = "/fixture";
  setActivePinia(createPinia());
});

describe("rename dialog target source", () => {
  it("renames an independent drawing without writing stale model attributes and reports empty Label/basename results", async () => {
    api.executeFileRename.mockResolvedValue({ filename: "New.Drawing.FCStd", bom_readonly: true, rename_log: { id: 1, new_repo_rel_path: "sheets/New.Drawing.FCStd" } });
    api.analyzeRenameReferences.mockResolvedValue({ host_count: 0, hit_count: 0, pending_hit_count: 0, hosts: [] });
    const baseline = { filename: "Old.Drawing.FCStd", PartName: "原名" };
    const dialog = useRenameDialog(ref("sheets/Old.Drawing.FCStd"), ref("Old.Drawing.FCStd"), ref({ filename: "New.Drawing.FCStd", PartName: "误编辑" }), ref(baseline), ref(true));
    dialog.open(); await dialog.onRename();
    expect(api.executeFileRename).toHaveBeenCalledWith("sheets/Old.Drawing.FCStd", { ...baseline, filename: "New.Drawing.FCStd" }, baseline, { writeAttrsFirst: false });
    expect(api.applyReferenceLabelCorrections).not.toHaveBeenCalled();
    expect(api.applyRenameAnalysisCorrections).not.toHaveBeenCalled();
    expect(dialog.pageError.value).toBe("");
    expect(dialog.completionNote.value).toContain("未找到适用的 Label / basename");
    dialog.open(); expect(dialog.completionNote.value).toBe("");
  });
  it("shows drawing label skips as a result, not a failed rename", async () => {
    api.executeFileRename.mockResolvedValue({ filename: "New.FCStd", rename_log: { id: 1 } });
    api.analyzeRenameReferences.mockResolvedValue({ host_count: 1, hit_count: 1, pending_hit_count: 0, hosts: [{ host_repo_rel_path: "Sheet.Drawing.FCStd" }] });
    api.applyReferenceLabelCorrections.mockResolvedValue({ label_patches: 0, failed: [], skipped: [{ host_repo_rel_path: "Sheet.Drawing.FCStd", xlink_file_attr: "New.FCStd", reason: "未找到装配实例 Label，已跳过" }] });
    const { dialog } = createDialog("New.FCStd"); dialog.open(); await dialog.onRename();
    expect(dialog.pageError.value).toBe("");
    expect(dialog.completionNote.value).toContain("未找到适用的 Label 修正项 1 处");
    expect(shell.appendLog).toHaveBeenCalledWith(expect.stringContaining("未找到待修正的 basename"), expect.any(Object));
  });
  it("explains an unchanged filename and never executes an unchanged or empty target", async () => {
    const { dialog } = createDialog("Old.FCStd");
    dialog.open();
    expect(dialog.sameFilename.value).toBe(true);
    expect(dialog.canRename.value).toBe(false);
    await dialog.onRename();
    dialog.newFilename.value = " ";
    expect(dialog.sameFilename.value).toBe(false);
    expect(dialog.canRename.value).toBe(false);
    await dialog.onRename();
    expect(api.executeFileRename).not.toHaveBeenCalled();
    expect(shell.requestTreeRescan).not.toHaveBeenCalled();
  });
  it.each([true, false])("skips both correction calls for an empty reference scan (path options: %s)", async fixPaths => {
    api.executeFileRename.mockResolvedValue({ filename: "New.FCStd", rename_log: { id: 1, new_repo_rel_path: "parts/New.FCStd" } });
    api.analyzeRenameReferences.mockResolvedValue({ host_count: 0, hit_count: 0, pending_hit_count: 0, hosts: [] });
    const { dialog } = createDialog("New.FCStd");
    dialog.open();
    dialog.fixXref.value = fixPaths;
    dialog.fixBasename.value = fixPaths;
    expect(dialog.syncLabels.value).toBe(true);
    await dialog.onRename();
    expect(api.executeFileRename).toHaveBeenCalledTimes(1);
    expect(shell.requestTreeRescan).toHaveBeenCalledExactlyOnceWith();
    expect(api.analyzeRenameReferences).toHaveBeenCalledTimes(1);
    expect(api.applyRenameAnalysisCorrections).not.toHaveBeenCalled();
    expect(api.applyReferenceLabelCorrections).not.toHaveBeenCalled();
    expect(dialog.renamed.value).toBe(true);
    expect(dialog.pageError.value).toBe("");
    expect(shell.setStatus).toHaveBeenLastCalledWith("改名完成：New.FCStd · 当前索引未发现引用，已跳过引用修正");
  });

  it("still syncs labels when hosts exist but no path correction is pending", async () => {
    api.executeFileRename.mockResolvedValue({ filename: "New.FCStd", rename_log: { id: 1, new_repo_rel_path: "parts/New.FCStd" } });
    api.analyzeRenameReferences.mockResolvedValue({ host_count: 1, hit_count: 1, pending_hit_count: 0, hosts: [{ host_repo_rel_path: "Host.FCStd" }] });
    api.applyReferenceLabelCorrections.mockResolvedValue({ label_patches: 0, failed: [] });
    const { dialog } = createDialog("New.FCStd");
    dialog.open();
    await dialog.onRename();
    expect(api.applyRenameAnalysisCorrections).not.toHaveBeenCalled();
    expect(api.applyReferenceLabelCorrections).toHaveBeenCalledWith(["Host.FCStd"], {
      renameLogId: 1, transitive: true, labelScope: "incoming",
    });
    expect(dialog.pageError.value).toBe("");
  });

  it("does not treat inconsistent positive scan counts with no hosts as a successful no-op", async () => {
    api.executeFileRename.mockResolvedValue({ filename: "New.FCStd", rename_log: { id: 1, new_repo_rel_path: "parts/New.FCStd" } });
    api.analyzeRenameReferences.mockResolvedValue({ host_count: 1, hit_count: 1, pending_hit_count: 1, hosts: [] });
    const { dialog } = createDialog("New.FCStd");
    dialog.open();
    await dialog.onRename();
    expect(api.applyRenameAnalysisCorrections).not.toHaveBeenCalled();
    expect(api.applyReferenceLabelCorrections).not.toHaveBeenCalled();
    expect(dialog.pageError.value).toContain("引用扫描计数与宿主列表不一致");
  });

  it.each(["xlink", "label", "scan"])("keeps a visible partial-success warning when %s correction fails", async failure => {
    api.executeFileRename.mockResolvedValue({ filename: "New.FCStd", rename_log: { id: 1, new_repo_rel_path: "parts/New.FCStd" } });
    api.analyzeRenameReferences.mockResolvedValue({ host_count: 1, hit_count: 1, pending_hit_count: 1, hosts: [{ host_repo_rel_path: "Host.FCStd" }] });
    api.applyRenameAnalysisCorrections.mockResolvedValue({ xlink_patches: 1, applied_hosts: ["Host.FCStd"], failed: failure === "xlink" ? [{ host_repo_rel_path: "Host.FCStd", error: "locked" }] : [] });
    api.applyReferenceLabelCorrections.mockResolvedValue({ label_patches: 1, failed: failure === "label" ? [{ host_repo_rel_path: "Host.FCStd", error: "locked" }] : [] });
    if (failure === "scan") api.analyzeRenameReferences.mockRejectedValueOnce(new Error("index unavailable"));
    const { dialog } = createDialog("New.FCStd");
    dialog.open();
    await dialog.onRename();
    expect(dialog.renamed.value).toBe(true);
    expect(dialog.pageError.value).toContain("文件已改名，但");
    expect(dialog.pageError.value).toContain("改名分析");
    expect(shell.requestTreeRescan).toHaveBeenCalledExactlyOnceWith();
  });

  it("refreshes after an uncertain rename reply, without replaying the write", async () => {
    api.executeFileRename.mockRejectedValueOnce(Error("connection lost"));
    const { dialog } = createDialog("New.FCStd"); dialog.open(); await dialog.onRename();
    expect(shell.requestTreeRescan).toHaveBeenCalledExactlyOnceWith();
    expect(api.executeFileRename).toHaveBeenCalledTimes(1);
    expect(dialog.pageError.value).toContain("connection lost");
  });

  it("does not refresh a different workspace if a rename reply is late", async () => {
    api.executeFileRename.mockImplementationOnce(async () => {
      shell.workspacePath.value = "/other";
      return { filename: "New.FCStd" };
    });
    const { dialog } = createDialog("New.FCStd"); dialog.open(); await dialog.onRename();
    expect(shell.requestTreeRescan).not.toHaveBeenCalled();
  });

  it("defaults all reference options on and remembers choices across opens and files", () => {
    const { dialog } = createDialog();
    dialog.open();
    expect([dialog.fixXref.value, dialog.syncLabels.value, dialog.fixBasename.value]).toEqual([true, true, true]);
    dialog.syncLabels.value = false;
    dialog.close();
    dialog.open();
    expect(dialog.syncLabels.value).toBe(false);
    expect(createDialog().dialog.syncLabels.value).toBe(false);
  });

  it("uses the edited filename and does not rename or write on open", () => {
    const { dialog } = createDialog(" 新名称.FCStd ");
    dialog.open();
    expect(dialog.newFilename.value).toBe("新名称.FCStd");
    expect(dialog.canRename.value).toBe(true);
    expect(api.executeFileRename).not.toHaveBeenCalled();
    expect(api.applyRenameAnalysisCorrections).not.toHaveBeenCalled();
  });

  it("keeps an explicitly selected target ahead of the draft", () => {
    const { dialog } = createDialog("Draft.FCStd");
    dialog.open({ preferredNewFilename: "Selected.FCStd" });
    expect(dialog.newFilename.value).toBe("Selected.FCStd");
  });

  it("uses the disk filename when no draft exists", () => {
    const { dialog } = createDialog(" ");
    dialog.open();
    expect(dialog.newFilename.value).toBe("Old.FCStd");
    expect(dialog.canRename.value).toBe(false);
  });

  it("reopens with the latest edit instead of a stale dialog target", () => {
    const { dialog, form } = createDialog("First.FCStd");
    dialog.open();
    dialog.close();
    form.value.filename = "Second.FCStd";
    dialog.open();
    expect(dialog.newFilename.value).toBe("Second.FCStd");
  });
});
