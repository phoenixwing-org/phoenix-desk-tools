import type { BomPreview } from "../api";
import type { PagePrimarySection } from "../composables/usePagePrimaryContribution";

export function assemblyRigidPrimary(preview: BomPreview | null): PagePrimarySection[] {
  if (!preview || preview.bom_readonly) return [];
  const sections: PagePrimarySection[] = [];
  const links = preview.assembly_links || [];
  if (preview.document_kinds?.assembly || links.length) sections.push({
    id: "assembly-rigid", title: "子装配 Rigid（刚性）", readonlyLayout: "properties",
    description: links.length
      ? "已保存的实例状态；更新 CAD 索引时记入数据库。\n是：整体刚体；否：内部关节参与运动和求解。未知：未读取到有效 Rigid。\n这里只读展示，不切换刚柔性；它不是链接是否已同步的判定。"
      : "未发现 Assembly::AssemblyLink 子装配实例。Rigid 属于子装配实例，不是整个 ASSY 的属性；旧索引可重新更新。",
    controls: links.map(link => ({
      id: `rigid-${link.object_name}`, kind: "readonly", label: link.label === link.object_name ? link.object_name : `${link.label}（${link.object_name}）`,
      value: link.rigid === true ? "是 · 刚性" : link.rigid === false ? "否 · 柔性" : "未知",
      description: [link.target_file, link.target_object_name].filter(Boolean).join(" → "),
    })),
  });
  const issues = preview.assembly_joint_issues || [];
  if (issues.length) sections.push({
    id: "assembly-joint-issues", title: "关节连接需确认", readonlyLayout: "properties",
    description: "已保存的关节存在空连接端或缺失本地对象，不能自动猜接或删除。这里只检查明确失联，不代表已验证外部引用、子路径或求解状态；详见 Bottom 运行日志。",
    controls: issues.map(issue => ({ id: `joint-${issue.object_name}-${issue.reference}`, kind: "readonly",
      label: `${issue.label} · ${issue.reference}`, value: assemblyJointIssueText(issue) })),
  });
  return sections;
}

export function assemblyJointIssueText(issue: NonNullable<BomPreview["assembly_joint_issues"]>[number]): string {
  return issue.reason === "empty_reference" ? "连接端为空，需人工确认" : `本地目标对象已不存在：${issue.target_object_name || "未知"}`;
}
