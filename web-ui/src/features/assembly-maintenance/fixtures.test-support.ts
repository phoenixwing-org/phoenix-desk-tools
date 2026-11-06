import type { AssemblyMaintenanceInspection } from "../../../../shared/assembly-maintenance";

// Independent synthetic saved metadata; no engineering documents or native runtime.
export function syntheticInspection(): AssemblyMaintenanceInspection {
  return {
    protocol_version: 1, rel: "examples/SampleAssembly.FCStd", scope: "current_saved_file", synchronization: "not_checked",
    source: { sha256: "a".repeat(64), bytes: 120, mtime_ms: 1700000000000 },
    links: [{ object_name: "AssemblyLink", label: "Example component", rigid: true, target_file: "../parts/Sample.FCStd", target_object_name: "Body", target_rel: "parts/Sample.FCStd", path_status: "present" }],
    joint_issues: [], summary: { assembly_link_count: 1, joint_issue_count: 0, missing_path_count: 0, unknown_path_count: 0 },
    warnings: [], update: { available: false, reason_code: "native_refresh_not_validated", message: "装配原生更新尚未验收；不自动切换 Rigid。" },
  };
}
