# Web 壳层：异步 View 首开闪烁整改计划

状态：current

执行状态：已完成（2026-07-20）

Owner：Desk Tools / Web Workbench maintainers

适用版本：Desk Tools 0.2.x、Tauri 2.x、浏览器 Web 版本

最后核验：2026-07-20

## 1. 问题现象

在 Tauri 开发窗口中，点击部分尚未打开过的 Ribbon、主页或导航入口时，工作台会短暂显示空白背景，然后才出现目标 View。现象具有以下稳定特征：

- 只在某个 View 第一次打开、第一次下载或第一次解析时容易出现；
- 已经打开并由 `KeepAlive` 缓存的 View 再次切换不闪；
- CAA Editor、KT Codegen、File Detail、表格等 chunk 较大的页面更明显；
- 发生概率受开发模式、机器负载、Vite 模块转换、WebView 缓存和 CSS 注入时机影响；
- Server、工作空间和页面业务数据没有丢失，属于 View 切换时序问题，不是 Tauri 或 sidecar 崩溃。

该问题不是 Tauri 独有。浏览器 Web 版本首次请求动态 chunk 时也存在相同空档，只是网络缓存和 Chromium 绘制策略有时使它不明显；修复必须放在共享 Web 壳层，不能在 Rust/Tauri 增加私有补丁。

## 2. 根因

页面唯一注册表使用 `defineAsyncComponent()` 加载全部业务 View。工作台导航会立即更新活动 Tab，`AppShell` 随即用新的 `key` / component 替换当前 View；当目标模块尚未完成加载、解析和样式注入时，Vue 的异步组件只有空占位。

现有 `KeepAlive` 只缓存已经成功挂载的页面，不能保护第一次尚未解析完成的页面。因此出现如下时序：

```text
点击新 View
  → activeTab 立即变化
  → 旧 View 离开活动树
  → 新异步组件仍在加载（空占位）
  → WebView 绘制页面背景
  → chunk / CSS ready
  → 新 View 挂载
```

“已打开 View 不闪”正是上述根因的反证：模块 Promise 已兑现，且实例可能已在 `KeepAlive` 中，切换时不再经历空占位。

## 3. 整改原则

### 3.1 原子切换

活动 Tab 可以先变化，以便 Tab 栏立即响应；中央 View 必须保留上一个已就绪实例，直到目标页面模块加载完成。目标 ready 后在同一渲染提交中替换，不允许中间出现没有 View 的帧。

### 3.2 单一加载 Promise

页面注册表为每个 View 维护一个可复用的加载 Promise。预加载和 Vue 异步组件必须消费同一个 Promise，避免双重 import、重复解析或两个状态真源。

### 3.3 最新导航获胜

用户可能在第一个页面尚未 ready 时继续点击第二个页面。切换门禁必须使用递增请求序号；旧 Promise 即使随后完成，也不得覆盖更新的导航意图。

### 3.4 失败不清空

目标模块加载失败或超时时：

- 保留最后一个已就绪 View；
- 显示壳层内错误提示并写入 Output；
- 没有旧 View 时使用与主题一致的加载/错误占位；
- 不以 `window.location.reload()` 掩盖问题。

### 3.5 保留按需加载

本轮不把全部页面改成静态 import。一次性加载会扩大启动解析、内存和测试耦合，也会削弱页面边界。可以在后续增加 Ribbon hover 或浏览器 idle 预热，但它们只是性能优化，不能替代正确的原子切换门禁。

## 4. 实施步骤

### F0：固定问题与边界

- 记录“首开闪、已开不闪”的特征；
- 确认根背景色已经使用主题令牌，排除单纯 CSS 白色背景；
- 确认修复范围仅为 `web-ui` 壳层，不修改 Tauri lifecycle、端口或业务页面。

### F1：页面注册表可预加载

- 将页面 loader 包装为一次性、失败可重试的共享 Promise；
- 导出 `preloadPageComponent(pageId)`；
- 未知页面继续同步回退 `PlaceholderPage`，不创建悬空 Promise。

### F2：View 原子切换门禁

- 将“导航期望 Tab”和“当前显示 Tab”分离；
- 目标模块 ready 前继续显示旧 View；
- 目标 ready 后才更新显示 Tab；
- 空工作台、欢迎页、关闭 Tab 和快速连续导航均有确定行为。

### F3：错误与视觉兜底

- 没有旧 View 时显示主题一致的“正在准备 View”占位；
- 加载错误保留旧 View，并提供可见错误信息；
- 不使用全屏白色遮罩，不阻塞 Header、Primary、Properties 和底部 Panel。

### F4：验证

- 纯状态测试：旧 View 保留、目标 ready 后切换、后发导航获胜、失败保留、空工作台；
- 注册表测试：同页预加载 Promise 复用、未知页拒绝或回退契约；
- 架构测试：`AppShell` 渲染显示 Tab，而非直接渲染活动 Tab；
- Web 全量测试、类型检查和生产构建；
- Tauri `pnpm tauri:dev` 人工连续首开重页面；
- macOS release app smoke，确认 Codegen、FCStd 与退出流程不受影响。

## 5. 完成定义

- 第一次打开任意业务 View 时中央区域不存在空帧；
- 已打开页面切换行为和 `KeepAlive` 状态不变；
- 快速连续点击多个新 View 时只显示最后一次选择；
- 加载失败不清空旧 View；
- Web 与 Tauri 共用同一实现，没有 Rust/Tauri 专属 workaround；
- 页面仍按需拆包，生产构建没有把所有业务页合回主 chunk。

## 6. 人工点检

1. 停止普通 `pnpm dev`，运行 `pnpm tauri:dev`。
2. 依次首次打开 CAA Editor、KT Codegen、File Detail、Code Index、Unit Tests。
3. 每次点击时观察旧 View 是否保持到目标 View 完整出现，Header/Ribbon/Primary/Properties 不应白闪。
4. 快速连续点击两个尚未打开的页面，最终只应落在第二个页面。
5. 再次切换上述已打开页面，确认状态、滚动和编辑草稿仍由 `KeepAlive` 保留。
6. 在浏览器访问 `http://localhost:49373/` 重复点检，确认 Web 版本一致受益。

## 7. 2026-07-20 实施与验收记录

- 页面注册表使用失败可重试的共享 Promise；预加载与 `defineAsyncComponent` 消费同一次动态 import。
- `AppShell` 已分离活动 Tab 与显示 Tab：目标 ready 前保留最后一个已就绪 View，ready 后再提交显示切换。
- 快速连续导航使用递增请求序号，较早完成的 loader 不能覆盖最后选择。
- 模块加载失败保留旧 View；没有旧 View 时显示主题一致的加载/错误页，并提供重试与 Output 日志。
- `KeepAlive` 继续缓存已打开页面；生产构建仍输出独立的 CAA Editor、KT Codegen、File Detail、Table 等页面 chunk，没有退回全量 eager import。
- Web 全量测试通过：64 个测试文件、379 项；其中新增共享 loader、旧 View 保留、后发导航获胜、失败保留和架构边界测试。
- Web 类型检查与生产构建通过；架构门禁通过 339 个源文件、9 个 pure graph 和 1 个 view root。
- `pnpm verify:tauri-release:macos` 通过：release `.app` 构建、启动、Codegen Preflight/Apply、真实 FCStd 读取、优雅退出和 sidecar 释放均成功。
