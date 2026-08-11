# BOM 物化路径重建 · 邻接表单次加载 · 归档

> 关联：[SQL查询与递归点检-todo.md](../platform/SQL查询与递归点检-todo.md) · [TODO.md](../TODO.md) §P0  
> 实现：`phoenix/services/bom_tree_occurrence.py` · `phoenix/services/assembly_tree_cache.py`  
> 最后更新：2026-06-22

---

## 问题

CAD 索引扫描后 `rebuild_bom_xrefs` → `rebuild_bom_tree_occurrences`：对每个总成 host 调用 `build_assembly_tree_payload`，内部每次执行 `query_all_bom_xref_edges_enriched`（全表 JOIN）。总成数为 N 时 SQL 打 N 遍。

---

## 改动

| 项 | 说明 |
| --- | --- |
| `load_bom_xref_adjacency` | 一次查 enriched 边 → host 邻接表 |
| `build_assembly_tree_payload_from_adj` | 纯内存展开；`enrich=False` 时跳过 IN 补全（物化路径不需要 part 字段） |
| `rebuild_bom_tree_occurrences` | 循环前加载邻接表一次，循环内 `from_adj` |
| `build_assembly_tree_payload` | 委托 `load_bom_xref_adjacency` + `from_adj`（单 host API 行为不变） |

---

## 验收

| 项 | 状态 |
| --- | --- |
| `test_rebuild_bom_tree_occurrences_single_adjacency_query` | ✅ mock 计数 = 1 |
| `test_materialized_path_incoming_usage` 等既有用例 | ✅ |
| 扫描写库日志 | 重建阶段仅 1 条 `query_all_bom_xref_edges_enriched` |

---

## 明确未做

- [ ] 内部装配结构感知 BOM 挂载（顶 `App::Part` 选型）
- [ ] `query_target_usage_stats` 合并 COUNT 查询（P2）

**结论**：物化路径重建从 O(N) 全表 SELECT 降为 O(1)；装配树单页 API 语义不变。
