import { createHash } from "node:crypto";
import path from "node:path";
import { createAssemblyTreeReader } from "./pnwBomXrefService.js";
import { fcstdFingerprint, fcstdWorkspace, readFcstdBatchArchive, safeFcstdPath } from "./fcstdBatchFiles.js";
import { inspectFcstdBatchTarget } from "./fcstdDocumentXmlService.js";
import { fcstdLinkInstances } from "./fcstdLinkIdentity.js";
import { drawingLinkLabelAttributes } from "./fcstdDrawing.js";
import type { ObjectLabelPatch } from "./fcstdReferenceLabelService.js";

export type IncomingLabelSource = {
  xlink_file_attr: string;
  target_repo_rel_path: string | null;
  resolve_status: string;
};
export type IncomingObjectLabelPlan = {
  expectations: ObjectLabelPatch[];
  patches: ObjectLabelPatch[];
  skipped: Array<{ host_repo_rel_path: string; xlink_file_attr: string; reason: string }>;
  sources: Array<{ repo_rel_path: string; fingerprint: string }>;
};
type ProjectedInstance = ObjectLabelPatch & {
  rule_label: string; rule_error: string; link_label: string;
  direct_target_repo_rel?: string;
};
type ProjectedNode = {
  host_repo_rel?: string; label_editable?: boolean; label_edit_reason?: string;
  xref_instances?: ProjectedInstance[]; children?: ProjectedNode[];
};
const normalized = (rel: string) => rel.replace(/\\/g, "/").replace(/^\.\//, "");
const key = (instance: Pick<ObjectLabelPatch, "host_object_name" | "target_object_name" | "xlink_file_attr">) =>
  JSON.stringify([instance.host_object_name, instance.target_object_name, instance.xlink_file_attr]);

/** Adapt the existing live assembly recommendation; do not derive named-object
 * labels from a file-level index rule, and never widen the incoming scope. */
export function inspectIncomingObjectLabels(root: string, host: string, sources: IncomingLabelSource[], targetPaths: string[] = []): IncomingObjectLabelPlan {
  root = fcstdWorkspace(root);
  host = normalized(host);
  const archive = readFcstdBatchArchive(safeFcstdPath(root, host));
  const documentHash = createHash("sha256").update(archive.xml).digest("hex");
  const allowed = drawingLinkLabelAttributes(host, archive.xml);
  const plan: IncomingObjectLabelPlan = { expectations: [], patches: [], skipped: [], sources: [] };
  const sourceXml = new Map<string, string>();
  // Bind the proof to the exact bounded archive supplying the live algorithm,
  // including chained projections and other siblings used for numbering.
  const readDocumentXml = (filename: string): string => {
    const rel = normalized(path.relative(root, filename));
    if (rel === host) return archive.xml; // Host already has its XML guard.
    if (!sourceXml.has(rel)) {
      const source = readFcstdBatchArchive(safeFcstdPath(root, rel));
      sourceXml.set(rel, source.xml);
      plan.sources.push({ repo_rel_path: rel, fingerprint: fcstdFingerprint(source.bytes) });
    }
    return sourceXml.get(rel)!;
  };
  const byAttr = new Map<string, IncomingLabelSource>();
  for (const source of sources) {
    if (allowed && !allowed.has(source.xlink_file_attr)) {
      plan.skipped.push({ host_repo_rel_path: host, xlink_file_attr: source.xlink_file_attr,
        reason: "独立图纸未找到可同步的装配实例 Label，已跳过" });
      continue;
    }
    const previous = byAttr.get(source.xlink_file_attr);
    if (previous && normalized(previous.target_repo_rel_path || "") !== normalized(source.target_repo_rel_path || "")) {
      throw new Error("同一引用路径对应多个目标，需重新分析");
    }
    byAttr.set(source.xlink_file_attr, source);
  }
  if (!byAttr.size) return plan;
  const instances = fcstdLinkInstances(archive.xml).filter(instance => byAttr.has(instance.xlink_file_attr));
  for (const attr of byAttr.keys()) if (!instances.some(instance => instance.xlink_file_attr === attr)) {
    throw new Error(`未找到可定位的引用实例 Label：${attr}`);
  }
  const projected = new Map<string, { instance: ProjectedInstance; node: ProjectedNode }>();
  if (instances.some(instance => instance.target_object_name)) {
    const tree = createAssemblyTreeReader(root, host, { readDocumentXml })(host, { full: false });
    if (tree.index_pending) throw new Error("缺少 CAD 引用索引，请先更新 CAD 索引");
    const stack: ProjectedNode[] = [...tree.nodes];
    while (stack.length) {
      const node = stack.pop()!;
      stack.push(...(node.children || []));
      if (normalized(node.host_repo_rel || "") !== host) continue;
      for (const instance of node.xref_instances || []) {
        const identity = key(instance);
        if (projected.has(identity)) throw new Error(`引用对象不唯一：${instance.host_object_name}`);
        projected.set(identity, { instance, node });
      }
    }
  }
  const seen = new Set<string>();
  for (const instance of instances) {
    const identity = key(instance), source = byAttr.get(instance.xlink_file_attr)!;
    if (seen.has(identity)) throw new Error(`引用对象不唯一：${instance.host_object_name}`);
    seen.add(identity);
    const targetRel = normalized(source.target_repo_rel_path || "");
    if (source.resolve_status !== "resolved" || !targetRel || (targetPaths.length && !targetPaths.map(normalized).includes(targetRel))) {
      throw new Error(`引用目标未唯一解析到本次改名对象：${instance.host_object_name}`);
    }
    let label: string;
    if (instance.target_object_name) {
      const current = projected.get(identity);
      if (!current || !current.node.label_editable || current.instance.rule_error || !current.instance.rule_label
        || current.instance.document_hash !== documentHash || normalized(current.instance.direct_target_repo_rel || "") !== targetRel) {
        throw new Error(`引用对象无法安全推荐标签：${instance.host_object_name}；${current?.instance.rule_error || current?.node.label_edit_reason || "目标对象缺失或内容已变化"}`);
      }
      label = current.instance.rule_label;
    } else {
      // Older serializers omit name. Only a demonstrably unique real model
      // root may supply its Label; missing/ambiguous roots never use DB guesses.
      if (instances.filter(item => item.xlink_file_attr === instance.xlink_file_attr).length !== 1) {
        throw new Error("重复实例缺少目标对象身份，需在文件详情逐对象确认标签");
      }
      // A historical basename-resolved index edge is not proof of the current
      // disk reference. Never read another file's root to fill this instance.
      const actualRel = normalized(path.relative(root, path.resolve(root, path.posix.dirname(host), instance.xlink_file_attr.replace(/\\/g, "/"))));
      const actualPath = safeFcstdPath(root, actualRel);
      if (actualPath !== safeFcstdPath(root, targetRel)) throw new Error("真实引用路径与索引目标不一致，请先修正引用路径或重新分析");
      const target = inspectFcstdBatchTarget(readDocumentXml(actualPath));
      label = target.current.label.trim();
      if (!label) throw new Error("唯一源模型没有有效 Label，未生成推荐标签");
    }
    const patch: ObjectLabelPatch = { host_object_name: instance.host_object_name, target_object_name: instance.target_object_name,
      xlink_file_attr: instance.xlink_file_attr, old_label: instance.link_label, link_label: label, document_hash: documentHash };
    plan.expectations.push(patch);
    if (patch.old_label !== patch.link_label) plan.patches.push(patch);
  }
  verifyIncomingLabelSources(root, plan);
  return plan;
}

/** Local source guards only; they are never accepted from an HTTP client or
 * used to rename/write a target. The source archive must remain byte-identical. */
export function verifyIncomingLabelSources(root: string, plan: Pick<IncomingObjectLabelPlan, "sources">): void {
  root = fcstdWorkspace(root);
  for (const source of plan.sources) {
    try {
      if (fcstdFingerprint(readFcstdBatchArchive(safeFcstdPath(root, source.repo_rel_path)).bytes) !== source.fingerprint) throw new Error("source changed");
    } catch {
      throw new Error(`源模型在标签推荐后已变化或不可读，请重新确认：${source.repo_rel_path}`);
    }
  }
}

/** The file-level xref rule cannot certify labels of subobjects or numbered
 * siblings. Re-read the exact on-disk object identities instead. */
export function verifyIncomingObjectLabels(root: string, host: string, expectations: ObjectLabelPatch[]): void {
  if (!expectations.length) return;
  root = fcstdWorkspace(root);
  const instances = fcstdLinkInstances(readFcstdBatchArchive(safeFcstdPath(root, host)).xml);
  for (const expected of expectations) {
    const matching = instances.filter(instance => key(instance) === key(expected));
    if (matching.length !== 1 || matching[0].link_label !== expected.link_label) {
      throw new Error(`引用对象标签尚未与预期一致：${expected.host_object_name} → ${expected.target_object_name || "唯一主实体"}`);
    }
  }
}
