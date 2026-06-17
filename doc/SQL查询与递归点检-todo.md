# SQL 查询统一日志 & 递归算法点检 Todo

## 统一日志（已实现）

所有经 `phoenix_store.connect()` 的 `execute` / `executemany` 自动输出**同一格式**：

```
INFO [phoenix.freecad.phoenix_store] SQL <模块.函数> | <单行 SQL>
```

- 调用方来自栈回溯（如 `bom_xref_service.search_incoming_refs`、`assembly_tree_cache._batch_enrich_file_roles`）
- `PRAGMA` 与 schema 初始化不记录（在包装连接之前执行）
- `executemany` 追加 `executemany×N`
- 用法：重启 `python -m phoenix.web --dev`，操作各页面，对照终端里**连续多条相同 SQL** 或 **同一函数名重复出现** 即可定位「哪页在递归查库」

---

## 递归 / 多点查库 — 点检结论

### ✅ 已是「一次 SQL + 内存展开」（无逐层查库）

| 场景 | 入口 | 算法 |
|------|------|------|
| 文件详情 · 装配树 | `load_assembly_tree` → `load_assembly_tree_cached` | 优先读 `bom_assembly_cache`；未命中则 **`query_all_bom_xref_edges_enriched` 一次** + `_build_level` 内存 BFS/DFS |
| 文件详情 · 入向引用（传递） | `search_incoming_refs` | **`query_bom_xrefs_incoming` 一次** + **`query_all_bom_xref_edges` 一次** + `_transitive_incoming_hosts` 队列 BFS（纯内存） |
| 文件详情 · 出向引用 | `search_outgoing_refs` | **`query_bom_xrefs_outgoing` 一次** |
| CAD 索引列表 | `search_fcstd_map_entries` | **`query_file_asset_entries_paged` 一次**（`COUNT(*) OVER()`） |
| BOM 总成列表 | `load_assembly_bom_catalog` | **`query_assembly_bom_hosts` 一次**（含相关子查询统计入向数，仍是一条 SQL） |
| 装配树缺字段补全 | `_batch_enrich_file_roles` | 整树 flatten 后 **`WHERE repo_rel_path IN (...)` 一条** |

### ⚠️ 单次请求多条 SQL（非递归，但打开文件详情会连打）

| 时机 | 约几条 SQL | 说明 |
|------|-----------|------|
| 打开文件详情 Tab | 3～4 | `load_bom_preview`（`find_file_asset_entry`）+ 入向 direct + 可选 transitive 全表边 + 出向 |
| 切到「装配结构」子 Tab | +1～2 | 缓存 SELECT；未命中再全表 enriched 边 + 可选 IN 补全 |
| 切到「引用」子 Tab | 与上类似 | `FileXrefPanel` 再拉入向/出向（`refresh_disk` 时另触发重建，非 SELECT） |

终端里若见 `bom_xref_service.fetch_incoming_direct_rows` 与 `resolve_incoming_host_entries` 各打一条，属**同一次入向 API**，不是 bug。

### 🔴 待优化：真·重复 / N 次全表 SQL

| 优先级 | 问题 | 位置 | 现状 | 建议 |
|--------|------|------|------|------|
| **P0** | **出向引用 N+1**（文件详情典型日志） | `search_outgoing_refs` → `resolve_rule_display_label` → `get_file_asset_bom_fields` | 1 条 `bom_xref` + **每条子件 1 条** `file_asset`；前端可能 **重复请求 2 次** outgoing API | 详见 **[出向引用-N+1查库-研究.md](出向引用-N+1查库-研究.md)**：JOIN + `_rule_label_from_target_index` |
| P0 | 物化路径重建对每个总成重复全表边查询 | `rebuild_bom_tree_occurrences` | 循环 `hosts`：`build_assembly_tree_payload` → 每次 `query_all_bom_xref_edges_enriched` | **Todo**：重建时只加载一次邻接表，循环内仅内存 `build_assembly_tree_payload_from_adj` |
| P1 | 入向查询前多一次 asset id 查找 | `query_bom_xrefs_incoming` | 有 `repo_rel` 时先 `get_file_asset_id` 再主查询 | **Todo**：合并为单条 SQL（子查询或 JOIN `file_asset`） |
| P1 | 桌面 CAD 索引仍全表加载 | `load_fcstd_document` / `fcstd_map_page._show_map_table` | `SELECT * FROM file_asset` 无分页 | **Todo**：桌面页改分页或复用 `query_file_asset_entries_paged` |
| P2 | 死代码逐节点查库 | `bom_xref_service._enrich_tree_node` | 每节点 `SELECT ... WHERE repo_rel_path=?`（**当前无调用方**） | **Todo**：删除或改为批量 IN（与 `_batch_enrich_file_roles` 合并） |
| P2 | `query_target_usage_stats` 连打 3 条 | `bom_tree_occurrence.query_target_usage_stats` | COUNT + COUNT + SELECT LIMIT | **Todo**：可合并为 1～2 条或读物化表缓存 |
| P3 | 扫描后 `rebuild_bom_xrefs` 写库 | `replace_bom_xrefs` + `rebuild_bom_tree_occurrences` | 大量 INSERT / DELETE（日志会显示 `executemany×N`） | 预期行为；仅需关注 P0 减少前面的 SELECT 重复 |

### 📝 内存递归（不查库，仅列清）

| 算法 | 文件 | 说明 |
|------|------|------|
| `_build_level` | `assembly_tree_cache.py` | 沿邻接表展开子装配，`stack` 防环 |
| `_transitive_incoming_hosts` | `bom_xref_service.py` | 沿 parent 图向上 BFS |
| `discover_fcstd_subtree_hosts` | `bom_xref_index.py` | 读盘 XLink BFS（**非 SQL**） |
| `flatten_tree_occurrences` | `bom_tree_occurrence.py` | 压平 JSON 树写物化表 |

---

## 行动 Todo

- [ ] **P0** 出向引用：`query_bom_xrefs_outgoing` JOIN `file_asset`，去掉逐条 `get_file_asset_bom_fields`（见 [出向引用-N+1查库-研究.md](出向引用-N+1查库-研究.md)）
- [ ] **P1** 文件详情：`refreshXrefCounts` 与 `FileXrefPanel` 合并 outgoing 请求或提供 count-only API
- [ ] **P0** `rebuild_bom_tree_occurrences`：邻接表只查一次，消除 per-host 重复 `query_all_bom_xref_edges_enriched`
- [ ] **P1** `query_bom_xrefs_incoming`：去掉 `get_file_asset_id` 前置查询，合并 SQL
- [ ] **P1** 桌面 `fcstd_map_page`：对齐 Web 分页 API，避免 `load_fcstd_document` 全表
- [ ] **P2** 删除或收敛 `_enrich_tree_node` 逐条 SELECT
- [ ] **P2** `query_target_usage_stats` 合并查询
- [ ] 点检文档：各 Web 页与 API 对照表（见下）

## 页面 → API → 典型 SQL 调用方（对照）

| 页面 | 主要 API | 终端 `SQL` 调用方示例 |
|------|----------|----------------------|
| CAD 索引 | `GET /api/fcstd-map/entries` | `phoenix_store.query_file_asset_entries_paged` |
| BOM 列表 | `GET /api/bom-xrefs/assembly-hosts` | `phoenix_store.query_assembly_bom_hosts` |
| 文件详情 · 概览 | `GET /api/bom` | `phoenix_store.find_file_asset_entry` |
| 文件详情 · 引用 | `GET /api/bom-xrefs/incoming` / `outgoing` | `fetch_incoming_direct_rows` / `search_outgoing_refs` |
| 文件详情 · 装配 | `GET /api/bom-xrefs/assembly-tree` | `load_bom_assembly_cache` 或 `query_all_bom_xref_edges_enriched` |
| 零件目录 | `GET /api/part-keys` | `phoenix_store.list_part_keys` |
| 扫描写库 | `POST /api/fcstd-map/scan` | 大量 `file_asset` UPSERT + `rebuild_bom_tree_occurrences` |

---

*最后更新：统一 connect 层 SQL 日志 + 递归点检（2026-06）*
