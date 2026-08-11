# Web 壳层 · 页面属性面板 P2 · 会话归档

> 前置：[Web壳层-页面属性面板-P1归档.md](Web壳层-页面属性面板-P1归档.md)  
> 规划：[Web壳层-页面属性面板-规划.md](Web壳层-页面属性面板-规划.md)  
> 架构研讨（未执行）：[Web壳层-页面参数与属性-MVC研讨.md](Web壳层-页面参数与属性-MVC研讨.md)  
> 最后更新：2026-06-19

---

## 验收总览

| 项 | 状态 |
| --- | --- |
| 一名一值 + 子分组（工作集范围） | ✅ |
| 去掉 radio / propSlot / 属性内按钮 | ✅ |
| 空分组不显示、无「（无属性）」 | ✅ |
| 去掉「名称 \| 值」表头 | ✅ |
| `fcstd_map` / `bom_export` 只读属性接入 | ✅ |
| MVC Param 研讨稿 | ✅ 暂不执行 |
| `pnpm build` | ✅ |

---

## 规则收敛（对齐 FreeCAD）

| 规则 | 实现 |
| --- | --- |
| 一名一值 | 多控件拆 `propGroup` + `hidden` |
| 枚举 | 统一 `propEnum`（combo） |
| 无按钮 | 操作留主区 / Ribbon / 页脚；移除 `propAction` |
| 无复杂嵌入 | 移除 `propSlot`；工作集改 `useWorksetScopePropertyGroups` |
| 空组 | `visibleFields` 为空则整组不渲染 |

---

## 新增 / 主要改动

| 路径 | 说明 |
| --- | --- |
| `useWorksetScopePropertyGroups.ts` | 范围模式 + 子目录/工作集条件分组 |
| `useFcstdMapPropertySheet.ts` | 扫描选项 + 索引状态/路径只读 |
| `useBomExportPropertySheet.ts` | 引用表/路径只读 |
| `PagePropertiesPanel.vue` | 无表头、过滤空组 |
| `types/pageProperties.ts` | 移除 action/slot/radio |
| `Web壳层-页面参数与属性-MVC研讨.md` | `PnxXxxParam` + `derivePageProperties` 讨论 |

## 已接入页面（累计）

`reorder_members` · `xlink_fix` · `code_rename` · `code_uuid` · `part_dedup` · **`fcstd_map`** · **`bom_export`**

---

## 明确未做

- [ ] MVC Param 落地（见研讨稿 D1+）
- [ ] `file_rename` / STEP 页属性迁移
- [ ] `propPath` 等类型扩展

---

**结论**：属性面板交互规则已收紧为「纯值 + 只读」；CAD 索引与 BOM 列表 meta 迁入侧栏；下一步可选 Param 架构或继续 P2 页迁移。
