# Phoenix Web / 后端 — 总待办

> 汇总跨模块待办；细项研究稿见 [文档索引.md](文档索引.md)。  
> 状态：`[ ]` 未做 · `[~]` 进行中 · `[x]` 已完成

最后更新：2026-06

---

## P0 — 性能 / 正确性（引用与索引）

- [x] 出向引用：`JOIN file_asset`，去掉 `get_file_asset_bom_fields` N+1（见 [出向引用-N+1查库-研究.md](cad/出向引用-N+1查库-研究.md)）
- [x] `bom_xref` 冗余 `rule_label` + 子件 BOM 快照；查询单表、不读盘补 Label
- [x] 文件详情：引用 Tab 懒加载、分 scope 请求、角标单条 SQL
- [ ] `rebuild_bom_tree_occurrences`：邻接表只查一次，消除 per-host 重复全表 SQL
- [x] `query_bom_xrefs_incoming`：合并 `get_file_asset_id` 为单条 SQL
- [ ] 改名 XLink 修正 + **同步引用 Label**：`apply_host_xlink_corrections(sync_reference_labels=True)` 在目标文件尚未改名、且无 CAD 索引时应仍从磁盘 FCStd 读 rule Label（现会退化为 basename）；补单测：单引用、同 Group 双 XLink 的 `.002` 后缀、跨路径同目标不重复编号（见 [改名引用写回-装配Label同步-需求.md](cad/改名引用写回-装配Label同步-需求.md)）
- [ ] 内部装配 **结构感知 BOM 挂载**：优先入度 0 的顶 `App::Part`（样例 `PCB` 非 `_6222656233`），见 [samples/内部装配示例-挂载分析.md](cad/samples/内部装配示例-挂载分析.md) + `tests/fixtures/workspaces/minimal/document-xml/`

---

## P1 — 文件详情 / BOM

- [x] 装配结构 Tab：`v-show` + 缓存，切换不重复请求
- [x] 编辑属性 Tab：显示文档类型（零件/装配/图纸 + 推荐后缀）
- [x] 属性「全部推荐」：单次 API + 不读 FCStd（文件名/索引/记忆）
- [x] 改名 Tab：显示改名记录 → 跳转「改名分析」页（不再内嵌引用表）
- [ ] 引用/装配「改链接」后自动刷新相关 Tab 缓存（部分已有 `invalidate*`）
- [ ] 图纸档：编辑属性只读提示与来源模型跳转体验统一

---

## P1 — Web 壳层 / UX

- [x] **配置**：居中 Modal 弹层；工作空间 **浏览…** 走 Python 原生选目录（macOS osascript）
- [x] 配置：未扫描工作空间时提示并跳转 **CAD 索引**
- [x] **Code · C++ 成员排序** Web 页：一级子目录勾选 + 后台排序 + 运行日志（见 [成员函数排序-reorder_members.md](code/成员函数排序-reorder_members.md)）
- [x] **主页 · 导航模块偏好**（见下方 §导航模块偏好）
- [x] **工作空间树**：Code 模块偏好下默认筛选 `.h/.cpp` 等（见 §导航模块偏好）
- [ ] 桌面 `fcstd_map_page` 分页，去掉 `load_fcstd_document` 全表
- [ ] 统一运行日志：长任务进度条 / 取消（见 [统一运行日志窗口-规划讨论.md](platform/统一运行日志窗口-规划讨论.md)）
- [x] **单元测试 Web 页**：套件勾选运行、NDJSON 流式进度、终止；失败关注 Tab（排序 / 勾选复测 / 简介列）；Pinia 持久化选项与勾选

### 导航模块偏好（主页勾选 → 左侧只显示已选）

> **存储建议**：放本机 **`launcher.json`**（与 `shell_layout` 同级），**不放**工作空间 JSON/SQLite——这是「本机要哪些工具栏入口」，与工作空间无关。  
> 字段草案：`nav_modules.enabled: ["cad", "code"]` 或 `nav_pages.visible: ["fcstd_map", …]`（二选一，实现时定）。

- [x] `app_config.json`：`navigation[]` 每项加 `module`（如 `cad` / `code`）；`home`、`config` 始终显示
- [x] 主页「功能模块」区：CAD / Code 多选勾选（可全选）；保存到 `launcher.json`
- [x] API：`PATCH /api/config/launcher/nav-modules`（并入 launcher 偏好）
- [x] `NavSidebar.vue` + `HomePage.vue`：按偏好过滤；未勾选的模块不在侧栏出现
- [x] 当前页被隐藏时自动跳主页；Workbench Tab 策略与隐藏页一致
- [x] 单测：`user_prefs` 读写、`nav_modules` 默认全选
- [x] **工作空间树 · 按模块切换筛选**：仅 **Code** 时侧栏为 `.cpp` / `.h/.hpp`；仅 **CAD** 时为 FCStd / .sldprt；双模块时按当前页所属模块默认

---

## P2 — 产品 / 仓库重命名（`phoenix-desk-tools` · 已落地）

> 对外品牌：**`phoenix-desk-tools`**；工作空间偏好：**`phoenix-workspace-prefs.json`**（与 `phoenix-workspace.sqlite` 成对）。

| 对象 | 新名 | 状态 |
| --- | --- | --- |
| Git / Gitee 仓库 | **`phoenix-desk-tools`** | [x] 远程已改为 `https://gitee.com/PhoenixWing321/phoenix-desk-tools.git` |
| 工作空间偏好 JSON | **`.phoenix/phoenix-workspace-prefs.json`** | [x] 已实现；读时兼容 `phoenix-freecad-desktop.json` |
| PyPI / `pyproject.toml` / `package.json` | **`phoenix-desk-tools`** | [x] |
| Python import 包 | `phoenix` | 不变 |

- [x] 常量 `WORKSPACE_PREFS_BASENAME` → `phoenix-workspace-prefs.json`；读时兼容旧文件名
- [x] 主要文档 / 注释 / README 替换
- [x] Gitee 远程仓库改名 + 本地 `git remote`
- [ ] 可选：`PHOENIX_WORKSPACE_PREFS` 环境变量覆盖 basename

---

## P2 — 包重命名（`fcdesk` → `phoenix`）

> Python **import 包名**与目录 `phoenix/` 对齐；Gitee 仓库名目标 **`phoenix-desk-tools`**（见上方 §产品/仓库重命名）。

- [x] 目录 `phoenix/`、文档与 `python -m phoenix` 命令
- [x] `pyproject.toml`：`include = ["phoenix*"]`，入口 `phoenix-desktop` + 旧名 `phoenix-desktop`
- [x] `launcher_paths.py`：`_APP_ID` → `phoenix`，迁移读取 `phoenix-wing/fcdesk/`
- [x] 全仓 `from phoenix`（无残留 `from fcdesk`）
- [~] 环境变量 `PHOENIX_*`（`FCDESK_*` 仍兼容）
- [x] Web localStorage 兼容读旧 `fcdesk.workbench.v1:`
- [ ] 异常类 / 常量重命名（`PhoenixFcstdEmbeddedError` 等，可选）
- [x] 删除重复目录 `fcdesk/`

---

## P2 — 清理 / 技术债

- [x] 删除 `_enrich_tree_node` 死代码（无调用方）
- [x] `query_target_usage_stats` 统计合并为单条 SQL（明细列表仍单独查）
- [x] 旧库 `bom_xref.link_label` / `rule_label` 为空：见下方运维备忘
- [x] `FIX_CODE.py`：仓库中已不存在，无需处理

---

## P2 — 数据库命名（schema v10 · 已落地）

> 现网：[CAD数据库表结构.md](cad/CAD数据库表结构.md) · 库文件：`.phoenix/phoenix-workspace.sqlite`

- [x] `phoenix_schema.py` + v10 DDL（`phoenix_cad_*` / `phoenix_audit_*` / `phoenix_meta` / `phoenix_ui_session`）
- [x] 不迁移旧库：`connect()` / `GET …/database/status` 自动删除 `cad-database.sqlite`、`phoenix-cad.sqlite`；`phoenix-workspace.sqlite` 含旧表名时一并删除；Web 仍可 **确认重建** 空库
- [x] `GET/POST /api/phoenix/database/*` + AppShell 旧库提示条
- [x] 用户向文档库文件名同步（`phoenix-workspace.sqlite`）；规划/研究稿中旧名待按需替换

---

## P3 — 平台化（讨论稿 · 未立项）

> [Phoenix平台-多应用壳层-规划讨论.md](platform/Phoenix平台-多应用壳层-规划讨论.md)

- [ ] 确认：同仓分包 vs 独立 `phoenix-shell` 仓库
- [ ] `web-ui/src/plugins/freecad/` 页面分包（无行为变化）
- [ ] Python 路由 `register_freecad_routes` 拆分
- [ ] 第二个插件原型（验证表前缀 `phoenix_<app>_`）
- [~] **`app_config` 模块字段 + 主页导航偏好**（见 P1 §导航模块偏好；与下方原项合并实现）
- [ ] 工作空间偏好迁入 SQLite（`phoenix_ui_session` 或专用表）；JSON 仅导出——见 [Phoenix工作空间存储-规划讨论.md](platform/Phoenix工作空间存储-规划讨论.md)

---

## P3 — Code 工具（已起步）

- [x] `phoenix/code/reorder_members.py` + Web 页 + API
- [x] **Code 工作空间索引**：`phoenix_code_*` 表 + 扫描源/配置/文档/资源 + Web「Code 索引」页 — 见 [Code模块-工作空间索引.md](code/Code模块-工作空间索引.md)
- [x] **Code 忽略设定**：`.phoenix/code.ignore` + 工作空间自定义；右侧栏 Tab + 独立页 — 见 [Code模块-批量改名-规划.md](code/Code模块-批量改名-规划.md) §5
- [x] Code 索引：删除缺失条目、导出 JSON
- [~] **Code 批量改名**（文件夹 / 文件 / 文本三级）— 见 [Code模块-批量改名-规划.md](code/Code模块-批量改名-规划.md) §1–10  
  - [x] P0 **文本级** preview + apply、编码检测、忽略列表、单测  
  - [x] P1 文件夹 / 文件 basename 重命名（执行顺序：文件夹 → 文件 → 文本）  
- [~] **Code UUID 替换** — 同上 §11  
  - [x] 扫描 + 勾选 apply（`map_per_value` / `fresh_per_hit`）  
  - [x] 与 Code 索引范围联动（`use_index_scope`）；报告 JSON 落 `.phoenix/reports/`
- [x] **成员排序 · 锁定段（P0）**：`reorder_avoidance.py` + `test_reorder_avoidance_rules.py`；可选 Web 自检 API
- [x] **成员排序 · 锁定段回归单测**：`tests/test_reorder_avoidance_rules.py`；改规则须全套件通过
- [x] **成员排序 · Web 回归自检（可选）**：`POST /api/code/reorder-members/self-test` 或 dev 页按钮，仅跑 fixture 子集
- [ ] **成员排序 · 可选目录层级**：勾选列表默认 **1 级**（现「一级条目」）；偏好可选 **2–4 级** 展开子目录为可选项（仍受 ignore 规则约束）；`list_reorder_top_level_entries` / `GET top-level` + `ReorderMembersPage` 结果区标题与汇总
- [ ] **成员变量字母序（完整规则）**：Doxygen 序号重编、`.h`/`.cpp` 构造/析构等序号一致 — 见 [成员变量字母序-规则与待实现.md](code/成员变量字母序-规则与待实现.md)；Web 勾选暂禁用
- [ ] 成员排序：单文件 diff 预览、Git 脏文件过滤
- [ ] 其它 Code 工具迁入 `phoenix/code/`（按 skill 拆分）

---

## 讨论稿（未立项）

| 文档 | 主题 |
| --- | --- |
| [CAD数据库表结构.md](cad/CAD数据库表结构.md) | 现网 13 表、ER（schema v10） |
| [CAD数据库表结构-重命名规划.md](cad/CAD数据库表结构-重命名规划.md) | v10 重命名决策（删库重建） |
| [Phoenix平台-多应用壳层-规划讨论.md](platform/Phoenix平台-多应用壳层-规划讨论.md) | 多应用壳层、子插件、是否拆仓 |
| [文件变更历史与引用证据-待办讨论.md](cad/文件变更历史与引用证据-待办讨论.md) | 改名历史、引用证据、统一修正算法 |
| [Phoenix工作空间存储-规划讨论.md](platform/Phoenix工作空间存储-规划讨论.md) | SQLite 默认、按需导出 JSON |
| [Web与桌面迁移-待办.md](platform/Web与桌面迁移-待办.md) | 页面对照、桌面功能迁移 |
| [SQL查询与递归点检-todo.md](platform/SQL查询与递归点检-todo.md) | SQL 日志格式、递归点检清单 |

---

## 运维备忘

- 修改前端后：**硬刷新**或重启 `python -m phoenix.web --dev`
- 索引字段变更后：工作空间内 **CAD 重扫** 或单文件 **重建引用索引**
- 查询路径**不读 FCStd 补全**；缺 `link_label` / `rule_label` 需重建索引
- **旧库 / 空索引**：若顶部出现旧库横幅，点 **确认重建数据库** 后 **CAD 索引 → 工程内搜索**；仍异常时可删除 `.phoenix/phoenix-workspace.sqlite` 再全量重扫
