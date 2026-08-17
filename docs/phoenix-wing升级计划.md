# phoenix-wing 升级计划

desk-tools 当前已接入基础 phoenix-wing 模块，需升级到最新版以使用新组件和引擎。

## 现状

已使用的 phoenix-wing：组件导入、composable 导入、属性表系统

## 可升级项

### 🔴 高价值（减少重复代码）

| 模块 | 当前状态 | 升级为 | 工作量 |
|------|---------|--------|--------|
| RibbonShell | 自有 `RibbonShell.vue` (108行) | `PnwRibbonShell` + layout toggle | 中 |
| ShellLogPanel | 自有 `ShellLogPanel.vue` (95行) | `PnwShellLogPanel` | 低 |
| WorkbenchTabBar | 自有 `WorkbenchTabBar.vue` (527行) | `PnwWorkbenchTabBar` | 高 |

### 🟡 中等价值（统一对话框）

| 模块 | 当前状态 | 升级为 |
|------|---------|--------|
| ElMessageBox.alert | 可能还有残留 | `pnwAlert` |
| ElMessageBox.prompt | 可能还有残留 | `pnwPromptInput` |

### 🟢 低价值（desk-tools 不需要）

| 模块 | 原因 |
|------|------|
| PnwDictSelect | desk-tools 无字典系统 |
| pnwCreateWorkbench | desk-tools 有自有 useWorkbench.ts |
| PnwWelcomeShell | desk-tools 有自有 WelcomePage |
| PnwPageHeader | desk-tools 有自有 PageHeader |

## 步骤

- [x] 1. 替换 `ShellLogPanel.vue` → `PnwShellLogPanel` ✅
- [x] 2. 替换 `RibbonShell.vue` → `PnwRibbonShell` (含 layout 切换) ✅
- [x] 3. 检查并替换残余 `ElMessageBox` → `pnwAlert`/`pnwPromptInput` ✅（源码中无残留使用，仅 auto-imports.d.ts 类型声明）
- [x] 4. build 验证 ✅（通过）

---

## 补充评估：🟢 低价值模块再评估

### PnwPageHeader

**结论：无需替换，已在使用。** desk-tools 没有本地 `PageHeader.vue`，所有 22 个页面文件已直接从 `phoenix-wing/layout/PnwPageHeader.vue` 导入（别名 `PageHeader`）。无需任何改动。

### PnwWelcomeShell vs WelcomePage

**结论：可部分替代，但不是纯替换。** `PnwWelcomeShell` 是纯布局壳层（6 个插槽：brand/actions/links/title/headActions/main），不含业务逻辑。`WelcomePage`（575 行）包含大量业务逻辑（工作区切换、巡游、最近列表等）。替代方案是保留 WelcomePage 的逻辑，将模板重构为填 `PnwWelcomeShell` 的插槽——分离布局与业务逻辑，与现有模式一致。

| 属性 | WelcomePage (desk-tools) | PnwWelcomeShell (phoenix-wing) |
|------|--------------------------|-------------------------------|
| Props | 无 | `appTitle?` |
| 插槽 | 无 | 6 个命名插槽 |
| 业务逻辑 | 大量（shell、工作区、巡游） | 无 |
| 左侧栏宽度 | 280px | 240px |
| 工作量 | — | 中（模板重构，逻辑保留） |

**建议**：可做但非紧急。唯一消费者就是 AppShell.vue，提取布局壳层不消除重复，仅改善架构分层。

### pnwCreateWorkbench vs useWorkbench.ts

**结论：可替换，工作量大（≈WorkbenchTabBar 级别）。** `pnwCreateWorkbench` 是 `useWorkbench.ts` 的依赖注入版本，API 表面几乎完全相同。

| 方面 | useWorkbench.ts | pnwCreateWorkbench |
|------|----------------|-------------------|
| 配置方式 | 直接读取 `appConfig` ref | 通过回调注入（pagePolicy、navLabel 等） |
| 页面策略 | 内部硬编码提取 | `config.pagePolicy(pageId)` 回调 |
| 导航标签 | 内部从 navigation 数组查找 | `config.navLabel(pageId)` 回调 |
| 临时页 | 硬编码 `Set(["welcome","home","config"])` | `config.ephemeralPages` |
| 脏页确认 | 直接 import `confirmDirtyTabClose` | `config.onDirtyClose(title, canFlush)` |
| 全部关闭确认 | 直接 import `confirmCloseAllTabs` | `config.onCloseAll(count, dirtyTitles)` |
| 页面会话 | 直接 import `getPageSession` | `config.getPageSession(tabId)` |
| 缺失函数 | — | `navigateToPage`, `ensureInitialTab`, `basename`（需本地包装） |

**影响范围**：仅 `useAppShell.ts` 一个消费者。需构建 `PnwWorkbenchConfig` 配置对象并迁移 `basename` 到独立工具函数。

**建议**：可做，但属于「消除硬编码耦合」而非「减少重复代码」。如果后续有新项目复用工作台逻辑，价值会更高。
