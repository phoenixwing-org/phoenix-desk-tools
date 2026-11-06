/** Current saved-file observations, never a native synchronization certificate. */
export type AssemblyPathStatus = "present" | "missing" | "local" | "outside_workspace" | "unknown";
export interface AssemblyMaintenanceLink {
  object_name: string;
  label: string;
  rigid: boolean | null;
  target_file: string | null;
  target_object_name: string | null;
  target_rel: string | null;
  path_status: AssemblyPathStatus;
}
export interface AssemblyMaintenanceJointIssue {
  object_name: string;
  label: string;
  reference: "Reference1" | "Reference2";
  reason: "empty_reference" | "missing_local_object";
  target_object_name: string | null;
}
export interface AssemblyMaintenanceInspection {
  protocol_version: 1;
  rel: string;
  scope: "current_saved_file";
  synchronization: "not_checked";
  source: { sha256: string; bytes: number; mtime_ms: number };
  links: AssemblyMaintenanceLink[];
  joint_issues: AssemblyMaintenanceJointIssue[];
  summary: { assembly_link_count: number; joint_issue_count: number; missing_path_count: number; unknown_path_count: number };
  warnings: string[];
  /** Inspection alone is never a publication ticket. A separate Native preview
   * is required; the legacy reason remains readable for old saved responses. */
  update: { available: false; reason_code: "requires_verified_preview" | "native_refresh_not_validated"; message: string };
}

export interface AssemblyUpdateDifference {
  object_name: string;
  label: string;
  type_id: string;
  parent_object: string;
}
/** This preview is authority to publish one frozen, independently reopened
 * stage; it is not a workspace scan or a permission to rerun Native. */
export interface AssemblyUpdatePreview {
  added: AssemblyUpdateDifference[];
  removed: AssemblyUpdateDifference[];
  preserved_joint_count: number;
  preserved_instance_count: number;
  rigid_unchanged: true;
  placements_unchanged: true;
  joint_frames_unchanged: true;
  dependency_bytes_unchanged: true;
  independently_reopened: true;
  engine_version: string;
}
export type AssemblyUpdateStatus = "preparing" | "ready" | "unchanged" | "blocked" | "failed" | "cancelled" | "published" | "needs_reconcile";
export type AssemblyUpdatePhase = "capturing" | "mirroring" | "native_update" | "native_reopen" | "ready" | "publishing" | "completed";
export interface AssemblyUpdateJob {
  protocol_version: 1;
  id: string;
  file_path: string;
  selected_objects: string[];
  status: AssemblyUpdateStatus;
  phase: AssemblyUpdatePhase;
  created_at: string;
  expires_at: string | null;
  source_sha256: string | null;
  preview: AssemblyUpdatePreview | null;
  can_publish: boolean;
  suggested_copy_rel: string | null;
  output_rel: string | null;
  backup_rel: string | null;
  error: { code: string; message: string } | null;
  warnings: string[];
}

/** Read-only, bounded disk observation. Never a restored publish capability. */
export interface AssemblyUpdateReconciliation {
  protocol_version: 1;
  id: string;
  read_only: true;
  can_publish: false;
  operation: { file_path: string; status: AssemblyUpdateJob["status"]; phase: AssemblyUpdatePhase; created_at: string; output_rel: string | null } | null;
  observed_publication: "published_observed" | "not_published_observed" | "unknown";
  receipt_state: "absent" | "intent" | "source_claimed" | "published" | "failure" | "unknown";
  source_state: "original" | "updated" | "other" | "missing" | "unknown";
  target_state: "verified" | "other" | "missing" | "unknown";
  backup_state: "verified" | "other" | "missing" | "unknown";
  dependencies_state: "unchanged" | "changed" | "unknown";
  requires_manual_review: boolean;
  message: string;
}
