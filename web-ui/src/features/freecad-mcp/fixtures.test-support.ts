import type { FreecadMcpInstallPlan, FreecadMcpStatus } from "../../../../shared/freecad-mcp/contracts";
export function syntheticStatus(): FreecadMcpStatus {
  return {
    schema_version: 1, revision: "synthetic-revision-1",
    settings: { mode: "owned_batch", mod_directory: "/synthetic-config/Mod", mod_directory_confirmed: true, existing_port: 9876 },
    freecad: { state: "available", executable: "/synthetic-program/FreeCAD", reason: "程序路径可用，不代表插件已加载" },
    mod_directory: { state: "filesystem_checked", evidence: "user_confirmed", reason: "用户确认的目录通过文件检查" },
    installation: { state: "absent", version: null, reason: "插件文件未安装" },
    resource: { state: "ready", version: "1.2.3", reason: "受信任资源已验证" },
    connection: { state: "not_checked", phase: "none", reason: "尚未检查", bridge_version: null, supported_methods: [], mcp_verified: false },
    batch: { state: "blocked", reason: "常驻 worker 待验收" },
  };
}
export function syntheticPlan(): FreecadMcpInstallPlan {
  return { state: "ready", reason: "安装计划已冻结", plan_id: "synthetic-plan-1", expires_at: "2030-01-01T00:05:00.000Z", operation: "install", source_version: "1.2.3", source_digest: "a".repeat(64), target: "/synthetic-config/Mod/PhoenixTools", backup_parent: "/synthetic-config/plugin-backups", changes: [{ path: "Init.py", kind: "add" }] };
}
