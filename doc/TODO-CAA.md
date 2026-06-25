# CAA 模块 — 待办（TODO-CAA）

> **总索引**：[TODO.md](TODO.md)  
> **概览**：[caa/CAA模块-概览.md](caa/CAA模块-概览.md)  
> **规划**：[caa/CAA对话框-Web编辑器-规划.md](caa/CAA对话框-Web编辑器-规划.md)  
> **P0 归档**：[caa/CAA对话框-P0快速原型-归档.md](caa/CAA对话框-P0快速原型-归档.md)  
> **控件组件化**：[caa/CAA对话框-控件组件化设计.md](caa/CAA对话框-控件组件化设计.md)  
> 状态：`[ ]` 未做 · `[~]` 进行中 · `[x]` 已完成

最后更新：2026-06-25（按当前代码对账；含写回 / Tab / Undo / 索引推进）

---

## 验证清单（2026-06-24 本轮改动）

> 标记：`[x]` 已验证 OK · `[~]` 已实现/进行中，待人工复测或收口 · `[!]` 有问题 · `[ ]` 未验证/未做

### Grid 编辑/预览
- [x] ✎/◉ 图标切换编辑/预览模式
- [x] 预览模式隐藏网格线 + 单元格边界
- [x] 编辑模式 1px 灰线 + 白底单元格

### Grid 伸缩弹簧图标
- [x] 列弹簧（绿色横线 = 伸缩，灰点 = 固定）
- [x] 行弹簧（绿色竖线 = 伸缩，灰点 = 固定）
- [x] 点击切换伸缩/固定，颜色不混淆选中蓝
- [x] 伸缩触发 irDirty → 保存按钮亮起

### Builder 拖放

- [x] 控件面板拖入 Grid（HTML5 COPY）
- [x] 内部拖动移动控件位置（MOVE）
- [x] 5 方向 drop：inside / right / left / bottom / top
- [x] 5 种指示器：整格蓝底（inside）+ 4 边界蓝条（right/left/bottom/top）
- [~] left / top 指示器拖入：纯函数规则与单测已覆盖，待 UI 手工复测
- [x] 空格子占位 div（拖入空格子有指示器）
- [x] 所有控件可拖（Editor/Spinner/PushButton/Combo…）
- [x] 不覆盖已有控件（occupied cell 禁止 inside）
- [x] spanning 控件 straddle 安全处理
- [x] 鼠标松开指示器残留修复（e.buttons 检查 + window 安全网）
- [x] 撤销 / 重做（IR 树快照栈 + 页头按钮 + Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z；见 [caa/CAA对话框-撤销重做-规划.md](caa/CAA对话框-撤销重做-规划.md)）
- [~] 拖拽调整控件 span 大小（右下角 resize handle 已实现，带碰撞保护与 undo 快照；待 UI 手工复测）
- [~] 拖行列头调整 ROWRES/COLRES（pointer drag 批量设为伸缩/固定已实现；待 UI 手工复测）
- [x] 删除控件（右键菜单 + Delete/Backspace 已接统一 `removeControl` 链路）
- [~] 跨容器拖动（MOVE 路径已实现，待 Frame/Container 实机复测）

### baseContainer 统一 resize
- [x] COLRES 列控件 `width: 100%` 填满
- [x] 非 COLRES 列控件内容宽
- [x] 高度内容自驱（不向子控件推高度，避免循环依赖）
- [ ] 测试 DLG（Group + MultiList + Button）实机正常

### 主页表格优化
- [x] 目录列移除
- [x] 第一列序号 # 1~n
- [x] 文件名列蓝色链接样式 + hover 下划线
- [x] 列表自动适应 11 个对话框内容

### 控件内文本显示修复
- [x] CaaControlEditor 显示 NLS title 文本（不再显示 node.id）
- [x] CaaControlSpinner 显示 NLS title 文本 + 重新设计为 SpinnerBox（上下按钮 + 数值输入）
- [x] CaaControlUnknown 修复未定义 `isContainerLike` bug

### NLS 统一编辑器（内嵌面板）
- [x] 点「编辑文案」打开面板（canvas 下方）
- [x] 默认平铺表模式
- [x] 树表格 / 平铺表 切换
- [x] EN / CN / 中英 语言切换
- [x] 中英模式「互相填写空白」按钮
- [x] 选中控件 → 编辑文案 → 自动切树表格 + 滚动到该控件
- [x] 关联文件 CATNls「编辑」→ 打开面板 + 滚动
- [x] 列顺序：# → 英文 (EN) → 简体中文 (CN) → Key
- [x] 平铺表模式第一列序号 1~n
- [x] Key 列溢出隐藏，不重叠
- [x] 点 ✕ 关闭面板

### 保存
- [x] 任何时候都可点保存（已有对话框解析后可点；无修改时提示没有需要保存的修改）
- [x] 伸缩修改后 tab 标 dirty

---

## 架构（已拍板）

| 层 | 路径 | 技术 |
| --- | --- | --- |
| **前端** | `web-ui/` | Vue（一个前端） |
| **后端 A** | `phoenix/web/` | Python（CAD/Code/Git…） |
| **后端 B** | `server/caa/` | Node + `packages/catdlg-core` |
| **后期** | VS Code 扩展 | 复用 `catdlg-core`，封装另立项 |

Vite：`/api/caa` → Node；`/api` → Python（**caa 规则在上**）。
当前例外：`/api/caa/index` → Python（CAA 索引库），其余 `/api/caa/*` → Node（解析/写回/草稿）。

---

## 里程碑

| 阶段 | 目标 | 状态 |
| --- | --- | --- |
| C0 · 文档 | 规划、双后端决策 | [x] |
| C0b · 脚手架 | `server/caa` + `catdlg-core` + Vite 代理 | [x] |
| C1 · 解析 | core + API + 基础测试文件；`test:caa` 可运行 Python index fixture + core/web CAA 回归测试 | [x] |
| C2 · 预览 | `web-ui` CAA 页 + 壳层侧栏 | [x] |
| C2d · 控件组件化 | 每控件一 Vue 组件 + 右键菜单 + 画布选中高亮 | [x] |
| C2b · 索引 | `phoenix_caa_*` + scan/groups API + FTS + 左侧索引块 | [x] |
| C2c · 多 Tab | `max_tabs` / 打开复用 / 深链 / 树点 `.CATDlg` / pageState 已落地；CAA store 已按 tabId 隔离，刷新后可恢复最近 undo/redo 历史 | [x] |
| C3 · 写回 | emit + `/api/caa/dialog/write` + dry-run 预览 + Wizard `.h/.cpp` marker 写回已接入；写前校验与 MultiList `SetColumnTitles` 逻辑已有 Vitest 覆盖，真实 CAA 编译签名仍待 fixture 收口 | [~] |
| C4 · P2 | Wizard `.h/.cpp` 最小同步已推进；`UpdateDialog` / KEVIN WIZARD 字段绑定、`.CATRsc` 图标资源可只读展示；P2 控件与常见 Menu/Toolbar/StatusBar 类型已入 catalog 并有灰盒预览；实工程类型覆盖统计已接入；SetColumnTitles 仍需真实工程编译确认 | [~] |
| C5 · 后期 | VS Code 扩展 POC | [ ] |

---

## C0b · 脚手架

- [x] `packages/catdlg-core/package.json` + `schema.ts`
- [x] `server/caa/` Hono `/api/caa/health`
- [x] `web-ui/vite.config.ts` 增加 `/api/caa` 代理
- [x] 根 `pnpm dev:caa` 脚本
- [x] `server/caa/README.md`

---

## C1 · 解析

- [x] `parseCatDlg` / `parseCatNls` / `mergeIr`
- [x] `control_catalog.json`
- [x] 测试用例：Python CAA index fixture、emit/validate、patch / parser / drop / resize / blank IR / Wizard / catalog 等测试已可运行；`corepack pnpm run test:caa` 当前通过 Python 2 条 + core 9 个测试文件 + web-ui 7 个测试文件
- [x] `POST /api/caa/dialog/parse`

---

## C2 · Web 预览（P0 已归档）

- [x] `CaaDialogEditorPage` + Canvas + Grid 预览
- [x] 左栏 `CaaDialogTreePanel` + `useCaaDialogPropertySheet`
- [x] Ribbon Code · **CAA** 独立分组
- [x] 对话框固定宽 500px、内部铺满；属性单行省略
- [x] 编辑页画布下方「关联文件」表（文件名 + 相对路径）
- [x] 预览控件：TabContainer / TabPage / Radio / Check / Combo / Spinner / Separator / Container
- [x] 工作空间任意 `.CATDlg` 打开（非 demo）
- [x] 画布点击选中控件高亮
- [x] 关联文件表 · 点击行弹窗预览（文本 / 位图）

## C2d · 控件组件化

见 [CAA对话框-控件组件化设计.md](caa/CAA对话框-控件组件化设计.md)。

### 上下文注入 + 类型注册表

- [x] `useCaaControlContext.ts` — `CAA_CONTROL_KEY` + `CaaControlContext` 类型
- [x] `controls/registry.ts` — `caaControlMap` + `resolveCaaControl()`
- [x] `CaaDialogEditorPage.vue` 增加 `provide(CAA_CONTROL_KEY, ctx)`

### 控件拆分（`controls/` 目录）

- [x] `CaaControlDialog.vue` — Dialog 根容器（窗口框 + 标题栏 + OK/Cancel/Preview 栏 + 内部 Grid）
- [x] `CaaControlFrame.vue` — Frame（fieldset/legend + 内部 Grid；`FraNoFrame` 无边框）
- [x] `CaaControlTabContainer.vue` — Tab 条 + 当前页内容切换
- [x] `CaaControlTabPage.vue` — Tab 页内容（内部 Grid）
- [x] `CaaControlContainer.vue` — 可滚动区域
- [x] `CaaControlLabel.vue` — 静态文本
- [x] `CaaControlEditor.vue` — 单行/多行输入（`TH` 控制行数）
- [x] `CaaControlSelectorList.vue` — 选择列表
- [x] `CaaControlMultiList.vue` — 表格（`CC`/`VCC` 列数、列标题）
- [x] `CaaControlPushButton.vue` — 按钮
- [x] `CaaControlSpinner.vue` — 数字旋钮（`MIN`/`MAX`/`STEP`/`PREC`）
- [x] `CaaControlCheckButton.vue` — 复选框
- [x] `CaaControlRadioButton.vue` — 单选框
- [x] `CaaControlCombo.vue` — 下拉组合框
- [x] `CaaControlSeparator.vue` — 横/竖分隔线
- [x] `CaaControlUnknown.vue` — 未识别类型 · 灰盒占位

### 画布交互

- [x] 点击控件选中 → 蓝色边框高亮（`isSelected` class）+ 侧栏树同步选中
- [x] 组件内统一 `onClick` stopPropagation → `ctx.select(nodeId)`
- [x] `CaaDialogNodeView.vue` 替换为 `<component :is="resolveCaaControl(node.type)">`

### 右键菜单

- [x] `CaaControlContextMenu.vue` — 右键弹出菜单组件
- [x] 各控件 `onContextmenu` → `ctx.showContextMenu(nodeId, buildMenu(node))`
- [x] 菜单项：编辑 Title · 编辑 Help/Tooltip · Grid 属性 · 尺寸 · 伸缩开关
- [x] 右键菜单定位（防溢出）、点击外部关闭

### NLS 树编辑器

- [x] `CaaNlsTreeEditor.vue` — 统一 NLS 编辑器（树表格 + 平铺表）
  - [x] 按控件分组节点
  - [x] Help/ShortHelp/LongHelp 相同值 → 合并为折叠组节点（编辑组节点 → 三个键同步改）
  - [x] 占位符 Title（`（选择列表）`/`（输入框）`）灰字显示，可选编辑
  - [x] 搜索过滤（按键/值/控件名）
  - [x] 双语对比模式（英文/中文双列）
- [x] `CaaCatNlsEditDialog.vue` 仅作为旧平铺编辑器归档保留；当前主入口和类型来源均已切到 `CaaNlsTreeEditor` / 页面本地类型

**2026-06-24 修复：** `useCaaControl.widthStyle` 在 `fillParent` 时不再设固定宽度（inline `width: Xch` 优先级高于 class `caa-control--fill`，导致伸缩列内控件不拉伸）。影响：SelectorList / Combo / Editor / Spinner / MultiList。

---

### 编辑/预览模式

- [x] 页面本地 `editMode` + pageState 保存/恢复，默认编辑模式，页头按钮切换
- [x] Grid bar（⊞ N×M + 伸缩标签）编辑模式显示、预览模式隐藏
- [x] Grid 辅助线 + 单元格边界编辑模式显示、预览模式隐藏

### baseContainer 统一 resize（JS 显式计算控件宽度）

- [x] `useCaaContainerResize.ts` — 共享 composable
  - [x] COLRES → `1fr` + `width: 100%`，非 COLRES → `auto` + `TWch`
  - [x] 高度内容自驱，不向子控件推高度
  - [x] 返回 `columnTemplate` + `gridWidth` + `getChildWidth`
  - [~] ROWRES 视觉高度分配已接入 `grid-template-rows: 1fr/auto`，伸缩行内控件会得到 `height: 100%` 样式提示；像素级行高拖动不写入 IR（`.CATDlg` 无对应字段），待 UI 复测
- [x] Container 组件接入：Dialog / Frame / TabPage / Container / TabContainer
- [x] `CaaDialogGrid` 接受 resize 结果，传给子控件
- [x] 清理 `.caa-control--fill` CSS 类，宽度由父级 resize inline style 控制

### 空白对话框新建（Builder 模式）

- [x] 主页/CAA 页「新建对话框」按钮
  - [x] 创建空白 IR（仅 Dialog 壳 + CATDlgWndBtn style）
  - [x] 未保存状态，写入工作空间 `.phoenix/caa-drafts/`（JSON 文件）
  - [x] 欢迎页/最近工作空间显示「未保存的对话框」草稿列表
  - [x] 新建保存到磁盘调用 `POST /api/caa/dialog/create` 生成 `.CATDlg` + `.CATNls`
  - [x] 草稿 API：GET/POST/DELETE `/api/caa/dialog/drafts`
- [x] 左侧工具条：n 行 × 2 列控件面板
  - [x] 可拖拽或点击添加：Label / Editor / SelectorList / Combo / Button …
  - [x] 分组：基础控件 / 容器 / 装饰
- [x] 右侧对话框画布：实时预览 + Grid 编辑
  - [x] 拖放入 Grid（COPY）→ 不覆盖已有控件 → 5 方向 edge
  - [x] 内部拖动（MOVE）重排控件位置
  - [x] 空格子占位 + 蓝色指示条 overlay
  - [x] 撤销/重做（IR 树运行时快照栈，含拖拽/新增/删除/行列变更）
  - [~] 拖拽调整 span 大小（右下角 resize handle 已实现，待 UI 复测）
  - [~] 拖行列头批量调整 ROWRES/COLRES（pointer drag 已实现，待 UI 复测）
  - [x] 删除控件（右键菜单 + Delete/Backspace 已接入口）
  - [~] 跨容器拖动（MOVE 路径已实现，待 Frame/Container 实机复测）
- [x] 新建保存：生成 `.CATDlg` + `.CATNls` 写回磁盘（`POST /api/caa/dialog/create`）
- [x] 已有对话框完整写回：见 C3 `POST /api/caa/dialog/write`

## C2b · 对话框索引（`phoenix_caa_*`）

- [x] `phoenix/caa/schema.py` + migrate（`phoenix_caa_scan` / `phoenix_caa_dialog` / group / group_member）
- [x] `POST /api/caa/index/scan` · `GET /api/caa/index/groups`（按 `*UI.m`/目录启发式分组）
- [x] FTS 检索：`phoenix_caa_dialog_fts` + `GET /api/caa/index/groups?q=...`
- [x] 主页列表已切到 **CAA 索引 SQL**；左栏已新增可折叠 **对话框索引** 块

## C2c · 多 Tab 打开

- [x] `caa_dialog.max_tabs` → 8（`phoenix/config/app_config.json`）
- [x] `openCaaDialogForRel(catDlgRel)`：同一 `.CATDlg` 复用/激活 Tab，`contextKey = catDlgRel`
- [x] `?page=caa_dialog&rel=...` 深链解析与地址栏同步
- [x] 工作空间树点 `.CATDlg` → 打开/激活 CAA 编辑 Tab
- [x] Tab 级 session：`usePageSession` 已保存/恢复 IR、`selectedId`、dirty、`draftId`、`editMode`、`irWriteMode`；CAA store 已按 tabId 隔离编辑状态，侧栏/属性面板读取 active editor
- [x] Undo/Redo：运行时 per-tab 快照栈已落地；pageState 会保存最近 12 步 undo/redo 历史，刷新后恢复
- [x] 对话框索引联动：主页与左侧 **对话框索引** 均读取 CAA index groups，点击复用/打开 CAA 编辑 Tab
- [ ] 见 [CAA对话框索引与多Tab-规划.md](caa/CAA对话框索引与多Tab-规划.md)

---

## C3 · 写回

- [x] `POST /api/caa/dialog/create` — 新建 IR → `.CATDlg` + `.CATNls` 落盘
- [~] `POST /api/caa/dialog/save-dialog` — 现有 ROWRES/COLRES patch 写回保留，用于仅伸缩标记修改
- [x] `POST /api/caa/dialog/write` — 已有对话框 IR → `.CATDlg` 完整落盘；`.CATNls` 可按 keys patch
- [x] 写前 dry-run diff 预览：后端 `dryRun` 返回 before/after，前端「预览写回」弹窗展示磁盘 `.CATDlg/.h/.cpp` 与 IR emit 后文本，并可确认写回
- [x] 写前校验：Grid 重叠、非法 FATHER、重复 id、未知控件类型 warning/error，并有 `emitCatDlg.test.ts` 覆盖
- [x] 永不改写 Wizard 区外代码：`.h` 只替换 `CAA2 WIZARD WIDGET DECLARATION SECTION`，marker 外 `BuildMore` / 手写区保持原样
- [~] Wizard `.cpp` 构造段写回：已生成 `new`、`SetGridConstraints`、`SetGridRowResizable`、`SetGridColumnResizable`；`CATDlgMultiList` 无旧调用时会生成 `CATUnicodeString[] + SetColumnTitles(..., count)`，既有 `SetColumnTitles` 调用按 receiver 精确匹配当前控件后保留并 warning

## C4 · Wizard 同步 + 控件补全

- [x] .h WIDGET DECLARATION SECTION 写回（IR 深度优先生成 `CATDlgXxx* _Name;`，只替换 marker 内部）
- [~] .cpp WIDGET CONSTRUCTION SECTION 写回（已接 `new`、`SetGridConstraints`、`SetGrid*Resizable`、MultiList `SetColumnTitles` 生成/精确保留；签名仍待真实 CAA fixture/编译确认）
- [~] `UpdateDialog` / KEVIN WIZARD 绑定解析 → 侧栏只读字段绑定：已从同名 `.cpp` 保守提取 `控件 ↔ parameter->Field / param.Field`，复杂业务表达式与无控件 ID 线索暂不猜
- [x] .CATRsc 图标名预览：已列出 key/value，并按资源名匹配 `graphic/bitmaps/icons` 下的实际图片文件，匹配行可打开预览
- [x] P2 控件入 catalog：CATDlgContainer、CATDlgSplitter、CATDlgIconBox、CATDlgProgress、CATDlgSlider、CATDlgScrollbar；Splitter/IconBox/Progress/Slider/Scrollbar 先走灰盒预览
- [~] Menu/Toolbar/StatusBar 体系只读解析 + 灰盒：常见 `CATDlgMenuBar`、`CATDlgToolBar`、`CATDlgStatusBar`、`CATDlgSubMenu`、`*Item` 已入 catalog 并注册灰盒；真实工程命名覆盖待扫描确认
- [x] `control_catalog.json`：核心校验、NLS 行为、ID 前缀、可作为容器判断、左侧 palette 已开始读取 catalog 查询层
- [x] Vitest / fixture：已补 `tests/fixtures/caa/PNXBomAnalysisDlg.CATDlg` 与 Python catalog 覆盖测试；core/web-ui Vitest 依赖和脚本已接入，根 `test:caa` 会一起跑 Python fixture
- [x] 实工程扫描统计未覆盖类型：CAA 索引扫描会统计 `.CATDlg` 控件类型频次，与 `control_catalog.json` 对照后在主页显示 catalog 覆盖率与未知类型

## C5 · 后期封装

- [ ] `catdlg-core` + `io-adapter` 抽离，供 VS Code 扩展 POC
- [ ] 可选 Electron 壳（内嵌 `web-ui` build）
- [ ] 启动脚本合并（三进程合一）
- [ ] VS Code Custom Editor、npm 发包名

---

## 跨文档待办归集（2026-06-25 扫描 6 个 CAA 文档）

> 所有代码级待办已归入上方对应章节。以下为文档维护项 + 已知不一致。

### 文档维护
- [ ] `doc/文档索引.md` 补 2 个缺失文档：`控件组件化设计`、`撤销重做-规划`
- [ ] `CAA对话框-P0快速原型-归档.md`「已知限制」更新——画布选中、工作空间打开等已在 C2/C2d 实现
- [ ] `CAA对话框-Web编辑器-规划.md` §6.3 画布行为 P0/P1 表加脚注"已超前实现"；§13「P0 范围待确认」已过时

### 已知问题
- [~] left / top 指示器：代码规则与单测已补，待手工 UI 复测后从已知问题移除

---

## 永久不做

- [x] Python 实现 CAA 业务
- [x] 回调 / Agent 图形化

---

*与 Code 模块共用 `PNXCaaStudy` fixture，进程独立。*
