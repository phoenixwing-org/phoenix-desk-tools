export type WorkspaceRecoveryInspection = {
  inspection_id: string;
  expires_at: string;
  backup_directory: string;
  manifest_sha256: string;
  file_count: number;
  total_bytes: number;
  directory_count: number;
  database_schema_version: number | null;
};
export type WorkspaceBackupReceipt = {
  backupDirectory: string;
  fileCount: number;
  totalBytes: number;
  databaseSchemaVersion: number | null;
  warnings: string[];
};
export type WorkspaceRestoreReceipt = {
  workspace: string;
  fileCount: number;
  totalBytes: number;
  warnings: string[];
};
export type WorkspaceRecoveryOutcome =
  | { operation: "backup"; receipt: WorkspaceBackupReceipt }
  | { operation: "restore"; receipt: WorkspaceRestoreReceipt };
export type WorkspaceRecoveryPhase = "idle" | "choosing" | "inspecting" | "confirming-backup" | "confirming-restore" | "backing-up" | "restoring";
export type WorkspaceRecoveryStatus = "idle" | "checked" | "expired" | "backup-complete" | "restore-complete" | "failed" | "cancelled" | "unconfirmed";
export type WorkspaceRecoverySettings = { workspace: string; backupTarget: string; backupDirectory: string; restoreTarget: string };
