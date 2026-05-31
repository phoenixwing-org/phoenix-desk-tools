/** 工作空间内按文件名 / 路径查询目标的共用解析（BOM 引用、改名分析等）。 */

export function basenameFromRel(rel: string): string {
  const p = rel.replace(/\\/g, "/");
  return p.slice(p.lastIndexOf("/") + 1) || p;
}

export function normalizeRepoRel(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/** 与后端 ``normalize_repo_rel_path_for_map`` 对齐，用于 API 查询参数 */
export function normalizeRepoRelForApi(rel: string): string {
  const s = rel.replace(/\\/g, "/").trim();
  if (!s || s.startsWith("/") || s.startsWith("..")) return s;
  if (s.startsWith("./")) return s;
  return `./${s}`;
}

export type TargetFileQuery = { rel?: string; basename?: string };

/** 入向引用 / 改名分析：搜索框 + 右侧树选择 → API 参数 */
export function resolveIncomingTargetQuery(
  queryText: string,
  pickedRel: string,
): TargetFileQuery | null {
  const treeRel = pickedRel.trim();
  const text = queryText.trim();

  if (treeRel) {
    return { rel: normalizeRepoRelForApi(treeRel) };
  }
  if (!text) return null;
  if (text.includes("/") || text.includes("\\")) {
    const rel = normalizeRepoRelForApi(text);
    return { rel, basename: basenameFromRel(rel) };
  }
  return { basename: text };
}

/** 出向引用：宿主路径 */
export function resolveOutgoingHostQuery(
  queryText: string,
  pickedRel: string,
): { rel: string } | null {
  const rel = normalizeRepoRelForApi(pickedRel.trim() || queryText.trim());
  return rel ? { rel } : null;
}

/** 将入向查询解析为改名分析 API 的 old_basename（树选时取 basename，手输路径同理） */
export function incomingQueryToBasename(q: TargetFileQuery): string {
  if (q.basename) return q.basename;
  if (q.rel) return basenameFromRel(q.rel);
  return "";
}

/** 入向查询的人类可读描述（日志 / 摘要共用） */
export function describeIncomingTargetQuery(q: TargetFileQuery | null): string {
  if (!q) return "(未指定)";
  if (q.basename && !q.rel) return `basename=${q.basename}`;
  if (q.rel && q.basename) return `rel=${q.rel} · basename=${q.basename}`;
  if (q.rel) return `rel=${q.rel}`;
  if (q.basename) return `basename=${q.basename}`;
  return JSON.stringify(q);
}

/** BOM 入向查询 / 改名分析完成摘要（统一格式） */
export function formatIncomingHostSummary(opts: {
  hostCount: number;
  directHostCount?: number;
  transitive: boolean;
  edgeCount?: number;
  hitCount?: number;
  pendingHitCount?: number;
  mode?: "query" | "analyze";
}): string {
  const direct = opts.directHostCount ?? opts.hostCount;
  const indirect = Math.max(0, opts.hostCount - direct);
  if (opts.mode === "analyze") {
    return [
      `分析完成：宿主 ${opts.hostCount} 个`,
      opts.transitive && indirect > 0 ? `直接 ${direct} · 间接 ${indirect}` : null,
      opts.hitCount != null ? `XLink ${opts.hitCount} 处` : null,
      opts.pendingHitCount != null ? `待修正 ${opts.pendingHitCount} 处` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    `查询完成：入向宿主 ${opts.hostCount} 个`,
    opts.transitive && indirect > 0 ? `（直接 ${direct} · 间接 ${indirect}）` : null,
    opts.edgeCount != null ? `引用边 ${opts.edgeCount} 条` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 手填 / 树选目标 → ``analyzeRenameReferences`` 请求体 */
export function buildRenameAnalyzeParams(
  q: TargetFileQuery,
  opts: {
    newBasename: string;
    /** 改名后的目标路径（目录+新文件名），用于 XLink 路径写回 */
    newRepoRel?: string;
    /** 当前目标路径：排除其作为宿主、并精确匹配入向引用 */
    oldRepoRel?: string;
    /** @deprecated 用 oldRepoRel */
    excludeRepoRel?: string;
    transitive: boolean;
    persist: boolean;
    renameLogId?: number;
  },
) {
  if (opts.renameLogId != null) {
    return {
      rename_log_id: opts.renameLogId,
      transitive: opts.transitive,
      persist: opts.persist,
    };
  }
  const old = incomingQueryToBasename(q);
  const neu = opts.newBasename.trim() || old;
  const oldPath = (opts.oldRepoRel || opts.excludeRepoRel)?.trim();
  const newPath = opts.newRepoRel?.trim() || undefined;
  return {
    old_basename: old,
    new_basename: neu,
    old_repo_rel_path: oldPath || undefined,
    new_repo_rel_path: newPath || undefined,
    transitive: opts.transitive,
    persist: opts.persist,
  };
}
