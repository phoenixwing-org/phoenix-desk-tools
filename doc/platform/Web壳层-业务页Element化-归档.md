# Web 业务页 Element 化 · 会话归档

> 状态表：[Web壳层-业务页Element化-梳理.md](Web壳层-业务页Element化-梳理.md)  
> 规划：[Web壳层-Ribbon改型-规划.md](Web壳层-Ribbon改型-规划.md) §R4  
> 归档日期：2026-06-20 · **人工 smoke 已通过**（2026-06-20）

---

## 本批已完成（已合入 · 已验收）

### P2 · CAD / Code 中页（Element）

| 项 | 说明 |
| --- | --- |
| STEP 批量 / SW→STEP | 表单与按钮 `el-*` |
| 零件去重 | 设置区 + Tab + 空态；查重 rowspan 表保留原生 |
| 链接路径修正 | 设置/筛选/确认 + `el-tag`；问题表保留原生 |
| Code 忽略 Panel | 按钮、预设、`textarea` |
| C++ 成员排序 | 工具栏 + 一级条目/变更 `el-table` + `el-pagination` |

### 壳层与其它

| 项 | 说明 |
| --- | --- |
| 顶栏 Gitee | `gitee-logo.svg` + 透明底悬停；链到 `PROJECT_GITEE_HOME` |
| Code UUID 写盘确认 | `ElMessageBox` → `promptChoice`（Cursor 预览下 MessageBox 易无响应） |
| C++ 成员排序 · GBK | `reorder_members.py` 用 `detect_and_read`（UTF-8/GBK），修复预检/写盘 400 |
| C++ 成员排序 · 写盘确认 | `promptChoice`（与 UUID 页一致） |

### P3 · 首批（已验收）

| 页 | 范围 | 状态 |
| --- | --- | --- |
| 零件目录 | 搜索/筛选/刷新/空态/状态 tag | ✅ |
| CAD 索引 | 页头、子 Tab、搜索、筛选、分页、设置区 | ✅ |
| Code 索引 | 页头、搜索模式、筛选、工作集按钮、分页 | ✅ |
| 单元测试 / BOM / 文件详情 | — | ⬜ 下一批 |

---

## 人工验收记录（2026-06-20 · 通过）

| 场景 | 结果 |
| --- | --- |
| C++ 成员排序 · `PNXBomAnalysisWsp` → 预检（GBK） | ✅ 不再 400 |
| Code / CAD 索引 · 扫描、筛选、分页、工作集加入 | ✅ |
| 零件目录 · 搜索、状态筛选、刷新 | ✅ |
| Code UUID · 执行替换（`promptChoice`） | ✅ |
| 顶栏 Gitee 图标 | ✅ |

**前置提醒**：改 Python 后端后仍需重启 `python -m phoenix.web --dev`。

<details>
<summary>完整 smoke 清单（含 P2 / 侧栏）</summary>

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

单测（可选）：`pytest tests/test_reorder_members_cpp.py tests/test_reorder_members_service.py`

---

## 约定补充（实践）

| 场景 | 推荐 |
| --- | --- |
| 侧栏 / 壳层 / Cursor 预览内写盘确认 | **`promptChoice`**（`ChoiceDialogHost` z-index 9999） |
| 配置页等标准桌面浏览器 | `ElMessageBox` 仍可用 |
| 大表 | **`ResizableDataTable` 保留**；仅迁工具栏、筛选、分页 |
| 危险操作 | 必须二次确认，禁止静默写盘 |

---

## 后续批次（P3 二批 · 计划）

> 范围：**按钮 / 工具栏 / 表单 / 确认框** Element 化；大表、装配树、NDJSON 流、复杂 Panel 结构暂保留。

| 优先级 | 页面 / 组件 | 备注 |
| --- | --- | --- |
| 1 | `unit_tests` | 体量大；先迁运行/筛选区按钮 |
| 2 | `bom_export` / `bom_apply` | CAD BOM 工具栏 |
| 3 | `file_rename` · `RenameAnalysisPanel` | 嵌入 Panel 按钮与下拉 |
| 4 | `file_detail` / `part_key_detail` | 多 Tab 子 Panel 控件 |

- `OnboardingChecklist` 待查

---

## 相关代码路径

| 主题 | 路径 |
| --- | --- |
| Element 状态表 | `doc/platform/Web壳层-业务页Element化-梳理.md` |
| 确认框 | `web-ui/src/composables/choiceDialog.ts`、`ChoiceDialogHost.vue` |
| 成员排序编码 | `phoenix/code/reorder_members.py`、`phoenix/code/rename/encoding.py` |
| 顶栏 Gitee | `web-ui/src/layout/AppToolbar.vue`、`assets/icons/gitee-logo.svg` |
