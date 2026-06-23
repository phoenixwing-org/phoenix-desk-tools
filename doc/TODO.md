# Phoenix Web / 后端 — 总待办

> 汇总跨模块待办；细项研究稿见 [文档索引.md](文档索引.md)。  
> **Git 插件**细项见 **[TODO-GIT.md](TODO-GIT.md)**。  
> **CAA 模块**细项见 **[TODO-CAA.md](TODO-CAA.md)**。  
> 状态：`[ ]` 未做 · `[~]` 进行中 · `[x]` 已完成

最后更新：2026-06-23

---

## P0 — 性能 / 正确性（引用与索引）

- [x] 出向引用：`JOIN file_asset`，去掉 `get_file_asset_bom_fields` N+1（见 [出向引用-N+1查库-研究.md](cad/出向引用-N+1查库-研究.md)）
- [x] `bom_xref` 冗余 `rule_label` + 子件 BOM 快照；查询单表、不读盘补 Label
- [x] 文件详情：引用 Tab 懒加载、分 scope 请求、角标单条 SQL
- [x] **`phoenix_store.connect()` 同线程同 repo 可重入**（nested `with connect` 复用连接，避免改名/BOM 刷新链 `database is locked`）
- [x] `rebuild_bom_tree_occurrences`：邻接表只查一次，消除 per-host 重复全表 SQL（见 [BOM物化路径重建-邻接表单次加载-归档.md](cad/BOM物化路径重建-邻接表单次加载-归档.md)）
- [x] `query_bom_xrefs_incoming`：合并 `get_file_asset_id` 为单条 SQL
- [x] 改名 XLink 修正 + **同步引用 Label**：`apply_host_xlink_corrections(sync_reference_labels=True)` 在目标文件尚未改名、且无 CAD 索引时应仍从磁盘 FCStd 读 rule Label（`resolve_rule_display_label` 无索引时回退 `resolve_fcstd_display_label`）；单测：单引用、同 Group 双 XLink `.002`、跨组不重复编号（见 [改名引用写回-装配Label同步-需求.md](cad/改名引用写回-装配Label同步-需求.md)）
- [x] 内部装配 **结构感知 BOM 挂载**：优先入度 0 的顶 `App::Part`（样例 `PCB` 非 `_6222656233`），见 [samples/内部装配示例-挂载分析.md](cad/samples/内部装配示例-挂载分析.md) · [归档](cad/内部装配-BOM挂载-结构感知-归档.md)

---

## P1 — 文件详情 / BOM

- [x] 装配结构 Tab：`v-show` + 缓存，切换不重复请求
- [x] 编辑属性 Tab：显示文档类型（零件/装配/图纸 + 推荐后缀）
- [x] 属性「全部推荐」：单次 API + 不读 FCStd（文件名/索引/记忆）
- [x] 改名 Tab：显示改名记录 → 跳转「改名分析」页（不再内嵌引用表）
- [x] 引用/装配「改链接」后自动刷新相关 Tab 缓存（`notifyXrefMutation` 联动引用+装配，见 [归档](cad/文件详情-引用变更缓存刷新-归档.md)）
- [x] 图纸档：编辑属性只读提示与来源模型跳转体验统一（见 [归档](platform/图纸档-编辑属性只读体验-归档.md)）

---

## P1 — Web 壳层 / UX

- [x] **配置**：居中 Modal 弹层；工作空间 **浏览…** 走 Python 原生选目录（macOS osascript）
- [x] 配置：未扫描工作空间时提示并跳转 **CAD 索引**
- [x] **Code · C++ 成员排序** Web 页：一级子目录勾选 + 后台排序 + 运行日志（见 [成员函数排序-reorder_members.md](code/成员函数排序-reorder_members.md)）
- [x] **主页 · 导航模块偏好**（见下方 §导航模块偏好）
- [x] **工作空间树**：Code 模块偏好下默认筛选 `.h/.cpp` 等（见 §导航模块偏好）
- [ ] 桌面 `fcstd_map_page` 分页，去掉 `load_fcstd_document` 全表
- [ ] 统一运行日志：长任务进度条 / 取消（见 [统一运行日志窗口-规划讨论.md](platform/统一运行日志窗口-规划讨论.md)）
- [x] **单元测试 Web 页**：套件勾选运行、**运行范围列表按模块勾选**（默认全选）、NDJSON 流式进度、终止；失败关注 Tab（排序 / 勾选复测 / 简介列）；Pinia 持久化选项与勾选；**模块列表 el-table + 行内运行 + 运行次数/最近执行 localStorage + 排序**
- [x] **链接路径修正 · 分析**：未建 CAD 索引时明确提示（非 JSON 解析错误）；空脚本输出友好报错
- [x] **工具页页头组件化**：`PageHeader.vue` 统一 `page-head` / `head-row-toolbar` / `PageHelpButton`；各 `*Page.vue` 用 `#actions` slot 传工具条（约定见 `.cursor/rules/page-header-style.mdc`）

### 侧栏 · 页面属性面板（POC）

> 示例：**C++ 成员排序**（`usePagePropertySheet` + 工作空间树下方 `PagePropertiesPanel`）。  
> 类型定义：`web-ui/src/types/pageProperties.ts` · 宿主：`pagePropertiesHost.ts`  
> **规划**：[Web壳层-页面属性面板-规划.md](platform/Web壳层-页面属性面板-规划.md) · **实现说明**：[Web壳层-页面属性面板.md](platform/Web壳层-页面属性面板.md) · **MVC 研讨**：[Web壳层-页面参数与属性-MVC研讨.md](platform/Web壳层-页面参数与属性-MVC研讨.md)（暂不执行）

- [x] POC：成员排序运行选项 + `KEVIN_SYSTEM_CODE` 模式（工作空间 prefs 持久化）
- [x] KeepAlive 多页：`setPropertiesActivePage` 随 Tab 切换属性内容
- [x] 表格布局：左名右值、名称列拖拽、布尔「是/否」、`labelTone` 强调色
- [x] **文档**：规划 + 数据结构 + 各页适配对照（见规划 doc §4–§6）
- [x] **推广 P1**：`xlink_fix` / `code_rename` / `code_uuid` 属性 sheet；主区留操作与结果表
- [x] **属性空态**：无 sheet 时显示「当前页无可配置项」
- [x] **推广 P2**：`file_rename` / STEP 等（`part_dedup` ✅）
- [x] **类型扩展**：`propPath`（xlink / 工作集子目录 / part_dedup / step_batch / sw_step_export）；分析后动态只读组；枚举统一 combo
- [ ] **架构研讨**：[页面参数与属性 MVC](platform/Web壳层-页面参数与属性-MVC研讨.md) — **已搁置**（维持 `useXxxPropertySheet`）
- [x] **运行范围**：成员排序「从工作集推导一级目录勾选」
- [x] **壳层持久化**：属性区高度、名称列宽写入 `shell_layout`（列宽拖拽整数化 + 422 友好报错，见 [归档](platform/Web壳层-属性面板与壳层稳定化-归档.md)）
- [x] **页脚面板切换**：VS Code 式图标（树/属性/日志/工作集/停靠）— 与 Ribbon 壳层区共用 `ShellPanelToggleBar`（全 Tab + 布局联动）
- [x] **稳定化**：KeepAlive 多页切换递归更新修复；`PageHeader` 样式；默认日志左下停靠；工作集按钮高亮反馈（见 [归档](platform/Web壳层-属性面板与壳层稳定化-归档.md)）

### Web 壳层 · Ribbon 改型（Element Plus · 循序渐进）

> 规划：[Web壳层-Ribbon改型-规划.md](platform/Web壳层-Ribbon改型-规划.md)  
> 决策：Monorepo · Vue3 + TS + Vite · **Element Plus** · 开发仍 `python -m phoenix.web --dev` · Ribbon 手搓不用 npm 插件

**R0 · 前端栈定型**

- [x] 安装 `element-plus`、`unplugin-auto-import`、`unplugin-vue-components`
- [x] `web-ui/vite.config.ts` 按需解析 `ElementPlusResolver`
- [x] `App.vue`：`el-config-provider` + 中文 locale
- [x] `style.css`：`--el-border-radius-*` 与 Ribbon CSS 变量
- [x] 确认 `pnpm build`（`sass-embedded` + `@element-plus/icons-vue`）
- [x] `web-ui/README.md` 前端栈说明

**R1 · Ribbon 静态原型（不接 AppShell）**

- [x] `web-ui/src/layout/ribbon/*`（Shell / Group / ToolButton / config）
- [x] 调试入口：`?ribbon=1` 或顶栏 **Ribbon** 按钮
- [x] 三 Tab：**系统**（置首）/ CAD / Code；分组 + 竖线 + 大图标

**R2 · 接入壳层**

- [x] `AppShell` 固定 `RibbonShell`；按钮 → `goToPage`
- [x] 左侧快捷栏默认隐藏（`NavSidebar.vue` 保留待用）
- [x] 移除顶栏 Ribbon 切换与 `?ribbon=1` 预览

**R3 · 体验**

- [x] Ribbon 折叠/展开（▲/▼）；当前页按钮高亮
- [x] 更新界面巡游 `data-tour`（Ribbon Tab / 工具条 / 页面 Tab）
- [x] [Web壳层-使用说明.md](user/Web壳层-使用说明.md) 补充 Ribbon / 欢迎页 / 顶栏 Tab 说明

**R3+ · 顶栏收拢与侧栏（2026-06）**

- [x] 顶栏精简：移除 🏠/⚙ 快捷区、Gitee、顶栏工作空间 pill / 模块 chip
- [x] **系统** Ribbon 集中：工作空间切换、CAD/Code 模块开关、树/日志/侧栏 + 主页/配置/单元测试
- [x] 页面 Tab：复用 Ribbon 图标；全部关闭改为图标钮；功能区/页面 Tab 视觉分层
- [x] 切换功能区 Tab 时，若 Ribbon 已折叠则**自动展开**
- [x] 左右侧栏独立宽度 `left_panel_width_px` / `right_panel_width_px`（launcher 持久化）
- [x] 同侧树+日志：中间横条上下拖拽；`log_panel_height_px` 持久化
- [x] **默认停靠**：属性左上、日志左下、工作空间树/工作集右侧（`shell_log_dock: "left"`，launcher + `user_prefs` 默认）
- [x] 浏览器标题同步工作空间与当前页；品牌副标题显示工作空间名
- [x] F5 / sessionStorage 恢复 Tab；地址栏 `?page=` 同步（见 commit 链 45c31dc 等）
- [x] 文档：[Web壳层-使用说明.md](user/Web壳层-使用说明.md)、[新手指引.md](user/新手指引.md) 同步
- [x] **页面 Tab 托盘**：顶栏居中排列；当前 Tab 略放大 + 切换动画（Chili3D 式强调）
- [x] **浏览器标题**：`Phoenix 桌面工具 - {工作空间} · {当前页}`
- [x] **欢迎页 · 最近工程**：每条可记 CAD/Code/全部模块范围（launcher + 工作空间 `nav_modules`）

**R3++ · WPS 式 Ribbon 与页脚（2026-06-21）**

> 归档：[Web壳层-Ribbon-WPS改型-归档.md](platform/Web壳层-Ribbon-WPS改型-归档.md)

- [x] 分组 Ribbon：全部 **大图标**（图标上/文字下）；组间竖线、**无**底部分组标题
- [x] 功能区 Tab：**WPS 下划线**高亮（`RibbonTabBar`）
- [x] **页脚** VS Code 式面板图标 + `el-tooltip`（`ShellPanelToggleBar` / `shellPanelToggles.ts`）
- [x] 「系统」：**工作空间** 大图标 + 下方 comb；**模块** CAD/Code **纵向**小钮（≤3 行）
- [x] CAD/Code `ribbonConfig` 组合并（忽略设定→编辑、改名分析→工具）
- [x] Popover + Tooltip 嵌套警告修复
- [x] 单行 Ribbon 布局：**不变**
- [x] **壳层区补全**：全 Tab 显示树/属性/日志等；分组大图标 / 单行紧凑联动（见 [归档](platform/Web壳层-Ribbon壳层区补全-归档.md)）
- [x] **`RIBBON_SHELL_TAB_ID` 运行时修复**（`import type` → 值导入）

- [ ] **Git 侧栏显示收尾**：分侧停靠 / 组内条组合 — [归档](platform/Web壳层-侧栏Dock高度与Git块-归档.md) §5
- [ ] **页脚左/右栏钮**：接 `toggleLeftSidebar` / `toggleRightSidebar` · `PanelSideIcon` — [左右 Dock §9](platform/Web壳层-侧栏左右Dock-规划.md)
- [x] **侧栏高度调节**：顶区弹性 + 下方固定块 · `sidebarStackLayout` — [规划](platform/Web壳层-侧栏高度调节-规划.md) · [归档](platform/Web壳层-侧栏Dock高度与Git块-归档.md)（2026-06-23）
- [x] **侧栏左右 Dock**：每块独立左/右 + 显隐 · `SideDockPrefsPanel` — [规划](platform/Web壳层-侧栏左右Dock-规划.md) · [归档](platform/Web壳层-侧栏Dock高度与Git块-归档.md)（2026-06-23）
- [ ] **侧栏 block 组布局**：标签页 / 分割堆叠 · 标题右键或 `⋮` — [规划](platform/Web壳层-侧栏Block布局模式-规划.md)（见 [TODO-GIT](TODO-GIT.md) 技术债）
- [ ] **工作集 / 忽略设定独立配置**：与「工作空间树」Tab 解耦 — [左右 Dock §9](platform/Web壳层-侧栏左右Dock-规划.md) · [Block 布局 §9](platform/Web壳层-侧栏Block布局模式-规划.md) · [FileWorkset-规划](platform/FileWorkset-规划.md)

### 系统 · FileWorkset（文件工作集）

> 规划：[FileWorkset-规划.md](platform/FileWorkset-规划.md) — **壳层系统能力**，为 CAD/Code 各模块提供 path 集合归集与跨页执行。

- [x] **P1 基础**：`phoenix_workset*`（SQLite）+ `GET/PUT /api/file-worksets` + 侧栏「工作集」Tab
- [x] **P1 归集**：Code 索引勾选/本页、工作空间树「+工作集」
- [x] **P1 消费**：Code UUID · `WorksetScopePicker` + `repo_rel_paths` 扫描；UUID 页从当前工作集扫描 / 命中加入工作集
- [x] **P1 UX**：工作集删除确认（Element Plus）；侧栏去掉 SQLite 路径说明
- [ ] 改名 / 转码 / CAD 批量页接入 `useWorksetPageScope`（Code 批量改名已接）
- [x] 工作集「刷新 / 剔除 missing」、Saved Query 物化（剔除 missing 已做；Saved Query 未做）

**P2 · 代码整洁（优先级靠后）**

- [x] `FileWorksetPanel`：`watch(immediate)` 与 `onMounted` 重复 `hydrate`（已去 `onMounted`）
- [ ] workset path 归一化：Python / TS 重复逻辑，可抽共享约定或仅文档说明
- [ ] `save_worksets_to_db` 全量 DELETE+INSERT → 大工作集时改增量
- [x] `load_worksets_from_db` path 查询 N+1 → 批量 JOIN

**R4 · 业务页渐进（按需）**

- [x] 新改版页优先 Element 组件（P0–P3 二批工具栏/按钮已落地；**梳理见** [Web壳层-业务页Element化-梳理.md](platform/Web壳层-业务页Element化-梳理.md)、**归档见** [Web壳层-业务页Element化-归档.md](platform/Web壳层-业务页Element化-归档.md)）
- [x] P0 批次：占位页、`WorksetScopePicker`、`FileWorksetPanel`、Code 批量改名
- [x] P1 批次：Code UUID 替换（表单区）、C++ 成员排序、配置主表单
- [x] P2 批次：链接修正、STEP 批量、SW 导出、零件去重、Code 忽略 Panel（大表/展开表保留原生 table）
- [x] P3 首批：零件目录、CAD/Code 索引工具栏（表仍 `ResizableDataTable`）；2026-06-20 smoke 通过
- [x] **验收（P3 首批）**：成员排序 GBK 预检、UUID 写盘、索引/目录、顶栏 Gitee（见 [归档](platform/Web壳层-业务页Element化-归档.md)）
- [x] **P3 二批 · Element（工具栏/按钮，大表保留）**：单元测试 · BOM 列表 · 改名分析/`RenameAnalysisPanel` · 文件详情/零件键详情（2026-06-21 实现并归档）
- [~] **P3 二批 · 人工 smoke（等待人工验证）** — 实现与 `pnpm build` 已完成（2026-06-21）；清单见 [归档 §P3 二批 smoke](platform/Web壳层-业务页Element化-归档.md)
  - [ ] 单元测试：运行 / 模块行内运行 / 失败关注复测
  - [ ] BOM 列表（`bom_export`）
  - [ ] 改名分析（`file_rename` · `RenameAnalysisPanel`）
  - [ ] 文件详情各 Tab（`file_detail` / `bom_apply`）
  - [ ] 零件详情：检索 / 保存（`part_key_detail`）

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
- [x] 可选：`PHOENIX_WORKSPACE_PREFS` 环境变量覆盖 basename

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
- [x] 工作空间偏好迁入 SQLite（`phoenix_workspace_pref`）；JSON 首次打开自动导入，日常读写不再写 JSON

### 壳层 · Git 工作区插件

> **Git 细项待办**：[TODO-GIT.md](TODO-GIT.md)（`TODO-GIT`）  
> 规划：[Web壳层-Git工作区插件-规划.md](platform/Web壳层-Git工作区插件-规划.md) · 点检：[G1点检清单](platform/Web壳层-Git工作区插件-G1点检清单.md)

| 里程碑 | 状态 |
| --- | --- |
| G1 · API + Git 页 + 侧栏提交 | [x] |
| G1 · 框选批量 · `SidebarBlock` · 侧栏 layout 修复 | [x] |
| G1 · diff API · 成员排序迁壳层（过渡弹层） | [~] |
| G1 · `GitFilePage` / Tab · 删 spike | [~] |
| G1 · 人工点检（G1点检清单 §1–7） | [ ] |
| G2 · diff2html · `status-paths` | [ ] |

**下一步（详见 [TODO-GIT.md §G1 收尾](TODO-GIT.md#g1-收尾)**：`GitFilePage` · 删 spike · G1 点检

### CAA 模块 · 对话框编辑器（单前端 · 双后端）

> **CAA 细项**：[TODO-CAA.md](TODO-CAA.md) · **`web-ui` + `server/caa` + `catdlg-core`** · Python 无 CAA 业务

| 里程碑 | 状态 |
| --- | --- |
| C0 · 文档与架构拍板 | [x] |
| C0b · server/caa + core + Vite 双代理 | [x] |
| C1–C2 · 解析 + web-ui 预览（P0） | [x] |
| C2b–C2c · 索引 + 多 Tab | [ ] |
| C3–C4 · 写回 + Wizard | [ ] |
| C5 · VS Code 封装（后期） | [ ] |

归档：[caa/CAA对话框-P0快速原型-归档.md](caa/CAA对话框-P0快速原型-归档.md)

---

## P3 — Code 工具（已起步）

- [x] `phoenix/code/reorder_members.py` + Web 页 + API
- [x] **Code 工作空间索引**：`phoenix_code_*` 表 + 扫描源/配置/文档/资源 + Web「Code 索引」页 — 见 [Code模块-工作空间索引.md](code/Code模块-工作空间索引.md)
- [x] **Code 忽略设定**：`.phoenix/code.ignore` + 工作空间自定义；右侧栏 Tab + 独立页 — 见 [Code模块-批量改名-规划.md](code/Code模块-批量改名-规划.md) §5
- [x] Code 索引：删除缺失条目、导出 JSON
- [~] **Code 批量改名**（文件夹 / 文件 / 文本三级）— 见 [Code模块-批量改名-规划.md](code/Code模块-批量改名-规划.md) §1–10  
  - [x] P0 **文本级** preview + apply、编码检测、忽略列表、单测  
  - [x] P1 文件夹 / 文件 basename 重命名（执行顺序：文件夹 → 文件 → 文本）  
  - [x] Web：`WorksetScopePicker` + `repo_rel_paths` / Code 索引范围
- [~] **Code UUID 替换** — 同上 §11  
  - [x] 扫描 + 勾选 apply（`map_per_value` / `fresh_per_hit`）  
  - [x] CAA `.iid` / `0x` 块 / 跨格式同值 + 大小写组内一致  
  - [x] Web 表：同值分组、列顺序、预检后显示「替换后」列；**替换策略**单行布局；工作集范围扫描
  - [x] 与 Code 索引范围联动（`use_index_scope`）；报告 JSON 落 `.phoenix/reports/`
- [x] **成员排序 · 锁定段（P0）**：`reorder_avoidance.py` + `test_reorder_avoidance_rules.py`；可选 Web 自检 API
- [x] **成员排序 · 锁定段回归单测**：`tests/test_reorder_avoidance_rules.py`；改规则须全套件通过
- [ ] **成员排序 · 待研究**：`#pragma region VirtualFunction`（暂不专项处理）；`.cpp` Wizard 段 — `pnx_bom_analysis_cmd_min.cpp` fixture 待补单测
- [x] **成员排序 · Web 回归自检（可选）**：`POST /api/code/reorder-members/self-test` 或 dev 页按钮，仅跑 fixture 子集
- [x] **成员排序 · 变更文件状态列**：预检 `dry_run` / 写盘 `written`（`el-tag`，见 [归档](platform/Web壳层-属性面板与壳层稳定化-归档.md)）
- [ ] **成员排序 · 可选目录层级**：勾选列表默认 **1 级**（现「一级条目」）；偏好可选 **2–4 级** 展开子目录为可选项（仍受 ignore 规则约束）；`list_reorder_top_level_entries` / `GET top-level` + `ReorderMembersPage` 结果区标题与汇总
- [ ] **成员变量字母序（完整规则）**：Doxygen 序号重编、`.h`/`.cpp` 构造/析构等序号一致 — 见 [成员变量字母序-规则与待实现.md](code/成员变量字母序-规则与待实现.md)；Web 勾选暂禁用
- [~] **成员排序 · Git 预览 / Revert**：表内 👁 已接壳层 `/api/git/diff` + **过渡弹层**；Revert/init 已迁壳层 — **[TODO-GIT](TODO-GIT.md)** · [G1续归档](platform/Web壳层-Git工作区插件-G1续归档.md) · `GitFilePage` 待做
- [ ] 成员排序：Git 脏文件过滤（**TODO-GIT · G2** `status-paths`，暂缓）
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
- **链接路径修正 · 分析失败**：须先 **CAD 索引 → 工程内搜索**（空库会提示「请先在 CAD 索引页…」，勿在未索引时分析）
- **全量单测**：`python -m unittest discover -s tests -p 'test_*.py'`（约 288 项，2026-06-20 通过）
