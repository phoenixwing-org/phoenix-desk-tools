# Web 壳层 · 页面属性面板 P2 续 · 会话归档

> 前置：[Web壳层-页面属性面板-P2归档.md](Web壳层-页面属性面板-P2归档.md)  
> 规划：[Web壳层-页面属性面板-规划.md](Web壳层-页面属性面板-规划.md)  
> 最后更新：2026-06-22

---

## 验收总览

| 项 | 状态 |
| --- | --- |
| `file_rename` 属性 sheet（规则 + 分析信息只读） | ✅ |
| `PageHeader.vue` 页头组件化（19 工具页） | ✅ |
| 改名 XLink · 无索引时从 FCStd 读 rule Label | ✅ + 4 单测 |
| 成员排序 · 从工作集推导一级目录勾选 | ✅ |
| `propPath` 类型扩展（xlink / 工作集 / part_dedup / step_batch / sw_step_export） | ✅ |
| `pnpm build` / 相关单测 | ✅ |

---

## 现象摘要（5–10 行）

1. **改名分析**（`file_rename`）：「含间接宿主」与扫描后 meta（旧/新文件名、宿主数、命中数）迁入侧栏属性；主区留模式/表单，**开始分析 / 刷新历史** 在页头工具条。
2. **页头统一**：新增 `PageHeader.vue`（`title` + `page-id` + `#actions` + `PageHelpButton`），19 个工具页去掉重复 `page-head` 结构；`page-shared.css` 补 `.head-actions-inner` 供 tour 锚点。
3. **XLink Label 同步**：`resolve_rule_display_label` 无 CAD 索引时回退 `resolve_fcstd_display_label` 读盘，不再退化为 basename；单测覆盖单引用、同 Group `.002`、跨组不重复、`sync_reference_labels=True` 写回。
4. **成员排序 × 工作集**：主区「从工作集勾选」按活动工作集 path 推导一级条目（TS + Python `derive_reorder_top_level_from_workset`）；属性区只读展示活动工作集与文件数。
5. **MVC 研讨**：维持 `useXxxPropertySheet`，不落地 `PnxXxxParam`。

---

## 新增 / 主要改动

| 路径 | 说明 |
| --- | --- |
| `useFileRenamePropertySheet.ts` | 改名分析属性描述符 |
| `PageHeader.vue` | 工具页页头组件 |
| `deriveReorderTopLevelFromWorkset.ts` | 工作集 → 一级条目 |
| `phoenix/code/reorder_workset_scope.py` | 同上（Python 单测） |
| `xlink.py` | `resolve_rule_display_label` 无索引读盘 |
| `tests/test_rename_ref_fix.py` | Label 同步 4 用例 |

## 已接入页面（累计）

`reorder_members` · `xlink_fix` · `code_rename` · `code_uuid` · `part_dedup` · `fcstd_map` · `bom_export` · **`file_rename`**

---

## 明确未做（下一批推荐）

- [ ] P3 二批人工 smoke（单元测试 / BOM / 改名 / 文件详情）
- [x] 属性面板 KeepAlive 递归更新、壳层默认停靠等 — 见 [稳定化归档](Web壳层-属性面板与壳层稳定化-归档.md)

**结论**：属性面板 P2 页迁移收尾；壳层页头与 FileWorkset 消费（成员排序）已落地；稳定化会话见链接归档。
