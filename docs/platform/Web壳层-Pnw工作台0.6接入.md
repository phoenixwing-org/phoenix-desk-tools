# Web 壳层 · Pnw 工作台 0.6 接入

状态：current

Owner：Desk Tools web architecture maintainers

适用版本：Desk Tools 0.4.0 / Wing 根包 0.7.5（scoped 包按独立发布矩阵）

最后核验：2026-08-17

## 目标

Desk Tools 以真实 consumer 身份接入 `PnwWorkbenchShell`，把通用的导航、Ribbon /
Tree 呈现、可调整面板、底部 Tab 与 Footer 交给 Wing；领域 View、路由与业务状态仍
属于 Desk。

并列仓库仍是未发布能力的开发验证路径，不修改 Registry 依赖图。正式发行与普通消费使用
`package.json`、lockfile 锁定的 npm 包；当前已升级到根包 0.7.5，scoped 包按 Wing 独立发布矩阵精确锁定。

## 责任边界

| 责任 | Desk Tools | Wing 0.6 |
| --- | --- | --- |
| 导航数据 | 继续由 `navigation.ts` / `ribbonConfig.ts` 的既有页面定义产生 | `pnwNavigationFromRibbonTabs` 适配为单一导航树并呈现 |
| Primary | 页面通过 `usePagePrimaryContribution` 注册业务筛选、属性等 | 只在贡献存在时布局、显示与收缩 |
| Secondary | `WorkspaceTreeSidebar` 内的树、属性、Git、工作集仍是 Desk 业务内容 | 只提供右侧区域、尺寸和可见性 |
| Bottom | `useWorkbenchBottomContribution` 的预检/问题贡献与 Desk 运行日志 | 外层 Bottom Tab、句柄和 Footer 开关 |
| Footer | 状态文本、任务进度和 Desk 信息 | 三个面板开关与布局事件 |
| Router / API / 权限 | Desk 自己处理导航激活与业务访问 | 不持有、不调用 |

`PnwPageHeader` 仍是各工程 View 的内部页眉能力，不被工作台外壳替换；由
`PnwPageLayout` 承接固定页头与正文滚动，复杂 View 保留业务内容布局。

## 受控显示状态

Desk 将 `PnwWorkbenchDisplayPreferences` 存入本消费者的 Pinia 状态，并以 versioned
localStorage envelope 保存。读取时通过 Wing 的
`pnwNormalizeWorkbenchDisplayPreferences` 归一化，因此损坏、缺项或未来未知值都会回落到
Desk 默认值。

默认值保留 Desk 的三块工作方式：Primary、Secondary、Bottom 均可见，尺寸为
`300 / 300 / 190`。Wing 发出完整 `update:layout-state` 后，Desk 整体保存该状态；Footer
的开关事件仅用于日志，不再次反转可见性，避免一次点击被处理两次。

## 本地验证入口

在并列目录 `phoenix/phoenix-desk-tools` 中执行：

```bash
pnpm wing:check-local
pnpm verify:wing-dependencies
pnpm test:local-wing
pnpm build:local-wing
```

为只校验 Web 接入层的本地 Wing 声明，可运行：

```bash
pnpm -C web-ui exec vue-tsc --noEmit --pretty false -p tsconfig.local-wing.json
```

`tsconfig.local-wing.json` 仅把 TypeScript 声明解析到相邻 Wing 的已构建 `dist`；它不写入
依赖图，也不替代标准本地联调命令。

## 当前限制与后续检查

1. Registry 根包已固定为 Wing 0.7.5，scoped 包按独立发布矩阵精确锁定；Registry 测试、生产构建
   与 macOS Tauri 发布冒烟已通过。
2. 这次只验证外壳接入，不重写 Desk 领域 View。后续新增页面时优先注册
   Primary/Secondary/Bottom contribution，不把业务逻辑放进 `AppShell`。
3. 窄屏、浮层 Tree 等响应式策略以 Wing 为唯一布局实现；Desk 不保留第二套手工 margin、
   resizer 或可见性状态。

## 2026-10-04 Main / Primary 标题行对齐审计

本轮仍消费精确锁定的 Registry `phoenix-wing@0.7.5`，没有修改 Wing、依赖清单或安装目录。
规范依据为并列 Wing 的 `docs/View页面标准.md`、`docs/Pnw工作台Web页面布局与Header.md`
及 `docs/Pnw工作台WebPrimary面板与Section.md`，公开 API 另以已安装 0.7.5 的声明与实现核对。
最新标准中的 `#center/#right` 和新 card 外观属于更新版本；0.7.5 继续使用
`#leading/#actions/#help`，需要操作靠右时使用公开 `actions-align="end"`，不穿透模拟新版布局。

审计发现各 Main 页虽已消费同一个 `PnwPageHeader`，外围却分别采用 0、16/20、20/22px
留白；Git 还有独立页头包装与第二条横线，壳层又强制普通页面整体滚动。这些是消费者装配
差异，不是 Wing 缺少统一 Header 能力。

统一接法：

- 工程 View 用 `PnwPageLayout` 作为根，公开 `#header` 插槽内保留唯一 `PnwPageHeader`
  与现有业务操作；默认正文滚动，标题不跟随正文移动。根不再挂旧 `.page` 类。
- 显式正文 `PnwPageMainBlock` 对应 `bodyInset=false`，只由 MainBlock 提供默认 10px
  留白；不再把旧工具页 padding 包住 Header。普通页面也可直接使用 PageLayout 默认 MainBlock，
  两种方式不能叠加。
- 零件目录、CAA 列表、文件详情和零件详情保留结果区自管滚动，显式设 `bodyScroll=false`，
  正文使用 `desk-page-body--fill` 连接满高 flex 链。CAA 编辑器的画布、关联文件与 NLS 面板
  保持自然流，由 Wing 正文滚动，不将整套编辑器裁成固定高度画布。
- Primary 顶层使用 `PnwPrimaryPanel`，分区使用 `PnwPrimarySection`；贡献、业务字段、
  折叠状态仍属于 Desk。不要用普通 SidebarBlock 的 26px 标题条替代顶层 Primary Header。
  CAA 的独立贡献也采用同一结构：顶层「CAA 对话框」Panel 下放「对话框索引」与编辑页的
  「控件树」Section，保留展开、搜索、刷新/扫描和控件选中；业务正文各留 8px inset。
  由 Panel 正文承接自然内容滚动，不再用 50% 高度占位、最小 150px 或私有分隔线撑大分区。
- Home/Welcome 保持 Wing Home 范式，不强制改成工程 View。

几何与主题使用 Wing 公共契约：Main/Primary 标题行共用
`--pnw-workbench-view-header-height`（默认 40px），Main Header 默认 `3px 12px`；
正文使用 `--pnw-page-main-block-padding`（回退 `--pnw-page-body-padding`，默认 10px）；
Primary Section 默认 28px、`4px 8px`，连续底线且无横向卡片间隙。文字、边框和背景沿用
`--pnw-workbench-*` 语义 token；Primary 开关的 32px 前导位由 Wing 控制，不清零、不复制按钮。
对齐目标是标题行边界和横线，不把 Main 与 Primary 不同层级的字号强行改成相同大小。

自动回归见 `web-ui/src/pages/pageLayout.contract.test.ts`，覆盖所有当前 PageHeader 页的
结构、独立正文滚动和旧 Header 覆盖清理。类型/结构测试不替代浏览器点检；交付前仍须检查
宽窄屏的 Header 横线、长按钮中区溢出、滚动到底、Primary 开关与 CAA 草稿状态保留。

本轮自动门禁：布局契约 26 项、CAA 画布 5 项通过；最终 Registry 与本地 Wing Web 均为
72 files / 479 tests 通过，类型、生产构建、架构与依赖边界通过。主库 Web/API 只读请求 200。
本轮 Mac 锁屏，实际浏览器 Header 横线、主题/窄屏与原生文件夹选择仍标为待验；没有把
结构测试等同于像素验收。业务数据与用户 CAD 文件未写入，未修改 Wing 源码或正式依赖。

### 同日交互补验

用户随后解锁并确认 Header 对齐通过、批量属性 Main 滚轮恢复。定位发现 Wing Editor 为
普通块容器，Desk `.shell-pages` 仅设 `flex:1` 不能形成明确高度，内部正文随内容撑开。
现由 Host 提供 `width/height:100%` 与最小尺寸约束，让 Wing PageLayout 真正拥有正文滚动；
批量表格不再创建嵌套 overflow，也不加 wheel/preventDefault 补丁。浏览器真实滚轮将正文
scrollTop 从 0 推至 720，外层 Editor 不溢出，Header 固定；Tauri 原生滚轮未重复验收。

Primary/Main 的产品操作改为短文字：CAA 刷新/扫描、列表/分组、画布模式，Git 暂存/差异/放弃，
目录选择/刷新、帮助/关闭等。保留 Wing 的结构性折叠、浮出及全局壳层控制，不复制框架按钮。
`textActions.contract.test.ts` 与既有组件测试保护文字及操作接线；自动测试不替代所有 CAA/Git
工作流实机验收。Welcome 工作空间类型下拉可打开，但本次只读点检未改变用户记录。

### 同日 Header 公共插槽迁移（联合整改阶段一）

用户进一步要求跟随 Wing 最新惯例。确认 `#center/#right` 已在 Registry 0.7.6 发布后，
仅将根 UI 包及 lockfile 精确升到 `phoenix-wing@0.7.6`，scoped CAD 等依赖不变。
本地开发通过 `pnpm wing` 指向并列主库 `1610d69ea868561cdccf272ad0684fe9f5767de3`
（根 0.7.7 候选），Web/API 日志均为 `[Wing][LOCAL]`，未新增路径覆盖或修改安装目录。

- 全部 20 个 PageHeader 页面采用 `#right` 放业务命令；零件目录搜索/状态、Git 路径过滤、
  PartKey 输入、CAA 语言配置进入 `#center`。无中间内容的页不传空插槽。
- 删除非公共 `page-id` 属性及零件目录正文中重复的搜索/状态布局。保留同一个 Pinia/响应式
  状态、Primary 筛选和事件接线；不复制 Wing Header 容器、横线、溢出与主题 CSS。
- 结构测试覆盖新插槽及 Header 固定布局；原 SharedDirectory 用例同步改为检查 `#right`，
  不是删除或放宽测试。
- 浏览器（本地 Wing）1280×720 与 960×720：页头与 Primary 横线对齐；搜索使目录从 410
  项筛到 2 项，Primary 同步，清空恢复。窄宽度下 right 按钮不被挤走，center 超出部分由
  Wing 横向滚动；Tab 可进入状态选项并滚动显示焦点。批量工具无 center 也正常。
  新点检标签 console error/warn 为 0，未写 CAD 文件；视口与搜索已恢复。

自动验证：Registry Server 64 files / 227 tests、core 11 / 67、Web 75 / 509；本地 Wing
同套测试与 Web/Server 构建通过，共 803 项。类型、架构（332 源文件）、依赖（6 项精确版本）、
文档（155 篇）及 diff whitespace 门禁通过。既有 sourcemap / large chunk 提示仍在。
本阶段没有 Wing 源码改动，也没有声称新的 CAD 共享扫描或 Tauri 原生点检已经完成。
