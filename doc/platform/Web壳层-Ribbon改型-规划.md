# Web 壳层 · Ribbon 改型规划

> 状态：**R0–R3 已落地 · R4 进行中 · 2026-06**  
> 关联：[Web壳层-Tab与状态持久化-规划讨论.md](Web壳层-Tab与状态持久化-规划讨论.md)、[Phoenix平台-多应用壳层-规划讨论.md](Phoenix平台-多应用壳层-规划讨论.md)  
> 待办跟踪：[TODO.md](../TODO.md) § Web 壳层 · Ribbon 改型

---

## 1. 决策摘要（已确认）

| 项 | 决策 |
| --- | --- |
| 架构 | **Monorepo**：`web-ui/`（前端）+ `phoenix/`（Python API），逻辑上前后端分离 |
| 前端 | Vue 3（最新）+ TypeScript + Vite |
| UI 库 | **Element Plus**（按需引入，不引入第二套 UI 库） |
| Ribbon | **手搓组件**，不用 npm Ribbon 插件 |
| 开发启动 | 继续 **`python -m phoenix.web --dev`** 一键双进程（5173 Vite + 8765 API） |
| 生产交付 | `pnpm build` 后 Python 托管 `web-ui/dist`（用户仍一条命令） |
| 业务页 | **渐进迁移**；壳层先改，各 `*Page.vue` 不强制一次重写 |

参考视觉：**Chili3D 式 Ribbon** — 顶 Tab → 分组面板 → 方块工具按钮（大/小混排、组间竖线、底部分组标题）。

---

## 2. 现状（2026-06 归档后）

```
AppToolbar          ← 顶栏：品牌（含工作空间副标题）/ 功能区 Tab / 页面 Tab / ▲
RibbonShell         ← 分组或单行工具按钮；「开始」Tab 含壳层常用区
WorkbenchTabBar     ← 顶栏中部 in-header（page 图标 + 标题）
WelcomePage         ← 启动默认全屏欢迎
主内容 KeepAlive    ← 各业务页
WorkspaceTreeSidebar← 左或右停靠：树 + 日志（同侧可上下分栏）
StatusBar           ← 日志收起时可一键展开
```

- Element Plus 已接入壳层；Ribbon 为唯一功能入口。
- 左侧 `NavSidebar` 快捷栏默认不渲染，代码保留。
- API 契约不变：前端只调 `/api/*`。

---

## 3. 目标布局（已落地）

```
┌─ AppToolbar（顶栏 40px）─────────────────────────────────────────────┐
│ Phoenix/工作空间 │ [开始|CAD|Code|系统] │ ← 页面 Tab（图标）→ │ ▲      │
├─ Ribbon Panel（可折叠；切功能区 Tab 时自动展开）───────────────────────┤
│ 工具按钮… │「开始」：工作空间 / 模块 / 树·日志·侧栏                      │
├─ 主内容 ────────────────────────────────────────│ 树 / 日志（左/右）    │
└─ StatusBar ───────────────────────────────────────────────────────────┘
WelcomePage：全屏，不在上述 Tab 行中。
```

Ribbon 按钮 → `shell.goToPage(pageId)`。

---

## 4. 组件规划

```
web-ui/src/layout/ribbon/
  RibbonShell.vue         # Tab + 可折叠 Panel 容器
  RibbonTabBar.vue        # el-tabs 外壳
  RibbonPanel.vue         # 单 Tab 下 Flex 横排
  RibbonGroup.vue         # 分组 + 底标题 + 右侧竖线
  RibbonToolButton.vue    # large | small；icon + label
  RibbonPanelUtils.vue    # 「开始」Tab：树/日志/侧栏常用操作
  RibbonModuleToggles.vue # 「开始」Tab：CAD/Code 模块开关
  RibbonWorkspaceSwitcher.vue
  RibbonUtilButton.vue
  ribbonConfig.ts         # Tab / Group / Item（初版可静态）
  ribbonIcons.ts          # pageId → Element Plus icon
```

数据流（Phase 1）：`ribbonConfig.ts` 静态表 + 过滤 `app_config.navigation` 的 `module` 与 `nav_modules.enabled`。

Phase 2（可选）：`app_config.json` 增加 `ribbon` 段或由 API 下发。

---

## 5. 样式约定（CAD 硬朗风）

在 `web-ui/src/style.css` 与 Element 主题变量对齐：

```css
:root {
  --el-border-radius-base: 2px;
  --el-border-radius-small: 2px;
  --ribbon-bg: #f3f4f6;
  --ribbon-group-divider: #c5cdd8;
  --ribbon-btn-hover: #e8eef5;
  --ribbon-panel-height: 96px; /* 展开；折叠时约 32px */
}
```

业务页继续用 `page-shared.css`；**仅壳层**使用 Element 组件，避免与现有 scoped 样式大面积冲突。

---

## 6. 分期实施

### R0 · 前端栈定型（已部分完成）

- [x] 安装 Element Plus + Vite 按需插件
- [x] `vite.config.ts`：`AutoImport` / `Components` + `ElementPlusResolver`
- [x] `App.vue`：`el-config-provider` 中文 locale
- [x] `style.css`：Element 圆角 / Ribbon CSS 变量
- [x] `pnpm build`（`sass-embedded`、`@element-plus/icons-vue`）
- [x] `web-ui/README.md` 补充「前端栈 / Element Plus」小节

**验收**：`pnpm build` 通过；任意页可放一个 `el-button`  smoke test（可随后删除）。

### R1 · Ribbon 静态原型（不接业务）

- [x] 新建 `layout/ribbon/*` 五个组件
- [x] `?ribbon=1` 或顶栏 **Ribbon** 按钮预览
- [x] 四 Tab + 分组布局

**验收**：浏览器可看到 Ribbon 分组与 hover；按钮可 `goToPage`。

### R2 · 接入 AppShell（固定 Ribbon）

- [x] `AppShell` 始终渲染 `RibbonShell` + 顶栏 Tab
- [x] Ribbon 按钮 → `goToPage`；当前页高亮
- [x] 左侧 **28px 快捷栏**（新手指引 / 配置 / 树开关）；移除宽侧栏功能列表
- [x] 移除顶栏 Ribbon 切换与 `?ribbon=1` 预览

**验收**：Ribbon 为唯一功能入口；Tab 工作台与右栏树正常。

### R3 · 体验与引导

- [x] Ribbon **折叠/展开**（▲/▼）；切换功能区 Tab 时若已折叠则自动展开
- [x] 顶栏收拢：模块/工作空间/常用操作迁入 **开始** Ribbon；页面 Tab 对齐 Ribbon 图标
- [x] 左右侧栏独立宽度；同侧树+日志上下分栏拖拽
- [x] 更新 driver.js `data-tour`（Ribbon Tab / 工具条 / 页面 Tab）
- [x] [Web壳层-使用说明.md](../user/Web壳层-使用说明.md) 同步 2026-06 布局
- [x] **页面 Tab**：顶栏居中；当前 Tab 尺寸/动画强调（`WorkbenchTabBar.vue`）
- [ ] 窄屏：Panel 横向滚动

### R4 · 业务页渐进 Element 化（按需）

- [x] **欢迎页 / 主页 / 配置·界面**：`el-button`、`el-link`、`el-tag`、`el-empty`、`el-select`、`el-checkbox`
- [x] **P0 批次**：占位页、`WorksetScopePicker`、`FileWorksetPanel`、Code 批量改名
- [x] **P1 批次**：Code UUID（表单区）、C++ 成员排序、配置主表单
- [ ] **P2 · CAD 中页**：链接修正、STEP 批量、SW 导出、零件去重
- [ ] 可选：`app_config.ribbon` 配置化分组

### 明确不做（本阶段）

- 不拆 Git 双仓
- 不重写 Python 路由
- 不把 Tab 工作台改成 vue-router 多路由
- 不引入 Arco / Ant Design Vue 第二 UI 库

---

## 7. 前后端边界（归档）

| 前端 | 后端 |
| --- | --- |
| Ribbon / Tab / 表格 UI | 扫描、写盘、SQLite、COM |
| `GET/PATCH /api/config/*` | 工作空间路径、`.phoenix/` |
| Pinia / `api.ts` | 单元测试 runner |

---

## 8. 开发命令（不变）

```bash
# 推荐
python -m phoenix.web --dev -w /path/to/workspace

# 前端单独（ rarely needed）
PHOENIX_API_PORT=8765 pnpm -C web-ui dev
```

---

## 9. 参考 Prompt（R1 实现时用）

> 在 `web-ui` 用 Vue3 + Element Plus。新增 `src/layout/ribbon/RibbonShell.vue`：顶部 `el-tabs`（开始/CAD/Code/系统），每 Tab 下 Flex 横排 `RibbonGroup`（组间 1px 竖线、组底居中标题）。组内 `RibbonToolButton`：2px 圆角、icon+文字、hover 浅灰；支持 `large` / `small`。配置来自 `ribbonConfig.ts`，点击 emit `open-page`。`<script setup>` + scoped CSS，不用第三方 Ribbon npm 包。

---

**下一步**：R4 欢迎页 / 主页 / 配置界面区 Element 化；业务页按需迁移。

---

~~**下一步**：完成 R0 收尾（locale + sass + build 绿）→ R1 静态 Ribbon 预览页。~~
