import type { AssemblyUpdateJob, AssemblyUpdateReconciliation } from "../../../../shared/assembly-maintenance";
export function syntheticUpdateJob(file = "examples/Assembly.FCStd", patch: Partial<AssemblyUpdateJob> = {}): AssemblyUpdateJob {
  return { protocol_version: 1, id: "00000000-0000-4000-a000-000000000001", file_path: file, selected_objects: ["Selected"],
    status: "ready", phase: "ready", created_at: "2026-01-01T00:00:00.000Z", expires_at: "2026-01-01T00:10:00.000Z", source_sha256: "a".repeat(64),
    preview: { added: [{ object_name: "NewCopy", label: "Independent copy", type_id: "App::Link", parent_object: "Selected" }], removed: [],
      preserved_instance_count: 2, preserved_joint_count: 1, rigid_unchanged: true, placements_unchanged: true, joint_frames_unchanged: true,
      dependency_bytes_unchanged: true, independently_reopened: true, engine_version: "synthetic" },
    can_publish: true, suggested_copy_rel: "examples/Assembly.verified.FCStd", output_rel: null, backup_rel: null, error: null, warnings: [], ...patch };
}
export function syntheticReconciliation(patch: Partial<AssemblyUpdateReconciliation> = {}): AssemblyUpdateReconciliation {
  return { protocol_version: 1, id: "00000000-0000-4000-a000-000000000001", read_only: true, can_publish: false, operation: null,
    observed_publication: "unknown", receipt_state: "unknown", source_state: "unknown", target_state: "unknown", backup_state: "unknown", dependencies_state: "unknown",
    requires_manual_review: true, message: "只读观察，不恢复写入权限", ...patch };
}
