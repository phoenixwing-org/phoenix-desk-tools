# Web 壳层 · Primary Bar 与 VS Code 插件界面对齐 · 想法

> 状态：**想法记录 · 未立项**  
> 日期：2026-07-15  
> 关联：[侧栏 Block 布局模式](Web壳层-侧栏Block布局模式-规划.md) · [Phoenix 多应用壳层](Phoenix平台-多应用壳层-规划讨论.md) · KT Auto Code `doc/0.4.0-Block工作流改造计划.md`

## 1. 想法

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
│        │ 日志 / 辅助操作       │                              │
└────────┴──────────────────────┴──────────────────────────────┘
```

目标不是像素级复制 VS Code，而是统一用户心智：

1. 左侧窄栏选择模块或工具。
2. Primary Side Bar 内完成轻量配置、预检和结果选择。
3. 复杂编辑、Diff、多文件详情进入中间 Workbench Tab。
4. 同一功能在 Desk Tools 与 VS Code 插件中尽量使用相同名称、图标、状态和操作顺序。

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
- 工作空间树、工作集、Ignore、Git、属性、日志仍需遵守现有左右 Dock 和 Block 布局设置。
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

### P0：只做设计样板

- [ ] 截取 KT Auto Code 的 Code 改名、成员排序、CAA 三个 Block 作为行为基线。
- [ ] 在 Desk Tools 增加可切换的 Activity Bar + Primary Sidebar 静态样板。
- [ ] 不删除 Ribbon，不修改业务 API，不迁移存储。

### P1：单工具试点

- [ ] 首选 **Code 改名**：字段与结果形态适中，已有两端实现。
- [ ] 提取共享 `PhoenixToolContribution`、状态 DTO 和图标 token。
- [ ] 验证小宽度、折叠、滚动、错误、运行中和结果很多时的体验。

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
2. 首个样板选择 Code 改名还是成员排序？本稿倾向 Code 改名。
3. 工具贡献模型放 `phoenix-wing`，还是先留在 Desk Tools 验证后再抽？
4. Desk 与插件是否共享一套图标资产，还是只共享语义名称和 token？
5. 工作集 JSON / SQLite 的互操作另做导入导出，还是未来统一权威格式？
