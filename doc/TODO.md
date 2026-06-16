# Fcdesk Web / 后端 — 总待办

> 汇总跨模块待办；细项研究稿见 [文档索引.md](文档索引.md)。  
> 状态：`[ ]` 未做 · `[~]` 进行中 · `[x]` 已完成

最后更新：2026-06

---

## P0 — 性能 / 正确性（引用与索引）

- [x] 出向引用：`JOIN file_asset`，去掉 `get_file_asset_bom_fields` N+1（见 [出向引用-N+1查库-研究.md](出向引用-N+1查库-研究.md)）
- [x] `bom_xref` 冗余 `rule_label` + 子件 BOM 快照；查询单表、不读盘补 Label
- [x] 文件详情：引用 Tab 懒加载、分 scope 请求、角标单条 SQL
- [ ] `rebuild_bom_tree_occurrences`：邻接表只查一次，消除 per-host 重复全表 SQL
- [ ] `query_bom_xrefs_incoming`：合并 `get_file_asset_id` 为单条 SQL

---

## P1 — 文件详情 / BOM

- [x] 装配结构 Tab：`v-show` + 缓存，切换不重复请求
- [x] 编辑属性 Tab：显示文档类型（零件/装配/图纸 + 推荐后缀）
- [x] 属性「全部推荐」：单次 API + 不读 FCStd（文件名/索引/记忆）
- [x] 改名 Tab：显示改名记录 → 跳转「改名分析」页（不再内嵌引用表）
- [ ] 引用/装配「改链接」后自动刷新相关 Tab 缓存（部分已有 `invalidate*`）
- [ ] 图纸档：编辑属性只读提示与来源模型跳转体验统一

---

## P1 — Web 壳层 / UX

- [x] **配置**：全屏 frame 层；工作空间 **浏览…** 走 Python 原生选目录
- [ ] 配置层：保存工作空间后若从未扫描，引导一键打开 CAD 索引
- [ ] 桌面 `fcstd_map_page` 分页，去掉 `load_fcstd_document` 全表
- [ ] 统一运行日志：长任务进度条 / 取消（见 [统一运行日志窗口-规划讨论.md](统一运行日志窗口-规划讨论.md)）

---

## P2 — 清理 / 技术债

- [ ] 删除或收敛 `_enrich_tree_node` 等死代码
- [ ] `query_target_usage_stats` 合并多条查询
- [ ] 旧库 `bom_xref.link_label` 为空：文档说明「重扫 / 重建引用索引」运维步骤
- [ ] `FIX_CODE.py`：已废弃的一次性补丁脚本，可删或移入 `scripts/archive`

---

## 讨论稿（未立项）

| 文档 | 主题 |
| --- | --- |
| [文件变更历史与引用证据-待办讨论.md](文件变更历史与引用证据-待办讨论.md) | 改名历史、引用证据、统一修正算法 |
| [Phoenix工作空间存储-规划讨论.md](Phoenix工作空间存储-规划讨论.md) | SQLite 默认、按需导出 JSON |
| [Web与桌面迁移-待办.md](Web与桌面迁移-待办.md) | 页面对照、桌面功能迁移 |
| [SQL查询与递归点检-todo.md](SQL查询与递归点检-todo.md) | SQL 日志格式、递归点检清单 |

---

## 运维备忘

- 修改前端后：**硬刷新**或重启 `python -m fcdesk.web --dev`
- 索引字段变更后：工作空间内 **CAD 重扫** 或单文件 **重建引用索引**
- 查询路径**不读 FCStd 补全**；缺 `link_label` / `rule_label` 需重建索引
