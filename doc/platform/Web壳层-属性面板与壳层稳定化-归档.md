# Web 壳层 · 属性面板与壳层稳定化 · 会话归档

> 前置：[Web壳层-页面属性面板-P2续归档.md](Web壳层-页面属性面板-P2续归档.md)  
> 规划：[Web壳层-页面属性面板-规划.md](Web壳层-页面属性面板-规划.md)  
> 最后更新：2026-06-22

---

## 验收总览

| 项 | 状态 |
| --- | --- |
| 属性面板 **Maximum recursive updates**（多页切换 / KeepAlive） | ✅ |
| `PageHeader` 样式（`page-shared.css` 非 scoped 引入） | ✅ |
| 默认侧栏停靠：属性左上、日志左下、树/工作集右侧 | ✅ |
| 页脚「工作集」按钮高亮与切换反馈 | ✅ |
| 成员排序 · 变更文件表「状态」列（预检 / 已写盘） | ✅ |
| 属性名称列宽拖拽 → `shell_layout` PATCH 422（浮点 px） | ✅ |

---

## 现象摘要

1. **递归更新**：在 Code 忽略 → Code 索引 → 单元测试 → 引用测试工程等路径切换 Tab 时，Vue 报 `Maximum recursive updates exceeded`（涉及 `CodeIgnorePage`、`PagePropertiesPanel` 等）。根因是属性 sheet 反复 `register`、宿主 `activeSheet` 每次新建 `Map`、字段 `onChange` 同值仍写 store、以及 `hint`/`options` 每次 render 为新引用触发子组件更新。
2. **页头样式**：`PageHeader.vue` 使用 scoped 样式时未加载 `page-shared.css`，部分工具页（如 C++ 成员排序）页头布局错乱。
3. **壳层默认布局**：新用户期望属性与日志同在左侧上下分栏，工作空间树与工作集在右侧；原默认日志在右侧。
4. **工作集按钮**：页脚「工作集」点击后侧栏无足够视觉反馈，用户误以为无响应。
5. **成员排序结果表**：「变更文件」仅路径，预检与写盘后无法区分执行状态。
6. **列宽持久化 422**：拖拽名称列产生浮点 `width`，后端 `properties_name_col_width_px: int` 校验失败，前端仅显示 `[object Object]`。

---

## 修复要点

### 属性面板注册与渲染

| 路径 | 说明 |
| --- | --- |
| `usePagePropertySheet.ts` | `build` 一次 + `onMounted` 注册；去掉 `watchEffect` 反复 `register` |
| `pagePropertiesHost.ts` | `reactive(Map)` 替代每次 `new Map()`，避免无关页注册触发 `activeSheet` 刷新 |
| `PagePropertiesPanel.vue` | 根节点不再 `v-if` 翻转；折叠 watch 仅跟 `pageId`、`flush: 'post'`；列宽 `Math.round` + `clamp` |
| `PagePropertyFieldRow.vue` | bool/select/string/number/path **同值跳过 onChange**；`hint`/`options` 支持 computed |
| `useCodeIgnoreForm.ts` | `applyingPrefs` 防止 `loadPrefs` 后 `el-select @change` 误触发 |
| `useWorksetScopePropertyGroups.ts` | `options` 传 computed；`onScopeModeChange` 同值跳过 |
| `useReorderMembersPropertySheet.ts` / `useCodeUuidPropertySheet.ts` | `hint` 改为 `computed` |
| `reorderMembersPage.ts` | `setKevinSystemCodeMode` 同值不 persist |

### 壳层与 API

| 路径 | 说明 |
| --- | --- |
| `PageHeader.vue` | 非 scoped 块 `@import page-shared.css` |
| `useAppShell.ts` | 默认 `shell_log_dock: "left"`；`sanitizeShellLayoutPatch` 整数化各 px 字段 |
| `user_prefs.py` | 默认 `shell_log_dock` 与前端一致 |
| `useShellPanelToggles.ts` / `ShellPanelToggleBar.vue` | `worksetOpen` 高亮、切换 try/catch 与状态栏提示 |
| `api.ts` | `formatApiErrorDetail` 格式化 FastAPI 422 详情 |

### 成员排序

| 路径 | 说明 |
| --- | --- |
| `ReorderMembersPage.vue` | `ChangedFileRow { path, status: 'dry_run' \| 'written' }`；列「状态」`el-tag` |

---

## 验证

- 手工：Code 忽略 → Code 索引 → 单元测试 → 引用测试工程，**一遍无递归报错**
- 手工：属性名称列宽拖拽后刷新，launcher 持久化正常、无 422
- 手工：成员排序预检 / 写盘后变更文件表状态列正确

---

## 明确未做（下一批）

- [ ] P3 二批人工 smoke（单元测试 / BOM / 改名 / 文件详情 / 零件详情）
- [ ] 图纸档：编辑属性只读提示与来源模型跳转体验统一
- [ ] 成员排序 · 变更 Diff 预览（待研究稿）

**结论**：属性面板多页 KeepAlive 稳定；壳层默认布局与工作集 UX 对齐预期；`shell_layout` 整数校验与错误展示已闭环。
