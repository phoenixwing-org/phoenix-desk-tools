# Web 壳层 · 页面属性面板 P1 · 会话归档

> 规划：[Web壳层-页面属性面板-规划.md](Web壳层-页面属性面板-规划.md)  
> 实现说明：[Web壳层-页面属性面板.md](Web壳层-页面属性面板.md)  
> 待办：[TODO.md](../TODO.md) §侧栏·页面属性面板  
> 最后更新：2026-06-21

---

## 验收总览

| 项 | 状态 |
| --- | --- |
| P0 POC（`reorder_members`） | ✅ |
| P1 Code/CAD 三页迁移 | ✅ |
| 属性空态占位 | ✅ |
| `pnpm build` | ✅ |

---

## P1 已接入页面

| pageId | composable | 属性分组 | 主区保留 |
| --- | --- | --- | --- |
| `reorder_members` | `useReorderMembersPropertySheet` | 运行 / KEVIN / 忽略 | 一级目录表、预检/执行 |
| `xlink_fix` | `useXlinkFixPropertySheet` | 扫描 / 分析信息（只读） | 分析、执行、问题表 |
| `code_rename` | `useCodeRenamePropertySheet` | 改名 / 范围 slot / 规则 | 预览、写盘、命中表 |
| `code_uuid` | `useCodeUuidPropertySheet` | 范围 slot / 替换策略 | 扫描、预检/写盘、结果表 |

---

## 架构结论（P1 验证）

1. **一页一 composable**（`useXxxPropertySheet.ts`）+ store/ref 绑定 — 可继续推广 P2。
2. **`propSlot`** 承载 `WorksetScopePicker` — 够用；中期可拆 radio+enum。
3. **`hidden` + `propReadonly`** — xlink 分析 meta 动态只读可行。
4. **`schedulePrefsSave`（400ms）** — 各页复制模式，P2 可抽 `useDebouncedPersist`。
5. **主区边界** — 操作钮 + 结果表；选项不进主区表单。

---

## 主要新增文件

| 路径 |
| --- |
| `web-ui/src/composables/useXlinkFixPropertySheet.ts` |
| `web-ui/src/composables/useCodeRenamePropertySheet.ts` |
| `web-ui/src/composables/useCodeUuidPropertySheet.ts` |
| `web-ui/src/content/shellPanelToggles.ts`（页脚 tooltip，同期） |

壳层：`PagePropertiesPanel.vue` 无 sheet 时显示「当前页无可配置项」。

---

## P2 进展（接续）

- [x] `part_dedup` — 扫描/检查项迁入属性
- [ ] `step_batch` / `sw_step_export` / `file_rename`
- [ ] `propPath`（可选）
- [ ] 成员排序 · 工作集推导一级目录
