# Web 壳层 · Pnw 工作台 0.6 接入

状态：current

Owner：Desk Tools web architecture maintainers

适用版本：Desk Tools 0.3.x / 本地 Wing 0.6.x（Registry 依赖保持 0.5.1）

最后核验：2026-07-29

## 目标

Desk Tools 以真实 consumer 身份接入 `PnwWorkbenchShell`，把通用的导航、Ribbon /
Tree 呈现、可调整面板、底部 Tab 与 Footer 交给 Wing；领域 View、路由与业务状态仍
属于 Desk。

这是一条并列仓库验证路径，不修改 `package.json`、lockfile 或 `node_modules`，也不代表
Registry 包已升级。正式包升级须等待 Wing 0.6 发布后另行执行。

## 责任边界

| 责任 | Desk Tools | Wing 0.6 |
| --- | --- | --- |
| 导航数据 | 继续由 `navigation.ts` / `ribbonConfig.ts` 的既有页面定义产生 | `pnwNavigationFromRibbonTabs` 适配为单一导航树并呈现 |
| Primary | 页面通过 `usePagePrimaryContribution` 注册业务筛选、属性等 | 只在贡献存在时布局、显示与收缩 |
| Secondary | `WorkspaceTreeSidebar` 内的树、属性、Git、工作集仍是 Desk 业务内容 | 只提供右侧区域、尺寸和可见性 |
| Bottom | `useWorkbenchBottomContribution` 的预检/问题贡献与 Desk 运行日志 | 外层 Bottom Tab、句柄和 Footer 开关 |
| Footer | 状态文本、任务进度和 Desk 信息 | 三个面板开关与布局事件 |
| Router / API / 权限 | Desk 自己处理导航激活与业务访问 | 不持有、不调用 |

`PnwPageHeader` 仍是各工程 View 的内部页眉能力，不被工作台外壳替换；复杂 View 可以
继续使用自己的标题、动作和内容布局。

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

1. Registry 清单仍固定在 Wing 0.5.1；等待 0.6 真实发布后，使用独立提交升级并运行 Registry
   对照验证。
2. 这次只验证外壳接入，不重写 Desk 领域 View。后续新增页面时优先注册
   Primary/Secondary/Bottom contribution，不把业务逻辑放进 `AppShell`。
3. 窄屏、浮层 Tree 等响应式策略以 Wing 为唯一布局实现；Desk 不保留第二套手工 margin、
   resizer 或可见性状态。
