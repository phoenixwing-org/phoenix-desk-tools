# Web 与桌面迁移 — 待办与点检

> [文档索引](文档索引.md)  
> 状态：**进行中**（Web 壳功能页已齐；桌面 Tk 页逐步改调 `phoenix/services/`）

---

## 1. 存储路线（后续 · 取消根目录 JSON）

| 项 | 现状 | 目标 |
| --- | --- | --- |
| FCStd 索引 | **仅写** `.phoenix/cad-database.sqlite` | ✅ 已完成 |
| 属性回写 / 查条目 | 只读 SQLite（旧 JSON 仅一次性迁移入库） | ✅ 已完成 |
| XLink 脚本 | 支持 `--map-sqlite <工作空间根>` | ✅ 已完成 |
| 用户导出 | 页内 **「导出 fcstd_map.json」** 按钮（按需） | ✅ 已完成 |

**已完成（2026-05）：**

1. `fix_fcstd_xlink_paths.py` 支持 `--map-sqlite`
2. `xlink_fix_service`：读 SQLite，不再写根目录 JSON
3. `run_fcstd_map_scan`、改名：去掉自动导出
4. `try_load_fcstd_entry_from_workspace_map`：删除 JSON 回退
5. Web UI 文案与导出按钮

关联：[Phoenix工作空间存储-规划讨论.md](Phoenix工作空间存储-规划讨论.md) §2、§7。

**待办（讨论稿）：** [文件变更历史与引用证据-待办讨论.md](文件变更历史与引用证据-待办讨论.md) — P0 改名历史入库 → P1 引用证据 → P3 与 XLink 修正统一算法。

---

## 2. 各界面功能点检（Web vs 桌面 vs 服务层）

| page_id | 服务层 | Web | 桌面 Tk | 差异 / 待办 |
| --- | --- | --- | --- | --- |
| `home` | `launcher_service` | ✅ | ✅ 直连 `user_prefs` | 桌面可改调 `launcher_service`（低优） |
| `fcstd_map` | `fcstd_map_service` | ✅ | ✅ | — |
| `xlink_fix` | `xlink_fix_service` | ✅ | ✅ | — |
| `part_dedup` | `part_dedup_service` + `part_dedup_scan` | ✅ | ✅ | — |
| `step_batch` | `step_batch_service` | ✅ | ✅ | Web 无收件箱桥接 |
| `sw_step_export` | `sw_step_export_service` | ✅ | ✅ | — |
| `bom_apply` | `bom_apply_service` | ✅ 功能对齐桌面 | ⚠️ 直连核心库 | Web 已补推荐值/改名等；桌面页可改调 service |
| `bom_export` | `bom_xref_service` | ✅ | 占位 | Web：装配 BOM + 全部引用表；FreeCAD 内 Live BOM 导出仍待方案 |

**Web 独有：** 壳层布局 API（`shell-layout`）、无原生目录对话框（手输路径）、**Workbench 多 Tab**（见 [Web壳层-Tab与状态持久化-规划讨论.md](Web壳层-Tab与状态持久化-规划讨论.md)）。

**桌面 Tk 范围（已冻结）：** 不做 Tab / Workbench 等壳层改进；**仅保留**配置（`home`）、打开 Web 浏览器等最基础能力。业务页在 Tk 内仍可访问，但**不**与 Web Tab 模型对齐。

**桌面独有：** 工作空间树侧栏、XLink 结果 Treeview、STEP 收件箱桥接、原生「浏览…」对话框。

---

## 3. 代码目录：FreeCAD 与 SolidWorks 分离（建议）

**建议：是，分子包，与 `integration/` 桥接层分开。**

目标布局（分阶段迁移，非一次大挪）：

```
phoenix/
  freecad/              # FreeCAD / FCStd / STEP 批处理
    batch_step/         ← 从 phoenix/batch_step/ 迁入
    fcstd_*.py          ← 映射、BOM、嵌入属性、document_kind
    phoenix_store.py    ← CAD 索引 SQLite（FCStd 域）
    shell/freecad_exec.py
  solidworks/           # SolidWorks COM / 模型遍历
    com.py              ← integration/solidworks_com.py
    models.py           ← integration/solidworks_models.py
  integration/          # 跨进程 / 桥接（可选保留）
    inbox_bridge.py
    freecad_bridge_paths.py
  services/             # Web + 桌面共用的薄 API（按域再分子模块亦可）
  pages/                # 仅 Tk UI（逐步变薄，只调 services）
  web/                  # FastAPI + 静态前端
```

**原则：**

- `freecad/` 与 `solidworks/` **不互相 import**（除 `services` 编排层）。
- 旧路径保留 **兼容 re-export** 一个版本周期，例如 `phoenix.integration.solidworks_com` → `phoenix.solidworks.com`。
- `services/sw_step_export_service.py` 只 import `phoenix.solidworks.*`；`step_batch_service` 只 import `phoenix.freecad.*`。

**优先级：** 桌面页改调 services **先于** 物理挪目录（避免双重重构）。

**状态（2026-05）：** 已完成物理迁移；旧路径（`phoenix.batch_step`、`phoenix.fcstd_*`、`phoenix.integration.solidworks_*`、`phoenix.shell.freecad_exec` 等）保留 **shim re-export**，新代码请用 `phoenix.freecad.*` / `phoenix.solidworks.*`。

---

## 4. 当前迭代任务

- [x] Web：xlink / part_dedup / step_batch / sw_step_export 页面 + API
- [x] 桌面：`fcstd_map_page` → `fcstd_map_service`
- [x] 桌面：`part_dedup` → `part_dedup_service`
- [x] 桌面：`xlink_fix` → `xlink_fix_service`
- [x] 桌面：`step_batch_page` → `step_batch_service`（保留 inbox）
- [x] 桌面：`sw_step_export_page` → `sw_step_export_service`
- [ ] 桌面：`bom_apply_page` → `bom_apply_service`（可选分步）
- [ ] **文件变更历史**：`rename_log` 表 + 改名时写入（见 [文件变更历史与引用证据-待办讨论.md](文件变更历史与引用证据-待办讨论.md) P0）
- [ ] **引用证据 / 改名传播**：扫描旧名引用、修正 XLink（P1–P2，同上）
- [ ] **ReferenceFix 统一算法**：与 `xlink_fix` 共用抽象（P3，同上）
- [x] P 后续：取消自动 `fcstd_map.json`（§1）
- [x] **Web 壳层 Tab / session 持久化**（P0–P4，见 [Web壳层-Tab与状态持久化-规划讨论.md](Web壳层-Tab与状态持久化-规划讨论.md)）
- [ ] **Web 壳层**：其余工具页（xlink、step_batch…）可选 session 快照
