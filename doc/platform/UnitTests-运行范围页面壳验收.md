# Unit Tests 运行范围页面壳验收

状态：current

Owner：Desk Tools web maintainers

适用版本：0.2.x

最后核验：2026-07-18

## 结论

`UnitTestsPage.vue` 中央的“运行范围”已提炼为单消费者 `UnitTestRunScopePane.vue`。Pane 拥有运行范围 DOM、局部折叠、表格列与 scoped style；模块行展示投影由 UI-neutral `unitTestsViewModel.ts` 产生。Page 从 2,131 行降到 1,810 行。

这是 Unit Tests page shell 的第一个视觉切口，不代表整页已拆完。Watchlist 和 Result pane 仍在 Page，后续必须分别建立 characterization 后再迁移。

## 责任边界

```text
unitTestsPage Pinia store（session 真源）
        ↓ 受控 model / props
UnitTestsPage（Plan/Run Controller + Host + request 组装）
        ↓ 纯行 ViewModel
UnitTestRunScopePane（DOM / 局部折叠 / 样式）
        ↑ suite/module/sort/run 语义事件
```

- Pinia 继续唯一保存“列出运行范围”、“展开用例”和排序选择；Pane 不保存副本。
- 模块勾选、suite 勾选、plan/loading/error、单模块运行态均为受控输入。
- Pane 只上抛 `suiteChange`、`allModulesChange`、`moduleChange` 和 `runModule`；不导入 API、Plan/Run Controller、Shell、Pinia 或 storage。
- 局部 `collapsed` 仅是非持久的视觉状态。Primary contribution、正式 request、watchlist/history/catalog 仍归 Page/Host。
- `projectUnitTestRunScopeRows()` 集中模块名、简介、suite/backend、case 明细和运行历史的展示投影，不读取 Vue、API 或存储。

## 行为与可达性

- 保留 suite、模块、全选、排序和行内运行的原有语义，单模块 request 仍由 Page 组装。
- loading 期间模块勾选和行内运行不可用；error 保留 Host 错误文本；空计划同时显示 `0 模块 · 0 用例` 摘要和明确空态。
- 折叠入口是独立原生 `button[type=button]`，有 `aria-expanded` / `aria-controls`，可用 Enter 和 Space 折叠/展开；suite checkbox 不嵌套在该 button 内。
- 36 模块表格使用内部纵向滚动；360 px 窄宽时页面本身不溢出，820 px 表格在 Pane 内横向滚动。

## 真实 Browser fixture 点检

入口：`web-ui/test-fixtures/unit-test-run-scope-pane.html`，数据为 36 模块 / 106 用例。

| 场景 | 实测结果 |
| --- | --- |
| loaded | 36 个行内运行入口；摘要为 `36 模块 · 106 用例 · 将忽略 2`；取消 1 个模块后受控摘要变为 `35/36 模块 · 105 用例` |
| loading | 36 个模块 checkbox 和 36 个行内运行按钮全部禁用，显示“加载计划…” |
| error | 显示 `Error: fixture offline`，不误显示空态或旧表格 |
| empty | 显示 `0 模块 · 0 用例` 与“当前计划没有可执行模块” |
| single-running | 目标行显示 loading，其余 35 个行内运行按钮禁用，suite 与范围控件禁用 |
| 360 × 760 | document 宽度 360 px，Pane 位于 x=14…346；滚动容器 304/820 px，实际横滚到 420/516 px；纵滚到 260/1215 px |

点检期间页面控制台无 warning/error。

## 自动门禁

| 门禁 | 结果 |
| --- | --- |
| RunScope / ViewModel / Controller 定向 | 7 files / 34 tests passed |
| Web UI 全量 | 46 files / 298 tests passed |
| Web UI typecheck | 通过 |
| 架构门禁 | 328 source files / 8 pure graphs / 1 view root passed |
| Registry 消费 | Web 测试与 build 均报告 `[Wing][REGISTRY]` |
| Wing 依赖边界 | 9 个 manifest 引用均为 Registry 精确版本，无本地覆盖 |
| Web production build | 通过 |
| 文档 / diff | manifest 与 current 链接通过；`git diff --check` 通过 |

## 剩余 TODO

1. Watchlist 仍保留勾选、排序、移除、复测、localStorage utility 和整表 DOM；先建立拆分前 characterization，再提炼单消费者 pane。
2. Result 仍保留摘要、筛选、模块聚合和 case 明细 DOM；不与 Watchlist 同步大搬迁。
3. `useAsyncProgress` 在流终态的 cancel 注销是共享基础设施 TODO，不在 Page shell 切口中顺手改写。
