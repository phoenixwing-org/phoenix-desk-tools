import type { WorkspaceBackupReceipt, WorkspaceRecoveryInspection, WorkspaceRestoreReceipt } from "./types";

// Independent transport metadata, not a copied database, model or engineering list.
export const syntheticWorkspace = "/synthetic-workspace";
export const syntheticBackupTarget = "/local-output/backup-set";
export const syntheticRestoreTarget = "/local-output/restored-workspace";
export function syntheticInspection(): WorkspaceRecoveryInspection {
  return { inspection_id: "11111111-2222-4333-8444-555555555555", expires_at: "2030-01-01T00:10:00.000Z", backup_directory: syntheticBackupTarget, manifest_sha256: "a".repeat(64), file_count: 2, total_bytes: 128, directory_count: 2, database_schema_version: 77 };
}
export function syntheticBackupReceipt(): WorkspaceBackupReceipt {
  return { backupDirectory: syntheticBackupTarget, fileCount: 2, totalBytes: 128, databaseSchemaVersion: 77, warnings: [] };
}
export function syntheticRestoreReceipt(): WorkspaceRestoreReceipt {
  return { workspace: syntheticRestoreTarget, fileCount: 2, totalBytes: 128, warnings: [] };
}
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
