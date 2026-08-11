# CAA 对话框 · 索引 / 检索 / 多 Tab — 规划

> 关联：[CAA对话框-Web编辑器-规划.md](CAA对话框-Web编辑器-规划.md) · [Phoenix工作空间存储-规划讨论.md](../platform/Phoenix工作空间存储-规划讨论.md)  
> 状态：**研讨稿**（2026-06-23）  
> 背景：P0 仅 demo 单对话框；工作空间内常有 **多个 `.CATDlg`**（同 `*UI.m` 下主对话框 + ParamDlg 等），需可发现、可检索、可多 Tab 编辑。

---

## 1. 用户场景

| 场景 | 期望 |
| --- | --- |
| 打开 CAA 页 | 不只加载 demo，而是看到**当前工作空间内所有对话框** |
| 多个对话框 | 按 **模块组** 折叠展示（如 `PNXBomAnalysisUI.m` 一组含 `PNXBomAnalysisDlg` + `PNXBomAnalysisParamDlg`） |
| 检索 | 按对话框名、Title、路径片段 **FTS 搜索** |
| 打开方式 | ① 在索引里点一项 → **新开/激活 Tab**；② 工作空间树点 `.CATDlg` → 同上 |
| 收缩 | 左侧 **可折叠「对话框索引」块**（与控件树、属性并列），默认展开；可收起让出画布 |

---

## 2. 库表命名：`phoenix_caa_*`

与现有域对齐，**写入工作空间 SQLite**（与 `phoenix_code_*`、`phoenix_cad_*` 同库）：

| 表 | 说明 |
| --- | --- |
| `phoenix_caa_scan` | 扫描批次（`scanned_at`, `scan_root`, `stats_json`） |
| `phoenix_caa_dialog` | **一行 = 一个 `CATDlgDialog` 根**（一个 `.CATDlg` 文件通常一行） |
| `phoenix_caa_dialog_group` | **对话框组**（可选；见 §3） |
| `phoenix_caa_dialog_group_member` | 组 ↔ 对话框多对多（同组内 ParamDlg 与主框） |

**`phoenix_caa_dialog` 字段（草案）**

| 列 | 说明 |
| --- | --- |
| `id` | INTEGER PK |
| `repo_rel_catdlg` | `.CATDlg` 仓库相对路径，UNIQUE |
| `dialog_name` | 根控件 ID，如 `PNXBomAnalysisDlg` |
| `title` | 来自 `.CATNls` 的 `Title`（索引时轻量解析或读旁路 Nls） |
| `repo_rel_catnls` | 推断或扫描到的 Nls 路径 |
| `repo_rel_catrsc` | 可选 |
| `repo_rel_h` / `repo_rel_cpp` | 同模块 Wizard 文件（只读关联，P2） |
| `group_key` | 分组键，见 §3 |
| `control_count` | 索引时统计 |
| `file_status` | `present` / `missing`（与 Code 索引一致） |
| `last_seen_at` / `updated_at` | 扫描时间 |

**全文检索**：复用库内 FTS 模式，增 `phoenix_caa_dialog_fts`（`dialog_name`, `title`, `repo_rel_catdlg`, `group_key`）或并入统一 `catalog_fts` 的 `entity_type=caa_dialog`。

**谁写库**：**Python** `phoenix/caa/`（仅 schema + scan + search API），与 `phoenix/code/` 索引同级；**Node 不写 SQLite**。

**谁解析**：索引阶段 **轻量**（正则提 `CATDlgDialog Name` + Nls 路径启发式）；**完整 IR** 仍走 Node `POST /api/caa/dialog/parse`。

---

## 3. 「对话框组」怎么划

推荐 **默认按 CAA 模块目录**（与 RADE 工程结构一致）：

```text
…/PNXBomAnalysisUI.m/
  LocalInterfaces/
    PNXBomAnalysisDlg.CATDlg      ← 组内成员
    PNXBomAnalysisParamDlg.CATDlg
```

| 策略 | `group_key` 示例 | 组标题 |
| --- | --- | --- |
| **P1 默认** | `PNXBomAnalysisUI.m`（含路径后缀亦可） | 目录取 `*UI.m` 父目录名 |
| 可选 P2 | Workshop / Frame 名（从路径 `*Wsp/*Frm` 解析） | 更大粒度浏览 |

组内列表：**按 `dialog_name` 排序**；主对话框（与 `*UI.m` 同名前缀）可标 `is_primary` 启发式，非硬依赖。

---

## 4. API（Python）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/caa/index/scan` | 扫描工作空间内 `*.CATDlg`，写 `phoenix_caa_*` |
| `GET` | `/api/caa/index/groups` | 分组列表 + 每组对话框摘要（可 `?q=` FTS） |
| `GET` | `/api/caa/index/dialogs` | 扁平列表 / 搜索 |
| `GET` | `/api/caa/index/dialogs/{id}` | 单条元数据（含 catdlg/nls 相对路径） |

解析 IR：**仍** `POST /api/caa/dialog/parse`（Node），body 传 `workspaceRoot` + `catDlgRel`。

---

## 5. 前端：收缩块 + 多 Tab

### 5.1 左侧「对话框索引」块

| 项 | 说明 |
| --- | --- |
| 位置 | 左栏 **控件树上方或下方**（与 `leftShowCaaTree` 同侧）；`SidebarBlock` + 可折叠 |
| 内容 | 搜索框 + **按组折叠** 的 `el-collapse` / 树；每组下为对话框项 |
| 操作 | 点击项 → `openCaaDialogTab(rel)`；右键「在新 Tab 打开」 |
| 刷新 | 「重新索引」→ `POST /api/caa/index/scan` |
| 空态 | 未扫描时提示先索引或打开含 CAA 的工作空间 |

### 5.2 Tab 工作台

`app_config.json` 中 **`caa_dialog.max_tabs` 改为 8**（与 `file_detail` 同级）：

```json
"caa_dialog": { "max_tabs": 8, "tab_enabled": true }
```

| 字段 | 值 |
| --- | --- |
| `pageId` | `caa_dialog` |
| `contextKey` | `repo_rel_catdlg`（如 `…/PNXBomAnalysisDlg.CATDlg`） |
| `title` | Nls Title 或 `dialog_name` |
| `subtitle` | 文件名 / 组名 |
| `payload` | `{ caaDialog: { catDlgRel, catNlsRel? } }` |

**同一 `.CATDlg` 复用 Tab**（`contextKey` 相同则激活，不重复开）。

### 5.3 工作空间树联动

`dispatchTreeSelect` 扩展：若路径匹配 `\.CATDlg$` → `openCaaDialogTab(rel)`（与 `.FCStd` → 文件详情对称）。

### 5.4 页内状态

- **Pinia `caaDialogPage`** 从「全局单例」改为 **按 Tab**（`usePageSession` / `workbenchTabId`），每 Tab 独立 IR、`selectedId`、dirty。
- 无 Tab payload 时保留 demo 按钮（开发用）。

---

## 6. 数据流

```text
工作空间根
    │
    ▼
POST /api/caa/index/scan  (Python)
    │  glob **/*.CATDlg
    │  轻量 parse dialog_name + 推断 nls/group_key
    ▼
phoenix_caa_dialog + FTS
    │
    ▼
GET /api/caa/index/groups?q=…  →  左侧索引块
    │
    ▼ 用户选择
openTab(caa_dialog, contextKey=catdlgRel)
    │
    ▼
POST /api/caa/dialog/parse  (Node)  →  IR  →  Canvas + 控件树 + 属性
```

---

## 7. 分阶段

| 阶段 | 交付 |
| --- | --- |
| **C2b** | `phoenix_caa_*` schema + scan + groups API + 索引侧栏块（只读列表） |
| **C2c** | `max_tabs=8` + `openCaaDialogTab` + 树点 `.CATDlg` + Tab 级 store |
| **C3** | 索引与写回后自动 `rescan`；组内「全部打开」 |

---

## 8. 决策记录

| 项 | 决策 |
| --- | --- |
| 表前缀 | **`phoenix_caa_*`**（与 `phoenix_code_*` 并列，勿用裸 `caa_`） |
| 索引写库 | **Python**；CAA 业务解析 **Node** |
| 组默认键 | **`*UI.m` 模块目录** |
| 打开形态 | **每对话框一个 Tab**（推荐）；单页内切换为组内二级 UI（不采纳，与壳层 Tab 习惯不一致） |

---

*维护：实现启动后更新 [TODO-CAA.md](../TODO-CAA.md) 里程碑。*
