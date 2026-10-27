import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFcstdDocumentXml } from "./fcstdDocumentXmlService.js";
import { fcstdLinkInstances, fcstdXmlObjects, objectString, xmlAttribute } from "./fcstdLinkIdentity.js";

type TreeNode = {
  host_repo_rel: string; repo_rel_path: string; resolve_status: string; xlink_file_attr: string;
  xref_instances?: Array<{ xlink_file_attr: string; link_label?: string }>;
  children?: TreeNode[];
  [key: string]: any;
};
export type AssemblyLabelReadPorts = { readDocumentXml?: (filename: string) => string | null };

/** Read-only live object projection. The CAD index still owns file resolution;
 * a file-level rule is never used for a named subobject. */
export function enrichAssemblyLabelPreview(workspace: string, currentHost: string, nodes: TreeNode[], ports: AssemblyLabelReadPorts = {}): void {
  const root = fs.realpathSync(workspace);
  const documents = new Map<string, ReturnType<typeof fcstdXmlObjects> | null>();
  const xmls = new Map<string, string>();
  const inside = (filename: string): string | null => {
    try {
      const real = fs.realpathSync(filename), rel = path.relative(root, real);
      return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) ? null : real;
    } catch { return null; }
  };
  const read = (filename: string) => {
    const safe = inside(filename);
    if (!safe) return null;
    if (!documents.has(safe)) {
      const xml = (ports.readDocumentXml ?? readFcstdDocumentXml)(safe);
      documents.set(safe, xml ? fcstdXmlObjects(xml) : null);
      if (xml) xmls.set(safe, xml);
    }
    return documents.get(safe) ?? null;
  };
  const fullPath = (rel: string) => path.resolve(root, rel.replace(/\\/g, "/"));
  function targetDisplay(filename: string, objectName: string, seen = new Set<string>()): { label: string; identity: string } | null {
    const safe = inside(filename);
    if (!safe || !objectName || seen.size >= 32) return null;
    const identity = `${safe}\0${objectName}`;
    if (seen.has(identity)) return null;
    const objects = read(safe)?.filter(object => object.name === objectName);
    if (objects?.length !== 1) return null;
    const object = objects[0];
    // Follow reference projections to the actual part node, not the enclosing
    // file's root label. This also identifies repeated instances of one part.
    const link = object.properties.get("LinkedObject");
    const tag = link?.content.match(/<XLink\b[^>]*>/)?.[0];
    if (tag) {
      const file = xmlAttribute(tag, "file"), name = xmlAttribute(tag, "name");
      if (name) return targetDisplay(file ? path.resolve(path.dirname(safe), file.replace(/\\/g, "/")) : safe, name, new Set(seen).add(identity));
    }
    const label = objectString(object, "Label").trim();
    return label ? { label, identity } : null;
  }

  const hostPlans = new Map<string, Array<ReturnType<typeof fcstdLinkInstances>[number] & {
    rule_label: string; rule_error: string; parent_object_name: string; ordinal: number; identity: string; document_hash: string;
  }>>();
  const planHost = (host: string) => {
    if (hostPlans.has(host)) return hostPlans.get(host)!;
    const hostPath = inside(fullPath(host));
    const objects = hostPath ? read(hostPath) : null;
    const documentHash = createHash("sha256").update(hostPath ? xmls.get(hostPath) ?? "" : "").digest("hex");
    const parents = new Map<string, Array<{ parent: string; ordinal: number }>>();
    for (const object of objects ?? []) {
      const group = object.properties.get("Group");
      if (group?.type !== "App::PropertyLinkList") continue;
      [...group.content.matchAll(/<Link\b[^>]*>/g)].forEach(([tag], ordinal) => {
        const name = xmlAttribute(tag, "value");
        parents.set(name, [...(parents.get(name) ?? []), { parent: object.name, ordinal }]);
      });
    }
    const plan = fcstdLinkInstances(hostPath ? xmls.get(hostPath) ?? "" : "").map((instance, index) => {
      const owned = parents.get(instance.host_object_name) ?? [];
      const target = hostPath ? targetDisplay(path.resolve(path.dirname(hostPath), instance.xlink_file_attr.replace(/\\/g, "/")), instance.target_object_name) : null;
      return { ...instance, document_hash: documentHash, rule_label: owned.length > 1 ? "" : target?.label ?? "",
        rule_error: owned.length > 1 ? "节点属于多个层级，需确认" : target ? "" : "目标对象缺失、不可读或引用有歧义，未生成规则名",
        parent_object_name: owned[0]?.parent ?? "", ordinal: owned[0]?.ordinal ?? index, identity: target?.identity ?? "" };
    });
    // Number repeated parts within their actual Group, in FreeCAD tree order.
    const groups = new Map<string, typeof plan>();
    for (const instance of plan) {
      if (!instance.rule_label) continue;
      const key = `${instance.parent_object_name}\0${instance.identity}`;
      groups.set(key, [...(groups.get(key) ?? []), instance]);
    }
    for (const instances of groups.values()) if (instances.length > 1) {
      instances.sort((a, b) => a.ordinal - b.ordinal).forEach((instance, index) => {
        instance.rule_label += `.${String(index + 1).padStart(3, "0")}`;
      });
    }
    hostPlans.set(host, plan);
    return plan;
  };
  const visit = (items: TreeNode[]) => {
    for (const node of items) {
      const attrs = new Set([node.xlink_file_attr, ...(node.xref_instances ?? []).map(instance => instance.xlink_file_attr)]);
      const instances = planHost(node.host_repo_rel).filter(instance => attrs.has(instance.xlink_file_attr)
        && (!node.host_object_name || node.host_object_name === instance.host_object_name));
      node.label_editable = fullPath(node.host_repo_rel) === fullPath(currentHost) && node.resolve_status === "resolved" && instances.length > 0
        && instances.every(instance => !instance.rule_error);
      node.label_edit_reason = node.label_editable ? "" : fullPath(node.host_repo_rel) !== fullPath(currentHost)
        ? "下级源装配只读；请打开该文件详情修正" : "引用未解析或磁盘对象已变化，请刷新引用";
      node.xref_instances = instances.map(({ labelStart: _start, labelLength: _length, identity, ordinal: _ordinal, ...instance }) => {
        const [targetFile, targetObject] = identity.split("\0");
        const targetRel = targetFile ? path.relative(root, targetFile).replace(/\\/g, "/") : "";
        const directFile = inside(path.resolve(path.dirname(fullPath(node.host_repo_rel)), instance.xlink_file_attr.replace(/\\/g, "/")));
        return { ...instance, target_identity: identity ? `${targetRel}\0${targetObject}` : "",
          resolved_target_repo_rel: targetRel, resolved_target_object_name: targetObject ?? "",
          direct_target_repo_rel: directFile ? path.relative(root, directFile).replace(/\\/g, "/") : "" };
      });
      node.ref_count = instances.length || node.ref_count;
      if (instances.length) {
        node.link_label = instances[0].link_label;
        node.link_labels = instances.map(instance => instance.link_label);
        node.rule_label = instances[0].rule_label;
        if (node.structure_source === "host_objects") node.file_role = (node.children?.length || /\.assy\.fcstd$/i.test(instances[0].identity.split("\0")[0])) ? "assembly" : "part";
      }
      visit(node.children ?? []);
    }
  };
  visit(nodes);
}

/** Prefer the current document's actual Group hierarchy to the index's file
 * dependency graph. In particular, copied/projection children belong to THIS
 * host and must show its on-disk Labels, not the source assembly's Labels. */
export function buildHostObjectAssemblyTree(workspace: string, currentHost: string, indexedNodes: TreeNode[], ports: AssemblyLabelReadPorts = {}) {
  const root = fs.realpathSync(workspace);
  const filename = path.resolve(root, currentHost);
  const relative = path.relative(root, filename);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  let real: string;
  try { real = fs.realpathSync(filename); } catch { return null; }
  if (path.relative(root, real).startsWith("..")) return null;
  const xml = (ports.readDocumentXml ?? readFcstdDocumentXml)(real);
  if (!xml) return null;
  const objects = fcstdXmlObjects(xml);
  const links = fcstdLinkInstances(xml);
  const groups = new Map<string, string[]>();
  const owned = new Set<string>();
  for (const object of objects) {
    const group = object.properties.get("Group");
    if (group?.type !== "App::PropertyLinkList") continue;
    const names = [...group.content.matchAll(/<Link\b[^>]*>/g)].map(([tag]) => xmlAttribute(tag, "value"));
    groups.set(object.name, names);
    names.forEach(name => owned.add(name));
  }
  // Keep the legacy read-only graph for old/unsupported serializations.
  if (!groups.size || !links.some(link => link.target_object_name)) return null;
  const metadata = new Map<string, TreeNode>();
  const collect = (nodes: TreeNode[]) => nodes.forEach(node => {
    if (path.resolve(root, node.host_repo_rel) === filename) {
      for (const instance of node.xref_instances ?? []) metadata.set(instance.xlink_file_attr, node);
      metadata.set(node.xlink_file_attr, node);
    }
    collect(node.children ?? []);
  });
  collect(indexedNodes);
  const byName = new Map(objects.map(object => [object.name, object]));
  const byLink = new Map(links.map(link => [link.host_object_name, link]));
  function build(name: string, ancestors = new Set<string>()): TreeNode | null {
    if (ancestors.has(name)) return null;
    const object = byName.get(name);
    if (!object) return null;
    const children = (groups.get(name) ?? []).map(child => build(child, new Set(ancestors).add(name))).filter((child): child is TreeNode => !!child);
    const link = byLink.get(name);
    if (!link && !children.length) return null;
    const indexed = link ? metadata.get(link.xlink_file_attr) : undefined;
    return { ...indexed, id: `${currentHost}::${name}`, structure_source: "host_objects",
      host_repo_rel: currentHost, host_object_name: name, repo_rel_path: indexed?.repo_rel_path ?? "",
      basename: indexed?.basename ?? (link ? path.basename(link.xlink_file_attr) : "本文件内分组"),
      resolve_status: link ? indexed?.resolve_status ?? "missing" : "self",
      xlink_file_attr: link?.xlink_file_attr ?? "", link_label: objectString(object, "Label"),
      xref_instances: link ? [link] : [], part_number: indexed?.part_number ?? "", part_version: indexed?.part_version ?? "",
      part_key: indexed?.part_key ?? "", TypeCode: indexed?.TypeCode ?? "", ModelSeries: indexed?.ModelSeries ?? "",
      PartName: indexed?.PartName ?? "", label: objectString(object, "Label"), ref_count: 1,
      file_role: children.length ? "assembly" : indexed?.file_role ?? "part", children };
  }
  const roots = objects.filter(object => !owned.has(object.name)).map(object => build(object.name)).filter((node): node is TreeNode => !!node);
  // Omit the one local document-root wrapper, just as the file-detail title does.
  const nodes = roots.length === 1 && !roots[0].xlink_file_attr ? roots[0].children ?? [] : roots;
  enrichAssemblyLabelPreview(workspace, currentHost, nodes, ports);
  // Collapse only sibling leaves referring to the same actual part object.
  // Subassemblies with materialized children stay separate, preserving each
  // instance's distinct descendants and scope for numbering/writing.
  function groupLeaves(items: TreeNode[]): TreeNode[] {
    const grouped: TreeNode[] = [];
    const byTarget = new Map<string, TreeNode>();
    for (const node of items) {
      node.children = groupLeaves(node.children ?? []);
      const instance = node.xref_instances?.[0] as any;
      const key = !node.children.length && instance?.target_identity ? `${instance.parent_object_name}\0${instance.target_identity}` : "";
      const existing = key ? byTarget.get(key) : undefined;
      if (existing) {
        existing.xref_instances!.push(...node.xref_instances!);
        existing.ref_count = existing.xref_instances!.length;
        existing.link_labels = existing.xref_instances!.map(item => item.link_label);
      } else {
        grouped.push(node);
        if (key) byTarget.set(key, node);
      }
    }
    return grouped;
  }
  const groupedNodes = groupLeaves(nodes);
  let count = 0;
  const countNodes = (items: TreeNode[]) => items.forEach(node => { count++; countNodes(node.children ?? []); });
  countNodes(groupedNodes);
  return { nodes: groupedNodes, node_count: count, structure_source: "host_objects" };
}
