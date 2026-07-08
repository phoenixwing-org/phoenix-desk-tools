/** pnwBomCompute — 对应 Python cad_index/bom_compute.py (202行)
 *  BOM 森林构建 + 引用展开 — 纯函数，不涉及 I/O。
 */

// ── 对应 Python: BomNode ──────────────────────────────
export interface BomNode {
  rel: string; depth: number; materializedPath: string;
  partKey: string; quantity: number; cycleDetected: boolean;
  children: BomNode[];
}

// ── 对应 Python: RefEdge ──────────────────────────────
export interface RefEdge { hostRel: string; targetRel: string; linkLabel: string; isDirect: boolean; }

// ── 对应 Python: BomForestResult ──────────────────────
export interface BomForestResult {
  roots: Record<string, BomNode>;
  bomLines: Record<string, any>[];
  refEdges: RefEdge[];
  cycles: string[];
}

// ── 内部辅助 ──────────────────────────────────────────

function basename(rel: string): string {
  return rel.replace(/\\/g, "/").split("/").pop() || rel;
}

function partKey(bom: Record<string, any>): string {
  const pn = String(bom?.PartNumber || "").trim();
  const pv = String(bom?.PartVersion || "").trim();
  if (pn && pv) return `${pn}.${pv}`;
  return pn || pv || "";
}

// 对应 Python: _resolve_target
function resolveTarget(fileAttr: string, hostRel: string, basenameMap: Map<string, string[]>): string | null {
  const attr = fileAttr.replace(/\\/g, "/").trim();
  const bn = basename(attr);
  if (!bn.toLowerCase().endsWith(".fcstd")) return null;
  const candidates = basenameMap.get(bn) || [];
  if (candidates.length === 1) return candidates[0];
  if (hostRel && candidates.length > 1) {
    const hostDir = hostRel.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    for (const c of candidates) {
      const cDir = c.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
      if (cDir === hostDir) return c;
    }
  }
  return candidates[0] || null;
}

// 对应 Python: _collect_all_ref_targets
function collectAllRefTargets(allBomData: Record<string, any>, basenameMap: Map<string, string[]>): Set<string> {
  const targets = new Set<string>();
  for (const data of Object.values(allBomData)) {
    for (const xlink of data.xlinks || []) {
      const target = resolveTarget(xlink.file || "", "", basenameMap);
      if (target) targets.add(target);
    }
  }
  return targets;
}

// 对应 Python: _walk_children
function walkChildren(
  parentNode: BomNode, rootAssemblyRel: string, hostRel: string,
  allBomData: Record<string, any>, basenameMap: Map<string, string[]>,
  visited: Set<string>, outLines: Record<string, any>[], outCycles: string[],
  depth: number = 1,
): void {
  const data = allBomData[hostRel];
  if (!data) return;
  const xlinks = data.xlinks || [];
  if (!xlinks.length) return;

  for (const xlink of xlinks) {
    const fileAttr = (xlink.file || "").trim();
    if (!fileAttr) continue;
    const targetRel = resolveTarget(fileAttr, hostRel, basenameMap);
    if (!targetRel) continue;

    const childData = allBomData[targetRel] || {};
    const childBom = childData.bom || {};
    const cycleDetected = visited.has(targetRel);
    if (cycleDetected) outCycles.push(targetRel);

    const childNode: BomNode = {
      rel: targetRel, depth,
      materializedPath: `${parentNode.materializedPath}/${basename(targetRel)}`,
      partKey: partKey(childBom), quantity: 1, cycleDetected,
      children: [],
    };

    outLines.push({
      assembly_rel: rootAssemblyRel, part_rel: targetRel, depth,
      bom_path: childNode.materializedPath, part_key: childNode.partKey,
      quantity: childNode.quantity, cycle_detected: cycleDetected,
    });

    parentNode.children.push(childNode);
    if (cycleDetected) continue;

    visited.add(targetRel);
    walkChildren(childNode, rootAssemblyRel, targetRel, allBomData, basenameMap, visited, outLines, outCycles, depth + 1);
    visited.delete(targetRel);
  }
}

// ── 对应 Python: build_ref_edges ──────────────────────
export function buildRefEdges(allBomData: Record<string, any>, basenameMap: Map<string, string[]>): RefEdge[] {
  const edges: RefEdge[] = [];
  const allRels = new Set(Object.keys(allBomData));
  for (const [hostRel, data] of Object.entries(allBomData)) {
    for (const xlink of data.xlinks || []) {
      const fileAttr = (xlink.file || "").trim();
      if (!fileAttr) continue;
      const targetRel = resolveTarget(fileAttr, hostRel, basenameMap);
      if (!targetRel) continue;
      edges.push({ hostRel, targetRel, linkLabel: xlink.label || "", isDirect: allRels.has(targetRel) });
    }
  }
  return edges;
}

// ── 对应 Python: build_bom_forest ─────────────────────
export function buildBomForest(
  allBomData: Record<string, any>,
  basenameMap: Map<string, string[]>,
): BomForestResult {
  const allRefs = collectAllRefTargets(allBomData, basenameMap);
  let rootRels = Object.keys(allBomData).filter(rel => !allRefs.has(rel));

  if (!rootRels.length) {
    rootRels = Object.keys(allBomData).filter(rel => allBomData[rel]?.xlinks?.length).slice(0, 1);
  }
  if (!rootRels.length && Object.keys(allBomData).length) {
    rootRels = [Object.keys(allBomData)[0]];
  }

  const roots: Record<string, BomNode> = {};
  const allLines: Record<string, any>[] = [];
  const cycles: string[] = [];

  for (const rootRel of rootRels) {
    const rootName = basename(rootRel);
    const rootNode: BomNode = {
      rel: rootRel, depth: 0, materializedPath: rootName,
      partKey: partKey(allBomData[rootRel]?.bom || {}), quantity: 1,
      cycleDetected: false, children: [],
    };
    const visited = new Set<string>([rootRel]);
    walkChildren(rootNode, rootRel, rootRel, allBomData, basenameMap, visited, allLines, cycles);
    roots[rootRel] = rootNode;
  }

  const refEdges = buildRefEdges(allBomData, basenameMap);
  return { roots, bomLines: allLines, refEdges, cycles };
}
