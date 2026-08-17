# Web 壳层 · Primary 与全局下方面板 · 归档

> 状态：**已归档 · Desk Tools 0.2.0**
>
> 日期：2026-07-15 · 归档：2026-07-17
> 关联：[侧栏 Block 布局模式](Web壳层-侧栏Block布局模式-规划.md) · [Phoenix 多应用壳层](Phoenix平台-多应用壳层-规划讨论.md) · KT Auto Code `docs/0.4.0-Block工作流改造计划.md`

## 0. 归档结论

本轮把 KT Codegen 试点扩展为 Desk Tools 的通用工作台架构，最终边界如下：

- 所有已注册模块页面都可以使用左侧 Primary；普通页面由 `GenericPagePrimaryBlock` 提供摘要、操作与空状态，复杂页面通过 `usePagePrimaryContribution` 注册自有内容。
- KT Codegen 和 CAA 已接入页面级 Primary；Codegen 的每份 JSON/CSV 绑定独立 View，左侧配置列表限制为 6 行后内部滚动。
- 左侧只承载当前页面 Primary；工作空间树、页面属性、工作集和 Git 辅助块固定在右侧。
- 下方面板提升到 `AppShell` 全局层，统一承载“预检”“问题”“运行日志”；切换 View 不创建第二个面板，也不把日志放回右栏。
- Footer 使用 VS Code 风格的左/下/右三个面板开关；Ribbon Header 删除重复面板按钮，只保留单行/双行切换。
- Ribbon 继续作为模块入口，Code 页签使用“自动代码”展示 KT Codegen；本轮没有引入 Activity Bar。
- Desk Tools 消费 Phoenix Wing 0.4.0，不修改 Wing 的 Codegen Model、Reader、Marker、Analyze、Renderer 或 Table。

本归档不包含 Activity Bar 替换、工作集 JSON/SQLite 统一、把 Vue 贡献协议迁入 Wing，也不承诺所有页面都已有专用 Primary 内容。这些需求出现时应重新立项，不继续扩张本归档。

人工验收使用：[KT Codegen 人工点检清单](../code/KT-Codegen-人工点检清单.md)。

## 1. 历史想法

把 Desk Tools 当前左侧导航改造成更接近 VS Code 的界面层级，让 Desk Tools 与 KT Auto Code 在“改名、成员排序、UUID、Ignore、CAA 对话框”等功能上具有相似的入口、Block 和结果交互。

VS Code 的正式概念是：

- **Activity Bar**：最左侧窄图标栏，用于切换功能域。
- **Primary Side Bar**：Activity Bar 右侧的主要侧栏，显示当前功能域的工具、范围、结果与操作。
- **Editor / Workbench**：中间工作区，承载文件、差异、CAA 编辑器和多 Tab。

本想法暂把 Desk Tools 中对应的组合称为 **Primary Bar 模式**，实现时仍建议分别使用 `activity rail` 与 `primary sidebar` 命名，避免一个组件同时承担两层职责。

## 2. 期望布局

```text
┌────────┬──────────────────────┬──────────────────────────────┐
│Activity│ Primary Side Bar     │ Workbench / Editor Tabs      │
│  Bar   │                      │                              │
│        │ 工具标题 / 环境状态   │ 改名预览 / Diff / CAA 画布    │
│  CAA   │ ───────────────────  │                              │
│  Code  │ 配置 Block           │                              │
│  CAD   │ 范围 Block           │                              │
│  Git   │ 结果 Block           │                              │
│        │ 日志 / 辅助操作       │ ──────────────────────────── │
│        │                      │ 预检 / 问题 / 运行日志（可收缩）│
└────────┴──────────────────────┴──────────────────────────────┘
```

目标不是像素级复制 VS Code，而是统一用户心智：

1. 左侧窄栏选择模块或工具。
2. Primary Side Bar 内完成轻量配置、预检和结果选择。
3. 复杂编辑、Diff、多文件详情进入中间 Workbench Tab。
4. 同一功能在 Desk Tools 与 VS Code 插件中尽量使用相同名称、图标、状态和操作顺序。
5. 与当前文档强相关的预检和问题定位由页面贡献到全局下方面板；运行日志由同一面板统一承载，不为一次操作再开并列 View。

## 3. 首批对齐候选

| 功能 | VS Code 插件现状 | Desk Tools 对齐方向 |
| --- | --- | --- |
| Code 改名 | 单 Block 配置、预览和结果 | 左侧复用相同字段顺序；复杂预览打开 Workbench Tab |
| 成员排序 | 范围选择、候选结果、应用状态、Git Diff | 左侧保留操作与候选摘要；Diff 进入中间 Tab |
| UUID 替换 | 策略、扫描、分组结果、逐项应用 | 对齐策略名称、状态颜色和结果分组 |
| Ignore | 规则、推荐、同步操作 | 对齐规则证据和显式应用，不复制 Extension Host 文件 API |
| CAA 对话框 | 插件负责定位并交给 Desk Tools | 左侧显示文件/环境/交接状态，中间继续使用完整 Vue 图形编辑器 |
| 工作集 | 插件使用 JSON glob；Desk 使用 SQLite 显式文件/目录 | 先统一选择器和显示语义；存储格式另立迁移方案，禁止静默双写 |

## 4. 可以复用什么

优先复用数据与 headless 交互，不直接复制宿主页面：

- `phoenix-wing/code-core` 中的结果分组、状态、操作计划和诊断 DTO。
- 工具注册信息：`id`、标题、说明、图标、可用操作、环境要求。
- Block 状态模型：`idle / running / done / error`、摘要、结果行、选中状态。
- 工具图标、中文文案、状态色 token、空状态和错误提示规范。
- CAA handoff、文件 URI、工作区范围等跨产品协议。

仍需分别实现：

- Desk Tools：Vue、Pinia、Element Plus、Tauri、HTTP 与 SQLite adapter。
- VS Code：Extension Host、`vscode.workspace.fs`、Webview、命令和原生 Git/Editor adapter。

不建议让 Desk Tools 直接嵌入 VS Code Webview HTML，也不建议让插件打包完整 Desk Vue 应用。更稳妥的边界是：

```text
共享 Tool Model / DTO / token
        ├── Vue Primary Sidebar adapter（Desk Tools）
        └── VS Code Webview adapter（KT Auto Code）
```

## 5. 与现有 Desk 壳层的关系

- 当前 Ribbon 可以保留，用于跨模块的高频全局命令；Primary Bar 更适合模块内持续操作。
- 现有 `WorkspaceTreeSidebar.vue` 不宜继续无限叠加职责，可演进为 Primary Sidebar 容器，由工具贡献 Block。
- 工作空间树、工作集、Git 辅助块和属性固定在右侧；页面 Primary 固定在左侧；运行日志固定在全局下方面板。
- 页面 Tab、CAA 多 Tab、Diff 和文件详情继续归 Workbench，不塞进窄侧栏。
- 第一阶段只允许切换新旧布局，避免一次性替换现有导航和 Ribbon。

## 6. 建议的共享接口草案

```ts
type PhoenixToolContribution = {
  id: string;
  module: "caa" | "code" | "cad" | "git";
  title: string;
  description: string;
  icon: string;
  blocks: Array<"environment" | "config" | "scope" | "results" | "log">;
  actions: Array<{
    id: string;
    label: string;
    kind: "primary" | "secondary" | "danger";
  }>;
};
```

该接口只描述结构和语义，不包含 Vue 组件、HTML 字符串、VS Code command handler 或后端调用。

## 7. 分阶段验证

以下分阶段计划保留为决策历史，不表示仍有待归档任务；未完成项未自动结转，后续需要时重新立项。

### 已验证：KT Codegen Block + View 试点

本轮没有先替换 Activity Bar/Ribbon，而是在现有 Workbench 内验证最小宿主协议：

- `pageRegistry.ts` 的 `PAGE_CONTRIBUTIONS` 同一条冻结记录贡献 `view`、可选 `sideBlock` 与按钮显示名；贡献项本身也不可变；
- `AppShell` 与 `WorkspaceTreeSidebar` 只消费派生注册表，不包含 `kt_codegen` 业务分支；
- 页面 Block 默认展开但可从页脚/Ribbon/侧栏设置隐藏，整侧折叠快照也认识页面 Block；
- 页面 Block 与同侧工作空间树并存时，纵向堆叠按实际顶区块数预留高度；极窄窗口按剩余高度等分退让，连固定块最小高度都放不下时也会按权重压缩，不返回负高度或溢出侧栏；
- Host 统一下发 `pageId + workbenchTabId`，为后续多 Tab Block 保留状态隔离入口；
- 左侧 Block 承担文档发现/过滤、活动文档属性、候选源码、控制符与区域选择，主 View 承担文档动作和 Wing Table；AppShell 全局 `WorkbenchBottomPanel` 以可收缩“预检 / 问题 / 运行日志”承载源码/Artifact 对照、可定位诊断和全局日志；
- Model、Reader、Adapter、Block Presentation、Preset、Analyze 与 Table 均来自 `@phoenix-wing/kt-codegen`；
- Desk 宿主只拥有工作空间、编码、指纹、缓存、会话恢复、并发保护、真实文件事务与 HTTP；
- 未保存/冲突草稿、外部文件变化、可取消长请求、Block 卸载取消、慢请求竞态和按需分包已通过自动化验证。

结论：`view + sideBlock` 已扩展到全部页面，并完成通用 Primary、专用页面贡献、固定右栏和全局下方面板。多 Block 分组与 Activity Bar 替换没有进入本轮，不能从本归档直接推定。

后续工具接入前应满足：

1. 领域规则已在 Wing/headless 包，Vue Block 不复制算法或枚举；
2. Block 与 View 通过 store/DTO 联动，不互相查询 DOM；
3. 长任务有明确 running/error/stale 状态，旧请求不能覆盖新选择；后台刷新与前台分析必须串行或合并排队，不能争抢同一工作区扫描；
4. 写盘有预检、计划/内容指纹、编码保留、临时文件、原子替换和复读验证；任何扫描截断必须 fail closed，部分预览不能显示为可 Apply；是否另加确认由目标工程的 Git/diff 工作流决定；
5. dirty 草稿可恢复，外部变更有冲突出口；
6. 页面、Block、路由和分包契约均有测试。
7. Block 可隐藏/恢复，并明确是页面级、Tab 级还是工作空间级状态。

### P0：只做设计样板

- [x] 以 KT Auto Code 的 Codegen Block/Editor 为行为基线，完成真实工具试点。
- [x] 在不替换 Activity Bar/Ribbon 的前提下增加通用页面 Block Host。
- [ ] 截取 Code 改名、成员排序、CAA 三个 Block 作为下一批行为基线。
- [ ] 是否增加可切换 Activity Bar + Primary Sidebar 静态样板，等待多工具试点后决定。
- [ ] 不删除 Ribbon，不修改业务 API，不迁移存储。

### P1：单工具试点

- [x] 首个试点改为 **KT Codegen**：左侧控制 Block + 中央文档 View 已落地。
- [x] 先在 Desk 验证 `PageContribution`，没有提前把 Vue 组件注册协议抽进 Wing。
- [x] 验证滚动、过滤、错误、运行中、缓存、外部冲突和结果选择状态。
- [ ] 下一候选 **Code 改名**：复用同一贡献入口，并评估是否需要多 Block 分组。

### P2：CAA 与成员排序

- [ ] CAA 左侧仅放定位、环境和文件结果；完整编辑器仍在 Workbench。
- [ ] 成员排序对齐插件的候选状态、逐文件操作与 Git Diff 入口。
- [ ] 明确 Primary Sidebar 与右侧属性面板同时开启时的最小工作区宽度。

### P3：决定默认布局

- [ ] 完成人工点检后再决定是否默认启用 Primary Bar。
- [ ] 保留一版兼容开关和旧布局迁移逻辑。
- [ ] 删除旧入口前核对深链、快捷键、会话恢复与新手指引。

## 8. 风险与约束

- “界面相似”不能变成两端各复制一套业务状态；共享层必须先于视觉抽取。
- Desk 是多模块桌面工作台，插件是编辑器侧工具，信息密度和键盘模型不同。
- 工作集目前不是同一存储格式，首期只能对齐语义和选择器。
- CAA 画布、属性编辑和 NLS 不适合塞入 VS Code 式窄侧栏。
- Activity Bar、Ribbon、左右 Dock 同时存在可能产生重复入口，试点必须统计并删除重复动作。

## 9. 立项前需要回答

1. Primary Bar 是替代当前左侧导航，还是作为可选布局与 Ribbon 共存？
2. ~~首个样板选择 Code 改名还是成员排序？~~ 已由 KT Codegen 完成首个真实试点；下一候选倾向 Code 改名。
3. 工具贡献模型当前留在 Desk Tools；至少第二个宿主/工具出现同构需求后再判断是否抽到 `phoenix-wing`。
4. Desk 与插件是否共享一套图标资产，还是只共享语义名称和 token？
5. 工作集 JSON / SQLite 的互操作另做导入导出，还是未来统一权威格式？
