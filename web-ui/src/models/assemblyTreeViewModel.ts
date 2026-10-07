import {
  linkLabelsEqual,
  resolveRuleLabelForNode,
  type RuleLabelNodeFields,
} from "../utils/fcstdRuleLabel";

export interface AssemblyTreeInstanceViewInput {
  readonly resolved_target_repo_rel?: string;
  readonly resolved_target_object_name?: string;
  readonly direct_target_repo_rel?: string;
  readonly xlink_file_attr: string;
  readonly link_label?: string;
  readonly host_object_name?: string;
  readonly target_object_name?: string;
  readonly rule_label?: string;
  readonly rule_error?: string;
  readonly document_hash?: string;
}

export interface AssemblyTreeNodeViewInput extends RuleLabelNodeFields {
  readonly id: string;
  readonly host_repo_rel?: string;
  readonly repo_rel_path?: string;
  readonly resolve_status?: string;
  readonly xlink_file_attr?: string;
  readonly link_label?: string;
  readonly xref_instances?: readonly AssemblyTreeInstanceViewInput[];
  readonly ref_count?: number;
  readonly file_role?: string;
  readonly structure_source?: "host_objects";
  readonly label_editable?: boolean;
}

export interface AssemblyTreeFlatRow<T extends AssemblyTreeNodeViewInput> {
  readonly node: T;
  readonly depth: number;
  readonly position: string;
}

export interface AssemblyTreeInstanceRow<T extends AssemblyTreeNodeViewInput> {
  readonly node: T;
  readonly depth: number;
  readonly instance: AssemblyTreeInstanceViewInput;
  readonly instanceIndex: number;
}

export interface AssemblyTreeLabelPatch {
  readonly host_repo_rel: string;
  readonly xlink_file_attr: string;
  readonly link_label: string;
  readonly host_object_name?: string;
  readonly target_object_name?: string;
  readonly old_label?: string;
  readonly document_hash?: string;
}

export interface AssemblyTreeLabelChange {
  readonly host_repo_rel: string;
  readonly xlink_file_attr: string;
  readonly old_label: string;
  readonly new_label: string;
  readonly host_object_name?: string;
  readonly target_object_name?: string;
  readonly document_hash?: string;
}

export interface AssemblyTreeRulePreview {
  readonly edits: ReadonlyMap<string, string>;
  readonly filled: number;
  readonly unchanged: number;
  readonly noRule: number;
}

export type AssemblyTreeChildren<T extends AssemblyTreeNodeViewInput> = (node: T) => readonly T[];

export function assemblyTreeEditKey(host: string, attr: string, instance?: Pick<AssemblyTreeInstanceViewInput, "host_object_name" | "target_object_name">): string {
  return `${host}\x00${attr}` + (instance?.host_object_name ? `\x00${instance.host_object_name}\x00${instance.target_object_name ?? ""}` : "");
}

export function assemblyTreeInstancesOf(
  node: AssemblyTreeNodeViewInput,
): readonly AssemblyTreeInstanceViewInput[] {
  if (node.xref_instances?.length) return node.xref_instances;
  const attr = node.xlink_file_attr?.trim();
  if (!attr) return [];
  return [{ xlink_file_attr: attr, link_label: node.link_label ?? "" }];
}

export function assemblyTreeBaselineLabel(instance: AssemblyTreeInstanceViewInput): string {
  return instance.link_label ?? "";
}

export function assemblyTreeDisplayLabel(
  edits: ReadonlyMap<string, string>,
  host: string,
  instance: AssemblyTreeInstanceViewInput,
): string {
  const key = assemblyTreeEditKey(host, instance.xlink_file_attr, instance);
  return edits.get(key) ?? assemblyTreeBaselineLabel(instance);
}

export function assemblyTreeIsLabelEdited(
  edits: ReadonlyMap<string, string>,
  host: string,
  instance: AssemblyTreeInstanceViewInput,
): boolean {
  const key = assemblyTreeEditKey(host, instance.xlink_file_attr, instance);
  const value = edits.get(key);
  return value !== undefined && !linkLabelsEqual(value, assemblyTreeBaselineLabel(instance));
}

export function assemblyTreeWithLabelEdit(
  edits: ReadonlyMap<string, string>,
  host: string,
  instance: AssemblyTreeInstanceViewInput,
  value: string,
): Map<string, string> {
  const next = new Map(edits);
  const key = assemblyTreeEditKey(host, instance.xlink_file_attr, instance);
  if (linkLabelsEqual(value, assemblyTreeBaselineLabel(instance))) next.delete(key);
  else next.set(key, value);
  return next;
}

export function assemblyTreeIsMissing(node: AssemblyTreeNodeViewInput): boolean {
  return node.resolve_status === "missing";
}

export function assemblyTreeIsResolved(node: AssemblyTreeNodeViewInput): boolean {
  const status = node.resolve_status;
  return status === "resolved" || status === "ok" || status === "present" || status === "self";
}

export function assemblyTreeIsUnresolved(node: AssemblyTreeNodeViewInput): boolean {
  return node.resolve_status === "missing" || node.resolve_status === "ambiguous";
}

export function assemblyTreeIsAssembly(node: AssemblyTreeNodeViewInput): boolean {
  if (node.structure_source === "host_objects" && node.file_role) return node.file_role === "assembly";
  if (node.file_role === "assembly") return true;
  return /\.assy\.fcstd$/iu.test(node.basename || node.repo_rel_path || "");
}

export function assemblyTreeCanEditLabel(
  node: AssemblyTreeNodeViewInput,
  editable: boolean,
): boolean {
  return editable && node.label_editable !== false && !assemblyTreeIsUnresolved(node);
}

export function assemblyTreeCanLoadSourceChildren(node: AssemblyTreeNodeViewInput): boolean {
  return node.structure_source !== "host_objects" && assemblyTreeIsAssembly(node);
}

/** The same already-loaded recommendation drives both passive hints and explicit fill. */
export function assemblyTreeLabelRecommendation(
  node: AssemblyTreeNodeViewInput, instance: AssemblyTreeInstanceViewInput,
): string {
  if (instance.rule_error || !assemblyTreeCanEditLabel(node, true)) return "";
  // Never substitute the file root for a named target that has no safe rule.
  return instance.host_object_name ? instance.rule_label?.trim() ?? "" : resolveRuleLabelForNode(node);
}

export function assemblyTreeLabelDiffersFromRule(
  node: AssemblyTreeNodeViewInput, instance: AssemblyTreeInstanceViewInput,
  current = assemblyTreeBaselineLabel(instance),
): boolean {
  const recommendation = assemblyTreeLabelRecommendation(node, instance);
  return Boolean(recommendation && !linkLabelsEqual(current, recommendation));
}

/** Display/open the actual part while keeping direct XLink data for writes. */
export function assemblyTreeTargetFile(node: AssemblyTreeNodeViewInput, instance = assemblyTreeInstancesOf(node)[0]) {
  const normalize = (rel: string) => rel.replace(/\\/g, "/").replace(/^\.\//, "");
  const direct = instance?.direct_target_repo_rel || node.repo_rel_path || "";
  const resolved = instance?.resolved_target_repo_rel;
  const repoRelPath = resolved || direct;
  const basename = resolved ? normalize(resolved).split("/").at(-1) ?? "" : node.basename ?? "";
  const viaRepoRelPath = resolved && direct && normalize(resolved) !== normalize(direct) ? direct : "";
  return { repoRelPath, basename, viaRepoRelPath, viaBasename: normalize(viaRepoRelPath).split("/").at(-1) ?? "" };
}

export function assemblyTreeFlatten<T extends AssemblyTreeNodeViewInput>(
  nodes: readonly T[],
  expanded: ReadonlySet<string>,
  childrenOf: AssemblyTreeChildren<T>,
  depth = 0,
  out: AssemblyTreeFlatRow<T>[] = [],
  prefix = "",
): AssemblyTreeFlatRow<T>[] {
  for (const [index, node] of nodes.entries()) {
    const position = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
    out.push({ node, depth, position });
    const children = childrenOf(node);
    if (expanded.has(node.id) && children.length) {
      assemblyTreeFlatten(children, expanded, childrenOf, depth + 1, out, position);
    }
  }
  return out;
}

export function assemblyTreeInstanceRows<T extends AssemblyTreeNodeViewInput>(
  node: T,
  depth: number,
  expandedLabels: ReadonlySet<string>,
): AssemblyTreeInstanceRow<T>[] {
  const instances = assemblyTreeInstancesOf(node);
  if (!expandedLabels.has(node.id) || instances.length <= 1) return [];
  return instances.slice(1).map((instance, index) => ({
    node,
    depth,
    instance,
    instanceIndex: index + 1,
  }));
}

export function walkAssemblyTree<T extends AssemblyTreeNodeViewInput>(
  nodes: readonly T[],
  childrenOf: AssemblyTreeChildren<T>,
  visit: (node: T) => void,
): void {
  for (const node of nodes) {
    visit(node);
    const children = childrenOf(node);
    if (children.length) walkAssemblyTree(children, childrenOf, visit);
  }
}

export function assemblyTreeRole(node: AssemblyTreeNodeViewInput): string {
  if (node.file_role?.trim()) return node.file_role.trim();
  return assemblyTreeIsAssembly(node) ? "assembly" : "part";
}

export function assemblyTreeRoleLabel(role: string): string {
  return ({ part: "零件", drawing: "工程图", assembly: "装配" } as Readonly<Record<string, string>>)[role] ?? role;
}

export function assemblyTreeStatusLabel(status: string | undefined): string {
  if (status === "ok" || status === "present" || status === "resolved") return "已解析";
  if (status === "missing") return "缺失";
  if (status === "ambiguous") return "歧义";
  if (status === "self") return "自身";
  return status || "—";
}

export function assemblyTreeRowStatusClass(node: AssemblyTreeNodeViewInput): string {
  if (node.resolve_status === "missing") return "row-missing";
  if (node.resolve_status === "ambiguous") return "row-ambiguous";
  return "";
}

export function assemblyTreePrimaryXlinkAttr(node: AssemblyTreeNodeViewInput): string {
  return assemblyTreeInstancesOf(node)[0]?.xlink_file_attr?.trim()
    || node.xlink_file_attr?.trim()
    || "";
}

export function assemblyTreeMissingRowTitle(node: AssemblyTreeNodeViewInput): string {
  const attr = assemblyTreePrimaryXlinkAttr(node);
  return attr ? `链接缺失 · ${attr}` : "链接缺失";
}

export function assemblyTreeToggleVisualState(
  node: AssemblyTreeNodeViewInput,
  expanded: ReadonlySet<string>,
  loading: ReadonlySet<string>,
  hasSubtree: boolean,
): "loading" | "expanded" | "collapsed" | "lazy" | "leaf" {
  if (loading.has(node.id)) return "loading";
  if (hasSubtree) return expanded.has(node.id) ? "expanded" : "collapsed";
  if (assemblyTreeCanLoadSourceChildren(node)) return "lazy";
  return "leaf";
}

export function assemblyTreeToggleAriaLabel(
  node: AssemblyTreeNodeViewInput,
  expanded: ReadonlySet<string>,
  loading: ReadonlySet<string>,
  hasSubtree: boolean,
): string {
  if (loading.has(node.id)) return "加载子件";
  if (hasSubtree) return expanded.has(node.id) ? "折叠子件" : "展开子件";
  return assemblyTreeCanLoadSourceChildren(node) ? "加载并展开该装配的下级子件" : "无子件";
}

export function assemblyTreePendingChanges<T extends AssemblyTreeNodeViewInput>(
  nodes: readonly T[],
  edits: ReadonlyMap<string, string>,
  childrenOf: AssemblyTreeChildren<T>,
): AssemblyTreeLabelChange[] {
  const changes: AssemblyTreeLabelChange[] = [];
  const seen = new Set<string>();
  walkAssemblyTree(nodes, childrenOf, (node) => {
    if (!assemblyTreeCanEditLabel(node, true)) return;
    const host = node.host_repo_rel?.trim();
    if (!host) return;
    for (const instance of assemblyTreeInstancesOf(node)) {
      const attr = instance.xlink_file_attr?.trim();
      if (!attr) continue;
      const key = assemblyTreeEditKey(host, attr, instance);
      if (seen.has(key)) continue;
      seen.add(key);
      const value = edits.get(key);
      if (value === undefined) continue;
      changes.push({
        host_repo_rel: host,
        xlink_file_attr: attr,
        old_label: assemblyTreeBaselineLabel(instance),
        new_label: value.trim(),
        ...(instance.host_object_name ? { host_object_name: instance.host_object_name, target_object_name: instance.target_object_name ?? "", document_hash: instance.document_hash } : {}),
      });
    }
  });
  return changes;
}

export function assemblyTreePendingPatches<T extends AssemblyTreeNodeViewInput>(
  nodes: readonly T[],
  edits: ReadonlyMap<string, string>,
  childrenOf: AssemblyTreeChildren<T>,
): AssemblyTreeLabelPatch[] {
  return assemblyTreePendingChanges(nodes, edits, childrenOf)
    .filter((change) => !linkLabelsEqual(change.new_label, change.old_label))
    .map(({ host_repo_rel, xlink_file_attr, new_label, old_label, host_object_name, target_object_name, document_hash }) => ({
      host_repo_rel,
      xlink_file_attr,
      link_label: new_label,
      ...(host_object_name ? { host_object_name, target_object_name, old_label, document_hash } : {}),
    }));
}

export function assemblyTreeApplyRuleLabels<T extends AssemblyTreeNodeViewInput>(
  nodes: readonly T[],
  edits: ReadonlyMap<string, string>,
  childrenOf: AssemblyTreeChildren<T>,
): AssemblyTreeRulePreview {
  const next = new Map(edits);
  let filled = 0;
  let unchanged = 0;
  let noRule = 0;
  const seen = new Set<string>();
  walkAssemblyTree(nodes, childrenOf, (node) => {
    if (!assemblyTreeCanEditLabel(node, true)) {
      noRule += assemblyTreeInstancesOf(node).filter(instance => instance.rule_error).length;
      return;
    }
    const host = node.host_repo_rel?.trim();
    if (!host) return;
    for (const instance of assemblyTreeInstancesOf(node)) {
      const attr = instance.xlink_file_attr?.trim();
      if (!attr) continue;
      const key = assemblyTreeEditKey(host, attr, instance);
      if (seen.has(key)) continue;
      seen.add(key);
      // Empty object-specific rules deliberately prohibit file-root fallback.
      const rule = assemblyTreeLabelRecommendation(node, instance);
      if (!rule || instance.rule_error) { noRule++; continue; }
      const current = assemblyTreeDisplayLabel(edits, host, instance);
      if (linkLabelsEqual(rule, assemblyTreeBaselineLabel(instance))) {
        unchanged += 1;
        next.delete(key);
      } else if (linkLabelsEqual(rule, current)) {
        // Repeated preview must keep the unsaved recommendation, not undo it.
        unchanged += 1;
      } else {
        next.set(key, rule);
        filled += 1;
      }
    }
  });
  return { edits: next, filled, unchanged, noRule };
}

/** Keep other rows and failed requests when a single row is applied/reloaded. */
export function assemblyTreeRemainingPatches(
  all: readonly AssemblyTreeLabelPatch[], submitted: readonly AssemblyTreeLabelPatch[],
  failed: readonly { host_repo_rel: string }[],
): AssemblyTreeLabelPatch[] {
  if (failed.some(item => !item.host_repo_rel)) return [...all];
  const failedHosts = new Set(failed.map(item => item.host_repo_rel.replace(/^\.\//, "")));
  const saved = new Set(submitted.filter(patch => !failedHosts.has(patch.host_repo_rel.replace(/^\.\//, "")))
    .map(patch => assemblyTreeEditKey(patch.host_repo_rel, patch.xlink_file_attr, patch)));
  return all.filter(patch => !saved.has(assemblyTreeEditKey(patch.host_repo_rel, patch.xlink_file_attr, patch)));
}
