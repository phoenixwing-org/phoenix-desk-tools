import type { AssemblyMaintenanceInspection, AssemblyMaintenanceJointIssue, AssemblyPathStatus } from "../../../../shared/assembly-maintenance";

export function rigidIntentLabel(value: boolean | null): string {
  return value === true ? "刚性" : value === false ? "柔性" : "未知";
}
export function pathStatusLabel(status: AssemblyPathStatus): string {
  return ({ present: "路径存在（目标未验证）", missing: "路径缺失", local: "同文件（目标未验证）", outside_workspace: "工作空间外（未检查）", unknown: "未知（未检查）" })[status];
}
export function jointIssueLabel(issue: AssemblyMaintenanceJointIssue): string {
  return issue.reason === "empty_reference" ? "引用端为空，需人工核对" : `本地对象不存在：${issue.target_object_name || "未知"}`;
}
export function inspectionLogs(result: AssemblyMaintenanceInspection): Array<{ message: string; problem: boolean }> {
  const problem = result.summary.missing_path_count > 0 || result.joint_issues.length > 0;
  const logs = [{
    message: `[装配检查] ${result.rel}：${result.links.length} 个子装配链接，${result.summary.missing_path_count} 个缺失路径，${result.joint_issues.length} 个关节端点待核对；仅检查已保存信息，子装配同步状态未验证。`,
    problem,
  }];
  for (const link of result.links) if (link.path_status === "missing") logs.push({
    message: `[装配检查] ${link.label || link.object_name} (${link.object_name})：路径缺失 · ${link.target_file || "未知路径"}`, problem: true,
  });
  for (const issue of result.joint_issues) logs.push({
    message: `[装配检查] ${issue.label || issue.object_name} (${issue.object_name}) · ${issue.reference}：${jointIssueLabel(issue)}；不自动删除或重连 Joint。`, problem: true,
  });
  for (const warning of result.warnings) logs.push({ message: `[装配检查] ${warning}`, problem: false });
  return logs;
}
