import { ref } from "vue";
import { fetchAssemblyTreeByHost, type AssemblyTreeNode } from "../api";
import {
  assemblyTreeFlatten,
  assemblyTreeCanLoadSourceChildren,
  walkAssemblyTree,
} from "../models/assemblyTreeViewModel";

export interface AssemblyTreeControllerOptions {
  fetchSubtree?: (
    hostRel: string,
    full: boolean,
    refreshDisk?: boolean,
  ) => Promise<{ nodes: AssemblyTreeNode[] }>;
  onStatus: (message: string) => void;
}

/** 装配树展开 Controller：拥有懒加载缓存、并发去重、展开/折叠与失败回退。 */
export function useAssemblyTreeController(options: AssemblyTreeControllerOptions) {
  const fetchSubtree = options.fetchSubtree ?? fetchAssemblyTreeByHost;
  const expanded = ref<Set<string>>(new Set());
  const expandedLabels = ref<Set<string>>(new Set());
  const lazyChildren = ref<Map<string, AssemblyTreeNode[]>>(new Map());
  const loadingSubtree = ref<Set<string>>(new Set());
  const inFlight = new Map<string, Promise<AssemblyTreeNode[]>>();
  const inFlightTokens = new Map<string, symbol>();
  let generation = 0;

  function childrenOf(node: AssemblyTreeNode): AssemblyTreeNode[] {
    if (node.children?.length) return node.children;
    return lazyChildren.value.get(node.id) ?? [];
  }

  function hasSubtree(node: AssemblyTreeNode): boolean {
    return childrenOf(node).length > 0;
  }

  function canExpand(node: AssemblyTreeNode): boolean {
    return hasSubtree(node) || assemblyTreeCanLoadSourceChildren(node);
  }

  async function ensureSubtree(node: AssemblyTreeNode): Promise<AssemblyTreeNode[]> {
    if (hasSubtree(node)) return childrenOf(node);
    if (!assemblyTreeCanLoadSourceChildren(node)) return [];
    const rel = node.repo_rel_path?.trim();
    if (!rel) return [];
    const pending = inFlight.get(node.id);
    if (pending) return pending;

    const requestGeneration = generation;
    const requestToken = Symbol(node.id);
    loadingSubtree.value = new Set(loadingSubtree.value).add(node.id);
    const request = (async () => {
      try {
        const data = await fetchSubtree(rel, true);
        const children = data.nodes ?? [];
        if (requestGeneration === generation) {
          lazyChildren.value = new Map(lazyChildren.value).set(node.id, children);
        }
        return children;
      } catch (error) {
        options.onStatus(String(error));
        return [];
      } finally {
        if (inFlightTokens.get(node.id) === requestToken) {
          const next = new Set(loadingSubtree.value);
          next.delete(node.id);
          loadingSubtree.value = next;
          inFlight.delete(node.id);
          inFlightTokens.delete(node.id);
        }
      }
    })();
    inFlight.set(node.id, request);
    inFlightTokens.set(node.id, requestToken);
    return request;
  }

  async function toggle(node: AssemblyTreeNode): Promise<void> {
    if (!canExpand(node)) return;
    const toggleGeneration = generation;
    if (!hasSubtree(node) && assemblyTreeCanLoadSourceChildren(node)) {
      await ensureSubtree(node);
      if (toggleGeneration !== generation) return;
      if (!hasSubtree(node)) {
        options.onStatus("该装配无已索引的下级引用，请先在「引用」Tab 重建索引");
        return;
      }
    }
    const next = new Set(expanded.value);
    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    expanded.value = next;
  }

  function toggleLabelExpand(node: AssemblyTreeNode): void {
    const next = new Set(expandedLabels.value);
    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    expandedLabels.value = next;
  }

  function flatRows(nodes: AssemblyTreeNode[]) {
    void lazyChildren.value;
    return assemblyTreeFlatten(nodes, expanded.value, childrenOf);
  }

  function expandAllLabels(nodes: AssemblyTreeNode[]): void {
    const next = new Set(expandedLabels.value);
    walkAssemblyTree(nodes, childrenOf, (node) => {
      if ((node.ref_count ?? 1) > 1) next.add(node.id);
    });
    expandedLabels.value = next;
  }

  async function expandAllTree(nodes: AssemblyTreeNode[]): Promise<void> {
    const expandGeneration = generation;
    const next = new Set<string>();
    async function walk(items: AssemblyTreeNode[]) {
      for (const node of items) {
        if (assemblyTreeCanLoadSourceChildren(node)) await ensureSubtree(node);
        if (hasSubtree(node)) {
          next.add(node.id);
          await walk(childrenOf(node));
        }
      }
    }
    await walk(nodes);
    if (expandGeneration !== generation) return;
    expanded.value = next;
    expandAllLabels(nodes);
  }

  function collapseAll(): void {
    expanded.value = new Set();
    expandedLabels.value = new Set();
  }

  function reset(nodes: AssemblyTreeNode[]): void {
    generation += 1;
    inFlight.clear();
    inFlightTokens.clear();
    expandedLabels.value = new Set();
    lazyChildren.value = new Map();
    loadingSubtree.value = new Set();
    expanded.value = new Set(nodes.filter((node) => hasSubtree(node)).map((node) => node.id));
  }

  return {
    expanded,
    expandedLabels,
    loadingSubtree,
    childrenOf,
    hasSubtree,
    canExpand,
    ensureSubtree,
    toggle,
    toggleLabelExpand,
    flatRows,
    expandAllTree,
    collapseAll,
    reset,
  };
}
