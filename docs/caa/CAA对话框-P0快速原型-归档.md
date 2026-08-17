# CAA 对话框 · P0 快速原型 · 归档

> 规划：[CAA对话框-Web编辑器-规划.md](CAA对话框-Web编辑器-规划.md)  
> 索引/多 Tab（未做）：[CAA对话框索引与多Tab-规划.md](CAA对话框索引与多Tab-规划.md)  
> 待办：[TODO-CAA.md](../TODO-CAA.md)  
> 分支：`CAA` · 归档日：**2026-06-23**

---

## 验收总览

| 里程碑 | 状态 | 说明 |
| --- | --- | --- |
| C0 · 文档与架构拍板 | ✅ | 单前端双后端、TS `catdlg-core`、Python 无 CAA 业务 |
| C0b · 脚手架 | ✅ | `packages/catdlg-core` + `server/caa` + Vite `/api/caa` 代理 |
| C1 · 解析 | ✅（无 Vitest） | `parseCatDlg` / `parseCatNls` / `mergeIr` + `POST …/parse` |
| C2 · Web 只读预览 | ✅（P0 范围） | 页 + 画布 + 壳层侧栏 + Ribbon |
| C2b · `phoenix_caa_*` 索引 | ⬜ | 仅规划稿 |
| C2c · 多 Tab | ⬜ | 仅规划稿 |
| C3+ · 写回 / Wizard | ⬜ | — |

**P0 结论**：`PNXBomAnalysisDlg` 样例可 **解析 → IR → Web 预览**，结构（Grid、Frame、常见控件、NLS 标题）与 CAA Dialog Editor 同类信息一致；可替代 RADE **布局只读查看** 的验证目标达成。**未**做写回、拖拽编辑、工作空间任意文件打开。

---

## 架构（已落地）

```text
web-ui :5173
  /api/caa/*  →  server/caa :5180  (Hono · catdlg-core)
  /api/*      →  phoenix/web :8765  (Python · 无 CAA 业务)
```

| 层 | 路径 |
| --- | --- |
| 解析 / IR | `packages/catdlg-core/` |
| HTTP | `server/caa/src/routes/dialog.ts` |
| 前端 | `web-ui/src/pages/CaaDialogEditorPage.vue` + `components/caa/` |
| 壳层 | 左栏控件树 + 属性面板；Ribbon **Code → CAA** 独立分组 |

**开发启动**：

```bash
python -m phoenix.web --dev
pnpm dev:caa    # 或 cd server/caa && npx tsx src/server.ts
```

---

## 后端 · `catdlg-core` + Node

| 能力 | 说明 |
| --- | --- |
| `parseCatDlg` | 支持 `CATDlgType Name` 与 `{` **分行**（CAA 常见格式） |
| `parseCatNls` | Title / Help / ColumnTitle* |
| `mergeIr` | 建树、`FATHER` 挂接、合并 NLS |
| `PNX_BOM_ANALYSIS_DEMO` | `tests/fixtures/PNXCaaStudy/…/PNXBomAnalysisDlg.CATDlg` |
| API | `GET /api/caa/health` · `POST /api/caa/dialog/parse`（`demo: true` 或 `workspaceRoot` + `catDlgRel`） |

---

## 前端 · 页面与壳层

### 主区

| 组件 | 职责 |
| --- | --- |
| `CaaDialogEditorPage` | 健康检查、加载样例、错误/离线横幅 |
| `CaaDialogCanvas` | 灰底画布；对话框左上对齐 |
| `CaaDialogNodeView` | Dialog / Frame / Label / Button / Editor / SelectorList / MultiList 预览 |
| `CaaDialogGrid` | `GRID` 布局；`fillParent` 时 COLRES/ROWRES 用 `fr`，控件宽 100% |
| `caaControlMetrics` | 对话框固定外框 **500px**（`CAA_DIALOG_PREVIEW_WIDTH_PX`） |

### 左栏（CAA 页自动展开）

| 块 | 实现 |
| --- | --- |
| **控件树** | `CaaDialogTreePanel` · `SidebarBlock` · `sideDockLayout.leftShowCaaTree` |
| **属性** | `useCaaDialogPropertySheet` → `PagePropertiesPanel`（对话框 / 选中控件 / Grid / 尺寸 / NLS） |

### Ribbon

- **Code → 编辑**：成员排序 · 批量改名 · UUID · 忽略设定  
- **｜ CAA**：**CAA 对话框**（竖线分隔独立组）

### 属性表 UX（同期）

- `PagePropertyFieldRow`：只读 `info` 字段 **单行省略**，悬停 `title` 看全路径；值列 `overflow: hidden`

---

## 主要文件清单

```text
packages/catdlg-core/src/
  parseCatDlg.ts · parseCatNls.ts · mergeIr.ts · schema.ts · demoPaths.ts
server/caa/
  src/server.ts · src/routes/dialog.ts · README.md
web-ui/src/
  pages/CaaDialogEditorPage.vue
  components/caa/CaaDialog*.vue
  composables/useCaaDialogPropertySheet.ts
  stores/caaDialogPage.ts
  api/caaDialog.ts · types/caaDialogIr.ts
  utils/caaDialogTree.ts · caaControlMetrics.ts
  layout/ribbon/ribbonConfig.ts
  utils/sideDockLayout.ts          # leftShowCaaTree
phoenix/config/app_config.json     # navigation + caa_dialog max_tabs: 1
```

---

## 已知限制（P0）

| 项 | 说明 |
| --- | --- |
| 样例依赖 | `tests/fixtures/PNXCaaStudy` symlink；无 fixture 时 demo 解析失败 |
| 单 Tab | `caa_dialog.max_tabs: 1`；全局 `caaDialogPage` store |
| 无索引库 | 未实现 `phoenix_caa_*`；无侧栏「对话框索引」检索块 |
| 树未联动文件 | 工作空间树点 `.CATDlg` 未路由到 CAA 页 |
| 无写回 | `.CATDlg` / `.CATNls` emit 未做 |
| 无单测 | `catdlg-core` Vitest 未加 |
| 画布选中 | 点击控件高亮未做；仅控件树选中 |
| 进程 | `phoenix.web --dev` 不自动拉起 Node CAA 服务 |

---

## 后续（见 TODO-CAA）

1. **C2b** — `phoenix_caa_*` 扫描 + FTS + 左栏可折叠「对话框索引」  
2. **C2c** — `max_tabs: 8`、每对话框一 Tab、树点 `.CATDlg`、Tab 级 store  
3. **C3** — IR 写回 + diff 预览  
4. **C4** — `.h` / `.cpp` Wizard 段、更多控件类型  

---

## 决策记录（本阶段）

| 项 | 决策 |
| --- | --- |
| 回调 / Agent | **不做** |
| Python CAA 业务 | **不做** |
| 对话框预览外框 | 固定 **500px**，内部 Grid/控件 **100% 铺满** |
| 属性 / 控件树 | 迁入 **壳层侧栏 block**，不占主区三栏 |
| 索引库命名（规划） | **`phoenix_caa_*`**，与 `phoenix_code_*` 同库 |

---

*维护：C2b 起可另开「索引归档」；写回落地后更新本文件或链到新归档。*
