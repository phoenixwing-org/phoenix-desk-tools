import type { ReferenceLabelChange } from "../api";

export type ReferenceLabelApplyResult = {
  label_patches?: number;
  label_changes?: ReferenceLabelChange[];
  applied_hosts?: string[];
  failed?: Array<{ host_repo_rel_path: string; error: string }>;
};

function basenameFromAttr(attr: string): string {
  const norm = attr.replace(/\\/g, "/").trim();
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

export function formatReferenceLabelChange(row: ReferenceLabelChange): string {
  const target = basenameFromAttr(row.xlink_file_attr);
  return `${target} · ${row.old_label} → ${row.new_label}`;
}

export function logReferenceLabelApply(
  appendLog: (text: string, opts?: { source?: string; open?: boolean }) => void,
  data: ReferenceLabelApplyResult,
  opts: { source: string; title: string },
): string {
  const changes = data.label_changes ?? [];
  const count = data.label_patches ?? changes.length;
  const failed = data.failed ?? [];

  if (!count && !failed.length) {
    const msg = `${opts.title} · 无需修改（已与规则名一致）`;
    appendLog(msg, { source: opts.source, open: true });
    return msg;
  }

  appendLog(`${opts.title} · ${count} 处`, { source: opts.source, open: true });
  for (const row of changes) {
    appendLog(`  ${formatReferenceLabelChange(row)}`, { source: opts.source });
  }
  for (const f of failed) {
    appendLog(`  ✗ ${f.host_repo_rel_path}: ${f.error}`, { source: opts.source });
  }

  const summary =
    `${opts.title} · ${count} 处` +
    (failed.length ? ` · ${failed.length} 失败` : "");
  return summary;
}
