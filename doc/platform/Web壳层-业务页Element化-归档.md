# Web 业务页 Element 化 · 会话归档

> 状态表：[Web壳层-业务页Element化-梳理.md](Web壳层-业务页Element化-梳理.md)  
> 规划：[Web壳层-Ribbon改型-规划.md](Web壳层-Ribbon改型-规划.md) §R4  
> 最后更新：2026-06-22

---

## 验收状态总览

| 批次 | 实现 | 人工 smoke |
| --- | --- | --- |
| P0–P2 | ✅ | ✅（随 P3 首批一并验收） |
| P3 首批 | ✅ | ✅ 2026-06-20 通过 |
| **P3 二批** | ✅ 2026-06-21 | **[~] 等待人工验证**（见 [TODO §R4](../TODO.md) · 下方清单） |

---

## P2 · CAD / Code 中页（Element）

| 项 | 说明 |
| --- | --- |
| STEP 批量 / SW→STEP | 表单与按钮 `el-*` |
| 零件去重 | 设置区 + Tab + 空态；查重 rowspan 表保留原生 |
| 链接路径修正 | 设置/筛选/确认 + `el-tag`；问题表保留原生 |
| Code 忽略 Panel | 按钮、预设、`textarea` |
| C++ 成员排序 | 工具栏 + 一级条目/变更 `el-table` + `el-pagination` |

## 壳层与其它（P2 同期）

| 项 | 说明 |
| --- | --- |
| 顶栏 Gitee | `gitee-logo.svg` + 透明底悬停；链到 `PROJECT_GITEE_HOME` |
| Code UUID 写盘确认 | `ElMessageBox` → `promptChoice`（Cursor 预览下 MessageBox 易无响应） |
| C++ 成员排序 · GBK | `reorder_members.py` 用 `detect_and_read`（UTF-8/GBK），修复预检/写盘 400 |
| C++ 成员排序 · 写盘确认 | `promptChoice`（与 UUID 页一致） |

## P3 · 首批（2026-06-20 · smoke ✅）

| 页 | 范围 |
| --- | --- |
| 零件目录 | 搜索/筛选/刷新/空态/状态 tag |
| CAD 索引 | 页头、子 Tab、搜索、筛选、分页、设置区 |
| Code 索引 | 页头、搜索模式、筛选、工作集按钮、分页 |

### 人工验收记录（2026-06-20 · 通过）

| 场景 | 结果 |
| --- | --- |
| C++ 成员排序 · `PNXBomAnalysisWsp` → 预检（GBK） | ✅ 不再 400 |
| Code / CAD 索引 · 扫描、筛选、分页、工作集加入 | ✅ |
| 零件目录 · 搜索、状态筛选、刷新 | ✅ |
| Code UUID · 执行替换（`promptChoice`） | ✅ |
| 顶栏 Gitee 图标 | ✅ |

**前置提醒**：改 Python 后端后仍需重启 `python -m phoenix.web --dev`。

<details>
<summary>完整 smoke 清单（P2 / P3 首批 / 侧栏）</summary>

| # | 场景 | 预期 |
| --- | --- | --- |
| 1 | C++ 成员排序 · GBK 目录 → 预检 | 200；无 utf-8 decode 错误 |
| 2 | 成员排序 · 执行排序 | `promptChoice` 确认 |
| 3 | Code UUID · 执行替换 | 壳层确认框 |
| 4 | 侧栏工作集 · 删除 | `promptChoice` |
| 5 | 顶栏 Gitee | 新标签打开仓库 |
| 6 | P2 CAD 页 | Element 表单；大表可滚动 |
| 7 | CAD/Code 索引 | 工具栏 + 表拖拽 |
| 8 | `pnpm build` | 通过 |

</details>

---

## P3 · 二批（2026-06-21 · 实现 ✅ · smoke 延后）

> 范围：**按钮 / 工具栏 / 表单 / 确认** Element 化；大表、装配树、NDJSON 流、复杂内嵌表保留原生。

| 页 / 组件 | 迁移范围 | 保留原生 |
| --- | --- | --- |
| `unit_tests` | 运行范围勾选、运行/终止、Tab、模块列表（含行内运行/排序/次数）、失败关注、结果筛选 | 关注表、用例明细、NDJSON 进度条 |
| `bom_export` | 顶栏重建、子 Tab、搜索/刷新、`el-alert` | `ResizableDataTable` 总成表 |
| `file_rename` | 模式 Tab、表单、`el-select`、操作栏 | — |
| `RenameAnalysisPanel` | 修正/Label 按钮、`el-checkbox`、`el-tag` | 宿主列表结构 |
| `file_detail` / `bom_apply` | 子 Tab；各 Panel 工具栏按钮 | 引用/装配表、装配树 |
| `part_key_detail` | 检索栏、属性表单、保存、关联文件操作列 | `ResizableDataTable` |

### 单元测试页补充（二批内）

- 模块列表 `el-table` + **行内「运行」**
- 运行次数 / 最近执行 · `localStorage`（`unitTestModuleHistory`）
- 排序：默认 / 最近运行 / 运行次数

### 待做 · 人工 smoke（等待人工验证）

实现已归档；下列场景需在本机工作空间 **人工点验**，通过后可在 [TODO §R4](../TODO.md) 勾选。

| # | 场景 | 要点 |
| --- | --- | --- |
| 1 | **单元测试** | 套件运行；模块行内运行；失败关注复测/排序 |
| 2 | **BOM 列表** | 子 Tab、筛选、刷新、仅重建引用表 |
| 3 | **改名分析** | 历史/手填模式、开始分析、`RenameAnalysisPanel` 写回 |
| 4 | **文件详情** | 各 Tab：属性/编辑/引用/装配/改名 Panel 按钮 |
| 5 | **零件详情** | PartKey 检索、属性保存、关联文件操作 |

单测（可选）：`pytest tests/test_reorder_members_cpp.py tests/test_reorder_members_service.py`  
构建：`cd web-ui && pnpm build`

---

## 约定补充（实践）

| 场景 | 推荐 |
| --- | --- |
| 侧栏 / 壳层 / Cursor 预览内写盘确认 | **`promptChoice`**（`ChoiceDialogHost` z-index 9999） |
| 配置页等标准桌面浏览器 | `ElMessageBox` 仍可用 |
| 大表 | **`ResizableDataTable` 保留**；仅迁工具栏、筛选、分页 |
| 危险操作 | 必须二次确认，禁止静默写盘 |

---

## 后续（非 Element 批次）

- `OnboardingChecklist` 待查
- 大表/树全面 Element 化 — 单独排期（见梳理 doc「不迁」项）

---

## 相关代码路径

| 主题 | 路径 |
| --- | --- |
| Element 状态表 | `doc/platform/Web壳层-业务页Element化-梳理.md` |
| 单元测试模块历史 | `web-ui/src/utils/unitTestModuleHistory.ts` |
| 确认框 | `web-ui/src/composables/choiceDialog.ts`、`ChoiceDialogHost.vue` |
| 成员排序编码 | `phoenix/code/reorder_members.py`、`phoenix/code/rename/encoding.py` |
| 顶栏 Gitee | `web-ui/src/layout/AppToolbar.vue`、`assets/icons/gitee-logo.svg` |
