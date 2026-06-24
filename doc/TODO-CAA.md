# CAA 模块 — 待办（TODO-CAA）

> **总索引**：[TODO.md](TODO.md)  
> **概览**：[caa/CAA模块-概览.md](caa/CAA模块-概览.md)  
> **规划**：[caa/CAA对话框-Web编辑器-规划.md](caa/CAA对话框-Web编辑器-规划.md)  
> **P0 归档**：[caa/CAA对话框-P0快速原型-归档.md](caa/CAA对话框-P0快速原型-归档.md)  
> **控件组件化**：[caa/CAA对话框-控件组件化设计.md](caa/CAA对话框-控件组件化设计.md)  
> 状态：`[ ]` 未做 · `[~]` 进行中 · `[x]` 已完成

最后更新：2026-06-24

---

## 验证清单（2026-06-24 本轮改动）

> 标记：`[x]` 已验证 OK · `[!]` 有问题 · `[ ]` 未验证

### Grid 编辑/预览
- [x] ✎/◉ 图标切换编辑/预览模式
- [x] 预览模式隐藏网格线 + 单元格边界
- [x] 编辑模式 1px 灰线 + 白底单元格

### Grid 伸缩弹簧图标
- [x] 列弹簧（绿色横线 = 伸缩，灰点 = 固定）
- [x] 行弹簧（绿色竖线 = 伸缩，灰点 = 固定）
- [x] 点击切换伸缩/固定，颜色不混淆选中蓝
- [x] 伸缩触发 irDirty → 保存按钮亮起

### baseContainer 统一 resize
- [ ] COLRES 列控件 `width: 100%` 填满
- [ ] 非 COLRES 列控件内容宽
- [ ] 高度内容自驱（不溢出/不塌陷）
- [ ] 测试 DLG（Group + MultiList + Button）正常

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
- [ ] 点「编辑文案」打开面板（canvas 下方）
- [ ] 默认平铺表模式
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
- [ ] 任何时候都可点保存
- [ ] 伸缩修改后 tab 标 dirty

---

## 架构（已拍板）

| 层 | 路径 | 技术 |
| --- | --- | --- |
| **前端** | `web-ui/` | Vue（一个前端） |
| **后端 A** | `phoenix/web/` | Python（CAD/Code/Git…） |
| **后端 B** | `server/caa/` | Node + `packages/catdlg-core` |
| **后期** | VS Code 扩展 | 复用 `catdlg-core`，封装另立项 |

Vite：`/api/caa` → Node；`/api` → Python（**caa 规则在上**）。

---

## 里程碑

| 阶段 | 目标 | 状态 |
| --- | --- | --- |
| C0 · 文档 | 规划、双后端决策 | [x] |
| C0b · 脚手架 | `server/caa` + `catdlg-core` + Vite 代理 | [x] |
| C1 · 解析 | core + API（Vitest 待补） | [x] |
| C2 · 预览 | `web-ui` CAA 页 + 壳层侧栏 | [x] |
| C2d · 控件组件化 | 每控件一 Vue 组件 + 右键菜单 + 画布选中高亮 | [x] |
| C2b · 索引 | `phoenix_caa_*` + 检索侧栏 | [ ] |
| C2c · 多 Tab | 每对话框 Tab + 树联动 | [ ] |
| C3 · 写回 | emit + `/api/caa/write` | [ ] |
| C4 · P2 | Wizard + 控件补全 + NLS 树编辑器 | [ ] |
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
- [ ] `control_catalog.json` + Vitest（`PNXBomAnalysisDlg`）
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

- [x] `CaaNlsTreeEditor.vue` — 树视图 NLS 编辑器
  - [~] 按控件分组节点
  - [~] Help/ShortHelp/LongHelp 相同值 → 合并为折叠组节点（编辑组节点 → 三个键同步改）
  - [~] 占位符 Title（`（选择列表）`/`（输入框）`）灰字显示，可选编辑
  - [~] 搜索过滤（按键/值/控件名）
  - [~] 双语对比模式（英文/中文双列）
- [x] 保留 `CaaCatNlsEditDialog.vue`（平铺表模式），页头切换

**2026-06-24 修复：** `useCaaControl.widthStyle` 在 `fillParent` 时不再设固定宽度（inline `width: Xch` 优先级高于 class `caa-control--fill`，导致伸缩列内控件不拉伸）。影响：SelectorList / Combo / Editor / Spinner / MultiList。

---

### 编辑/预览模式

- [x] Pinia 存 `editMode`，默认编辑模式，页头按钮切换
- [x] Grid bar（⊞ N×M + 伸缩标签）编辑模式显示、预览模式隐藏
- [x] Grid 辅助线 + 单元格边界编辑模式显示、预览模式隐藏

### baseContainer 统一 resize（JS 显式计算控件宽高）

- [x] `useCaaContainerResize.ts` — 共享 composable
  - [x] COLRES → `1fr` + `width: 100%`，非 COLRES → `auto` + `TWch`
  - [x] ROWRES → `flex: 1 1 0`
  - [x] 返回 `columnTemplate` + `rowTemplate` + `getChildWidth` + `getChildHeight`
- [x] Container 组件接入：Dialog / Frame / TabPage / Container / TabContainer
- [x] `CaaDialogGrid` 接受 resize 结果，传给子控件
- [x] 清理 `.caa-control--fill` CSS 类，宽高完全由父级 resize inline style 控制

### 空白对话框新建（Builder 模式）

- [~] 主页/CAA 页「新建对话框」按钮（计划中）
  - [~] 创建空白 IR（仅 Dialog 壳，无子控件）
  - [~] 未保存状态，写入工作空间 `.phoenix/caa-drafts/`（JSON 文件，非 localStorage）
  - [~] 欢迎页/最近工作空间显示「未保存的对话框」草稿列表
  - [~] 保存到磁盘调用 `POST /api/caa/dialog/create` 生成 .CATDlg + .CATNls
  - [~] 草稿 API：GET/POST/DELETE `/api/caa/drafts`
- [ ] 左侧工具条：n 行 × 2 列控件面板
  - [ ] 可拖拽或点击添加：Label / Editor / SelectorList / Combo / Button …
  - [ ] 分组：基础控件 / 容器 / 装饰
- [ ] 右侧对话框画布：实时预览 + Grid 编辑
- [ ] 保存：生成 .CATDlg + .CATNls 写回磁盘

## C2b · 对话框索引（`phoenix_caa_*`）

- [ ] `phoenix/caa/schema.py` + migrate（`phoenix_caa_scan` / `phoenix_caa_dialog` / group）
- [ ] `POST /api/caa/index/scan` · `GET …/groups` · FTS 检索
- [ ] 左栏可折叠 **对话框索引** 块（按 `*UI.m` 分组）

## C2c · 多 Tab 打开

- [ ] `caa_dialog.max_tabs` → 8；`openCaaDialogTab(catDlgRel)`
- [ ] 工作空间树点 `.CATDlg`；Tab 级 store（每 Tab 独立 IR）
- [ ] 见 [CAA对话框索引与多Tab-规划.md](caa/CAA对话框索引与多Tab-规划.md)

---

## C3–C5

见 [规划 §8–11](caa/CAA对话框-Web编辑器-规划.md)。

---

## 永久不做

- [x] Python 实现 CAA 业务
- [x] 回调 / Agent 图形化

---

*与 Code 模块共用 `PNXCaaStudy` fixture，进程独立。*
