# CAD 索引设置页面壳验收

状态：current

Owner：Desk Tools maintainers

适用版本：0.2.x

最后核验：2026-07-18

## 1. 本次目标

`FcstdMapPage.vue` 的“扫描设置”原本内联扫描说明、工作空间路径、JSON 导出入口和最近查询 SQL。本切口把这段单消费者 UI 提炼为 `FcstdMapSettingsPane.vue`，不改变真实扫描、索引、导出或 FreeCAD 行为。

结果：

- `FcstdMapPage.vue` 从 851 行降到 661 行；
- 新 Pane 为 115 行，只接受 `workspacePath`、`hasIndex`、`exporting`、`debugSql` 四项受控输入；
- Pane 只上抛无 payload 的 `exportJson` 语义事件；
- 同步删除 Page 中 `.sub-tab`、`.field-label`、`.row`、`.path-input`、`.force-opt`、`.stats-grid`、`.meta-block`、`.btn` 八组无消费者的旧 scoped CSS，并由架构测试禁止回流。

## 2. 责任边界

| 责任 | 所有者 | 本次是否迁移 |
| --- | --- | --- |
| 扫描说明、工作空间路径、导出按钮、调试 SQL DOM 与样式 | `FcstdMapSettingsPane` | 是 |
| `exporting` 与索引存在状态 | `FcstdMapPage` | 否，只通过 props 下发 |
| `exportFcstdMapJson`、导出日志、状态栏、刷新 | `FcstdMapPage` | 否 |
| scan/cancel、purge、prefs 保存、AsyncProgress | `FcstdMapPage` | 否 |
| Pinia、localStorage、PageSession、Primary、Prompt、Host 导航 | `FcstdMapPage` | 否 |
| FCStd 文件读写、FreeCAD/SolidWorks 外部进程 | Server/外部引擎 | 不在本次范围 |

Pane 禁止导入 API、Shell、AsyncProgress、Pinia store、PageSession、浏览器存储或 Prompt。它表达“用户想导出”，但不知道导出路径、执行结果和日志。

## 3. 冻结的 UI 契约

- 扫描说明继续指出当前工作空间根与 `.phoenix/phoenix-workspace.sqlite`；
- 仅在路径非空时显示“工作空间”；
- 保留“强制更新零件名不写回 FCStd”的提示；
- 无索引时禁用“导出 fcstd_map.json”；导出中沿用按钮 loading；
- `debugSql` 为空时不显示调试块，非空时保持可复制和区内滚动；
- Page 继续用 `v-show` 管理两个子页签，切换不会重建设置 Pane 的宿主状态。

## 4. 自动门禁

定向测试覆盖真实 SSR、文案/禁用条件/事件 characterization、Page/Pane 架构责任和死 CSS 防回流：

```bash
pnpm -C web-ui exec vitest run \
  src/components/fcstd-map/FcstdMapSettingsPane.contract.test.ts \
  src/components/fcstd-map/FcstdMapSettingsPane.test.ts \
  src/pages/FcstdMapPage.architecture.test.ts
```

提交前还应运行：

```bash
pnpm -C web-ui test
pnpm -C web-ui typecheck
pnpm verify:architecture
pnpm verify:wing-dependencies
pnpm docs:check
pnpm build:registry
```

2026-07-18 自动结果：定向 3 files / 13 tests、Web 全量 57 files / 349 tests、`vue-tsc --noEmit`、架构 333 source files / 9 pure graphs / 1 view root、135 份文档分类与链接、9 个 Wing Registry 0.4.2 依赖引用、Registry Web 2,336 modules 与 Server bundle 全部通过。

## 5. Browser fixture 点检

独立夹具：`web-ui/test-fixtures/fcstd-map-settings-pane.html`。启动 Registry 对照 Web 后打开：

```text
http://127.0.0.1:4173/test-fixtures/fcstd-map-settings-pane.html
```

逐项点检：

- [x] “已有索引”显示路径与 SQL，导出按钮可点击，事件输出追加 `export-json`；
- [x] “无索引”禁用导出按钮；
- [x] “导出中”显示 loading，避免重复导出；
- [x] “最小信息”不显示工作空间行与调试 SQL 块；
- [x] 360px 宽度下卡片、长路径和 SQL 不造成页面横向溢出；
- [x] 控制台没有 Vue warning 或 error。

Browser 量测（360 × 760）：document `clientWidth/scrollWidth = 360/360`，Pane `302/302`，外层 shell `326/326`，SQL `266/266`；控制台 warning/error 为 0。正常态点击后事件为 `ready | export-json`，无索引与导出中状态均由真实 DOM 标记为 disabled。

fixture 只证明 Pane 的展示与事件契约，不调用真实导出 API、不创建 `fcstd_map.json`、不扫描 FCStd，也不能替代真实 FreeCAD 验收。

## 6. 后续切口

设置 Pane 已是职责闭合的小组件，不继续拆分。`FcstdMapPage` 后续如需再降复杂度，应先冻结扫描冲突恢复、终态分支与取消语义，再评估可注入 scan controller；不得把 API、Prompt、运行日志和外部引擎行为下沉到展示 Pane。
