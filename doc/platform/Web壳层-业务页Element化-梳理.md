# Web 业务页 · Element Plus 迁移梳理

> 规划总纲：[Web壳层-Ribbon改型-规划.md](Web壳层-Ribbon改型-规划.md) §R4  
> 原则：**壳层与新改版页优先 Element**；旧页按模块分批，不阻塞功能；保留 `page-shared.css` 布局约定。

最后更新：2026-06-20（P3 首批已验收；**二批排期**见下方 §批次 5）

---

## 约定

| 原生 / 旧类 | Element Plus |
| --- | --- |
| `.btn` / `.btn.primary` | `el-button`（`type="primary"` / `link` / `plain`） |
| `.input` | `el-input`（工具页常用 `size="small"`） |
| `<select>` | `el-select` + `el-option` |
| checkbox / radio 组 | `el-checkbox` / `el-radio-group` |
| 原生 `<table>`（简单列表） | `el-table` |
| 空状态 `.empty` | `el-empty` |
| `window.confirm` / 写盘确认 | **`promptChoice`**（侧栏 / 壳层 / Cursor 预览）；配置页等可用 `ElMessageBox` |
| 卡片 `.card` | 暂保留（与壳层间距一致）；可选逐步换 `el-card` |

**不迁（本阶段）**：`ResizableDataTable`、装配树、文件详情复合面板——体量大，单独排期。

---

## 页面清单

| 页面 | pageId | 模块 | 状态 | 优先级 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 欢迎页 | `welcome` | 壳层 | ✅ 已完成 | — | `el-button` / `el-link` / `el-tag` / `el-empty` |
| 主页 | `home` | 壳层 | ✅ 已完成 | — | `el-checkbox` / `el-tag` / `el-icon` |
| 配置 | `config` | 壳层 | ✅ 已完成 | P1 | 主表单 + 最近列表 + `ElMessageBox` |
| 占位页 | `*` | 壳层 | ✅ 已完成 | P0 | `el-empty` |
| Code 忽略设定 | `code_ignore` | Code | ✅ 已完成 | P2 | `CodeIgnorePanel` 按钮/预设/textarea |
| Code 索引 | `code_index` | Code | ✅ 已完成 | P3 | 工具栏/筛选/分页 Element；表 `ResizableDataTable` |
| Code 批量改名 | `code_rename` | Code | ✅ 已完成 | P1 | 表单 / 表格 / 确认框 |
| Code UUID 替换 | `code_uuid` | Code | ✅ 已完成 | P1 | 表单/按钮 Element；命中表仍 `ResizableDataTable` |
| C++ 成员排序 | `reorder_members` | Code | ✅ 已完成 | P2 | 工具栏 + 条目/变更 `el-table` |
| 单元测试 | `unit_tests` | Code | ⬜ 未迁 | **P3 二批** | 多 Tab + NDJSON；**优先迁按钮/工具栏** |
| CAD 索引 | `fcstd_map` | CAD | ✅ 已完成 | P3 | 页头/子 Tab/筛选/分页 Element；表 `ResizableDataTable` |
| 文件改名分析 | `file_rename` | CAD | 🟡 部分 | **P3 二批** | `RenameAnalysisPanel` 按钮/表单 |
| 链接路径修正 | `xlink_fix` | CAD | ✅ 已完成 | P2 | 设置/筛选/确认 Element；问题表保留原生 |
| BOM 导出 | `bom_export` | CAD | ⬜ 未迁 | **P3 二批** | 工具栏/按钮 |
| BOM 应用 | `bom_apply` | CAD | ⬜ 未迁 | **P3 二批** | 工具栏/按钮 |
| STEP 批量 | `step_batch` | CAD | ✅ 已完成 | P2 | |
| SW→STEP 导出 | `sw_step_export` | CAD | ✅ 已完成 | P2 | |
| 零件去重 | `part_dedup` | CAD | ✅ 已完成 | P2 | 表单/Tab Element；查重表保留原生 |
| 零件目录 | `part_catalog` | CAD | ✅ 已完成 | P3 | 控件 Element；表 `ResizableDataTable` |
| 零件键详情 | `part_key_detail` | CAD | ⬜ 未迁 | **P3 二批** | 子 Panel 按钮 |
| 文件详情 | `file_detail` | CAD | ⬜ 未迁 | **P3 二批** | 多子 Panel；表/树保留 |

---

## 共享组件

| 组件 | 状态 | 备注 |
| --- | --- | --- |
| `WorksetScopePicker` | ✅ 已完成 | `el-radio-group` / `el-input` / `el-select` / `el-button` |
| `FileWorksetPanel` | ✅ 已完成 | 侧栏工作集；删除确认用 `promptChoice`（壳层 z-index 9999，勿用 `ElMessageBox`） |
| `SideDockPrefsPanel` | ✅ 已完成 | 配置 · 界面 |
| `OnboardingChecklist` | ⬜ | 待查 |
| `ResizableDataTable` | ⬜ 保留 | 列宽拖拽；后续可包 `el-table` 或维持现状 |
| `PageHelpButton` | ⬜ 保留 | 自定义 popover |

---

## 建议批次

1. **P0 · 小页 / 共享**：占位页、`WorksetScopePicker`、`FileWorksetPanel`、Code 批量改名  
2. **P1 · Code 工具 + 配置**：✅ UUID 替换、成员排序、配置主表单  
3. **P2 · CAD 中页**：✅ 链接修正、STEP 批量、SW 导出、零件去重、Code 忽略 Panel  
4. **P3 · 大表页（首批）**：✅ 零件目录、CAD/Code 索引（工具栏）  
5. **P3 · 大表页（二批 · 计划）**：单元测试、BOM 导出/应用、文件改名 Panel、文件/零件键详情 — **工具栏与按钮 Element 化**，`ResizableDataTable`/树/NDJSON 流保留  

---

## 验收

- [x] P0–P3 首批页 smoke 通过（2026-06-20；清单见 [归档](Web壳层-业务页Element化-归档.md)）  
- [x] `pnpm build` 通过  
- [~] 页内无裸 `.btn` / `.input`（大表页、单元测试 / BOM 等待续批次）  
- [~] 危险操作：`promptChoice`（写盘/侧栏）；配置页仍可用 `ElMessageBox`  
- [x] 本表与 `doc/TODO.md` §R4 同步  
