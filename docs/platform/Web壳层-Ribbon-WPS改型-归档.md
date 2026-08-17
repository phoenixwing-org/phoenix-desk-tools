# Web 壳层 · Ribbon WPS 改型 · 会话归档

> 规划：[Web壳层-Ribbon改型-规划.md](Web壳层-Ribbon改型-规划.md)  
> 待办：[TODO.md](../TODO.md) § R3++ · WPS 式 Ribbon 与页脚  
> 最后更新：2026-06-21

---

## 验收总览

| 项 | 状态 |
| --- | --- |
| 分组 Ribbon · WPS 大图标 | ✅ |
| 分组无底部标题（仅竖线） | ✅ |
| 功能区 Tab · 下划线高亮 | ✅ |
| 页脚 VS Code 式面板切换 + tooltip | ✅ |
| 「开始」工作空间 · 大图标 + comb | ✅ |
| 「开始」模块 CAD/Code · 纵向小钮（≤3 行） | ✅ |
| CAD / Code 分组配置整理 | ✅ |
| 单行 Ribbon 布局 | ✅ 未改 |
| `pnpm build` | ✅ |

---

## 视觉与交互

### 分组 Ribbon（默认）

- 所有工具按钮：**图标上、文字下**（`RibbonToolButton` · `layout=stacked` · `size=large`）
- 组间 **竖线分隔**，**无** 底部分组标题（组名仅 `aria-label`）
- 功能区 Tab：**WPS 绿**下划线 + 字色（`--phoenix-wps-accent`）
- 面板高度约 **66px**

### 「开始」Tab 壳层区

| 控件 | 布局 |
| --- | --- |
| 工作空间 | 上大文件夹图标 + 下方 comb（短名 + ▼） |
| 模块 CAD/Code | 纵向小按钮（20px 行高，容器最多 3 行） |
| 树 / 属性 / 日志 / 工作集 / 停靠 | 与页脚共用 `ShellPanelToggleBar`；**全 Tab 可见**，分组/单行样式联动 — 见 [壳层区补全归档](Web壳层-Ribbon壳层区补全-归档.md) |

### 页脚 StatusBar

- 右侧图标栏：`ShellPanelToggleBar` · `variant=footer`
- `el-tooltip` 悬停说明；文案前端静态 → `web-ui/src/content/shellPanelToggles.ts`（**后端 `shell_layout` 不含 tooltip**）
- 侧栏停靠：`el-popover` reference 用 `<span>` 包裹，避免 tooltip 嵌套控制台警告

### 单行模式

- Ribbon 最右侧 **单行/分组** 切换；单行仍为横向紧凑按钮，行为不变

---

## 配置调整（`ribbonConfig.ts`）

| Tab | 变更 |
| --- | --- |
| **Code** | 「忽略设定」并入 **编辑** 组（4 个大图标） |
| **CAD** | 「改名分析」并入 **工具** 组；索引组显式标签「CAD 索引」 |

---

## 主要文件

| 路径 | 说明 |
| --- | --- |
| `web-ui/src/layout/ribbon/RibbonGroup.vue` | 统一大图标横排 |
| `web-ui/src/layout/ribbon/RibbonToolButton.vue` | WPS stacked / inline 样式 |
| `web-ui/src/layout/ribbon/RibbonTabBar.vue` | 下划线 Tab |
| `web-ui/src/layout/ribbon/RibbonWorkspaceSwitcher.vue` | 大图标 + comb |
| `web-ui/src/layout/ribbon/RibbonModuleToggles.vue` | 模块纵向排列 |
| `web-ui/src/components/ShellPanelToggleBar.vue` | Ribbon + 页脚双入口 |
| `web-ui/src/composables/useShellPanelToggles.ts` | 面板 toggle 逻辑 |
| `web-ui/src/content/shellPanelToggles.ts` | tooltip 文案 |

---

## 明确未做（后续可选）

- [ ] `app_config.ribbon` 或 API 下发 Ribbon 分组 / tooltip
- [ ] 窄屏 Ribbon 横向滚动优化（原 R3 遗留）
- [ ] 页脚 tooltip 国际化 / 用户可配

---

**结论**：壳层 Ribbon 与页脚面板切换已对齐 WPS / VS Code 习惯用法；单行模式保留作紧凑备选。
