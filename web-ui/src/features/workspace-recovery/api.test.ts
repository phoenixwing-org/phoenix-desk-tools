import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonFetch } from "../../api";
import { absoluteRecoveryDirectory, absoluteRecoveryTarget, backupWorkspaceRecovery, inspectWorkspaceRecovery, joinNewRecoveryDirectory, releaseWorkspaceRecovery, restoreWorkspaceRecovery, validateWorkspaceBackupReceipt, validateWorkspaceRecoveryInspection, validateWorkspaceRestoreReceipt } from "./api";
import { syntheticBackupReceipt, syntheticBackupTarget, syntheticInspection, syntheticRestoreReceipt, syntheticRestoreTarget, syntheticWorkspace } from "./fixtures.test-support";
vi.mock("../../api", () => ({ jsonFetch: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });
describe("workspace recovery exact plain transport", () => {
  it("inspect posts only selected workspace and backup directory with cancellation, accepting no success wrapper", async () => {
    const abort = new AbortController(); vi.mocked(jsonFetch).mockResolvedValue(syntheticInspection());
    expect(await inspectWorkspaceRecovery(syntheticWorkspace, syntheticBackupTarget, abort.signal)).toEqual(syntheticInspection());
    expect(jsonFetch).toHaveBeenCalledExactlyOnceWith("/api/workspace-recovery/inspect", { method: "POST", body: JSON.stringify({ workspace: syntheticWorkspace, backup_directory: syntheticBackupTarget }), signal: abort.signal });
  });
  it("backup posts explicit confirmation and no client proof, manifests or arbitrary options", async () => {
    const abort = new AbortController(); vi.mocked(jsonFetch).mockResolvedValue({ receipt: syntheticBackupReceipt() });
    expect(await backupWorkspaceRecovery(syntheticWorkspace, syntheticBackupTarget, abort.signal)).toEqual(syntheticBackupReceipt());
    expect(jsonFetch).toHaveBeenCalledExactlyOnceWith("/api/workspace-recovery/backup", { method: "POST", body: JSON.stringify({ workspace: syntheticWorkspace, target_directory: syntheticBackupTarget, confirmed: true }), signal: abort.signal });
  });
  it("restore sends only a server handle and new destination, never a replacement backup path or hash", async () => {
    const abort = new AbortController(); vi.mocked(jsonFetch).mockResolvedValue({ receipt: syntheticRestoreReceipt() });
    expect(await restoreWorkspaceRecovery(syntheticWorkspace, syntheticInspection().inspection_id, syntheticRestoreTarget, abort.signal)).toEqual(syntheticRestoreReceipt());
    expect(jsonFetch).toHaveBeenCalledExactlyOnceWith("/api/workspace-recovery/restore", { method: "POST", body: JSON.stringify({ workspace: syntheticWorkspace, inspection_id: syntheticInspection().inspection_id, target_directory: syntheticRestoreTarget, confirmed: true }), signal: abort.signal });
  });
  it("release has an independent unsignalled request and requires released true", async () => {
    vi.mocked(jsonFetch).mockResolvedValue({ released: true }); await releaseWorkspaceRecovery(syntheticWorkspace, syntheticInspection().inspection_id);
    expect(jsonFetch).toHaveBeenCalledExactlyOnceWith("/api/workspace-recovery/release", { method: "POST", body: JSON.stringify({ workspace: syntheticWorkspace, inspection_id: syntheticInspection().inspection_id }) });
    vi.mocked(jsonFetch).mockResolvedValue({ released: false }); await expect(releaseWorkspaceRecovery(syntheticWorkspace, syntheticInspection().inspection_id)).rejects.toThrow("released");
  });
  it("releases a provisioned handle even when another inspection field is malformed", async () => {
    vi.mocked(jsonFetch).mockResolvedValueOnce({ ...syntheticInspection(), total_bytes: -1 }).mockResolvedValue({ released: true });
    await expect(inspectWorkspaceRecovery(syntheticWorkspace, syntheticBackupTarget)).rejects.toThrow("total_bytes");
    expect(vi.mocked(jsonFetch).mock.calls[1][0]).toBe("/api/workspace-recovery/release");
  });
  it.each([
    ["missing", {}], ["wrapped", { success: true, data: syntheticInspection() }], ["extra", { ...syntheticInspection(), proof: "client-proof" }],
    ["invalid-id", { ...syntheticInspection(), inspection_id: "not-issued" }], ["hash-prefix", { ...syntheticInspection(), manifest_sha256: `sha256:${"a".repeat(64)}` }],
    ["invalid-expiry", { ...syntheticInspection(), expires_at: "2030-01-01" }], ["empty-file-count", { ...syntheticInspection(), file_count: 0 }],
    ["oversized-files", { ...syntheticInspection(), file_count: 4097 }], ["oversized-directories", { ...syntheticInspection(), directory_count: 4097 }],
    ["negative-bytes", { ...syntheticInspection(), total_bytes: -1 }], ["fractional-bytes", { ...syntheticInspection(), total_bytes: 1.5 }],
    ["excess-bytes", { ...syntheticInspection(), total_bytes: 192 * 1024 * 1024 + 1 }], ["nonfinite-schema", { ...syntheticInspection(), database_schema_version: Infinity }],
  ])("rejects malformed inspection DTO %s", (_name, value) => { expect(() => validateWorkspaceRecoveryInspection(value)).toThrow("接口数据无效"); });
  it("retains unknown or null schema values instead of interpreting them as authorization to rebuild", () => {
    expect(validateWorkspaceRecoveryInspection(syntheticInspection()).database_schema_version).toBe(77);
    expect(validateWorkspaceRecoveryInspection({ ...syntheticInspection(), database_schema_version: null }).database_schema_version).toBeNull();
  });
  it.each(["relative", "/a/../b", "/a/./b", "/a//b", "/a/", "/a\n/b", "/a\u007f/b", " /absolute", "C:relative", ""]) ("rejects unsafe absolute path %j before requesting", async value => {
    expect(() => absoluteRecoveryDirectory(value)).toThrow(); await expect(backupWorkspaceRecovery(syntheticWorkspace, value)).rejects.toThrow(); expect(jsonFetch).not.toHaveBeenCalled();
  });
  it("accepts platform absolute directory syntax without guessing filesystem existence", () => {
    expect(absoluteRecoveryDirectory("/new-output/target")).toBe("/new-output/target");
    expect(absoluteRecoveryDirectory("C:\\new-output\\target")).toBe("C:\\new-output\\target");
    expect(absoluteRecoveryDirectory("\\\\server\\share\\target")).toBe("\\\\server\\share\\target");
  });
  it("joins a selected parent with a new name, never returns the parent as its target", () => {
    expect(joinNewRecoveryDirectory("/local-output", "new-backup")).toBe("/local-output/new-backup");
    expect(joinNewRecoveryDirectory("C:\\output", "new-backup")).toBe("C:\\output\\new-backup");
  });
  it.each(["/", "C:\\", "\\\\server\\share", "/output/CON", "/output/new.", "/output/ADS:name"])("refuses a root or unsafe manual new target %j before HTTP", async value => {
    expect(() => absoluteRecoveryTarget(value)).toThrow(); await expect(backupWorkspaceRecovery(syntheticWorkspace, value)).rejects.toThrow(); expect(jsonFetch).not.toHaveBeenCalled();
  });
  it.each(["", ".", "..", "nested/name", "nested\\name", "ADS:name", "CON", "new.", "new ", "x".repeat(256)])("refuses an unsafe new directory name %j", name => { expect(() => joinNewRecoveryDirectory("/local-output", name)).toThrow(); });
  it.each(["missing-receipt", "extra-proof", "wrong-schema", "unsafe-path", "bad-warning", "overflow-count"])("rejects malformed backup receipt %s", name => {
    const value: any = { receipt: syntheticBackupReceipt() };
    if (name === "missing-receipt") delete value.receipt;
    if (name === "extra-proof") value.proof = "client-proof";
    if (name === "wrong-schema") value.receipt.databaseSchemaVersion = "77";
    if (name === "unsafe-path") value.receipt.backupDirectory = "relative";
    if (name === "bad-warning") value.receipt.warnings = [2];
    if (name === "overflow-count") value.receipt.fileCount = 4097;
    expect(() => validateWorkspaceBackupReceipt(value)).toThrow();
  });
  it("accepts multiline server warnings and keeps them on confirmed restore receipts", () => {
    const receipt = { ...syntheticRestoreReceipt(), warnings: ["Published\nDirectory sync unconfirmed"] };
    expect(validateWorkspaceRestoreReceipt({ receipt })).toEqual(receipt);
    expect(() => validateWorkspaceRestoreReceipt({ receipt: { ...receipt, extra: true } })).toThrow();
  });
});
