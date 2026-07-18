# Unit Tests 失败关注页面壳验收

状态：current

Owner：Desk Tools web maintainers

适用版本：0.2.x

最后核验：2026-07-18

## 结论

`UnitTestsPage.vue` 的“失败关注”已提炼为单消费者 `UnitTestWatchlistPane.vue`。Pane 拥有关注列表 DOM、表格列、窄宽横向滚动与 scoped style；描述、56 字摘要、日期、suite 和 status 由 UI-neutral `projectUnitTestWatchlistRows()` 投影。Page 从 1,810 行降到 1,437 行，Pane 为 370 行。

本切口只拆 Watchlist，不拆 Result，也不改变运行语义。Pinia、localStorage utility、Run Controller、catalog API、确认框、Primary contribution 和 request payload 仍由 Page/Host 负责。

## 责任边界

```text
unitTestsPage Pinia + unitTestWatchlist utility（session / persistence 真源）
        ↓ sort / checked / default / entries
UnitTestsPage（Run Controller + catalog + confirm + request 组装）
        ↓ projectUnitTestWatchlistRows() 纯展示投影
UnitTestWatchlistPane（DOM / 列 / scoped style / 横滚）
        ↑ sort/default/allChecked/checked/runOnFull/run/remove 语义事件
```

- Pane 只接受 `rows/running/sortBy/defaultRunOnFull/rerunningId`；没有 `ref`、`reactive` 或受控状态副本。
- Pane 上抛 `sort`、`defaultRunOnFull`、`allChecked`、`checked`、`runOnFull`、`runSelected`、`runWatchlist`、`rerun`、`removeRequest`、`clearRequest`。
- 删除与清空的 `pnwPromptChoice`、watchlist utility 写入、checked prune、catalog fetch 和正式运行 request 均留在 Page。
- `projectUnitTestWatchlistRows()` 冻结说明优先级：`description_zh` → 与 `Class.method` 不同的 `title` → 非 `case_id=` 首行 docstring → 模块说明；摘要最多 56 字，空说明显示 `—`。
- suite label、failed/error class、最近失败日期、累计次数、全量开关和受控勾选统一由纯行投影生成。

## 保留的既有问题

页面上的“全部复测”当前仍要求至少勾选一条，并且 request 只发送 checked IDs；无勾选时会提示“请至少勾选一条用例后再复测”。这与按钮名称不完全一致，已由契约测试冻结并记录为独立产品问题。本视觉拆分没有顺手改变 payload，也没有把潜在修复伪装成重构。

## 真实 Browser fixture 点检

入口：`web-ui/test-fixtures/unit-test-watchlist-pane.html`，数据为 12 条失败/错误关注。

| 场景 | 实测结果 |
| --- | --- |
| populated | 12 行、累计失败 33 次、初始勾选 2；切换“失败次数”后首行为 5 次失败项；全选后显示已勾选 12；“复测勾选”发出受控事件 |
| empty | 不渲染表格，显示“暂无失败关注”；复测勾选、全部复测、全部移除均禁用 |
| single-running | 1 行为运行态、其余 11 行为禁用态；复测、移除、勾选与全量开关均受运行期禁用/加载约束 |
| 360 × 760 | document 为 360/360 px，无页面横向溢出；Pane x=14、宽 332 px；表格滚动容器 306/680 px，实测横滚到 300/374 px |

点检期间页面控制台无 warning/error。

## 自动门禁

| 门禁 | 结果 |
| --- | --- |
| Watchlist / ViewModel / Page boundary 定向 | 4 files / 22 tests passed |
| Web UI 全量 | 55 files / 340 tests passed |
| Web UI typecheck | 通过，包含 Browser fixture |
| 架构门禁 | 332 source files / 9 pure graphs / 1 view root passed |
| Wing 依赖边界 | 9 个 manifest 引用均为 Registry 0.4.2，无本地覆盖 |
| Registry production build | Web 2,333 modules + Server sidecar 通过 |
| Browser | populated / empty / single-running / 360px 横滚通过，console 0 warning/error |

## 剩余 TODO

1. Result pane 仍在 Page；先冻结摘要、过滤、模块聚合、case 展开和空态，再单独拆分。
2. “全部复测”按钮的真实语义需要产品决策：改名为“复测勾选”，或允许无勾选时发送全部关注 ID；必须作为独立行为提交。
3. `useAsyncProgress` 的终态 cancel 注销仍是共享基础设施 TODO，不在视觉拆分中处理。
