# Web 壳层 · Ribbon 壳层区补全 · 会话归档

> 前置：[Web壳层-Ribbon-WPS改型-归档.md](Web壳层-Ribbon-WPS改型-归档.md)  
> 规划：[Web壳层-Ribbon改型-规划.md](Web壳层-Ribbon改型-规划.md)  
> 待办：[TODO.md](../TODO.md) § R3++ · WPS 式 Ribbon 与页脚  
> 最后更新：2026-06-19

---

## 验收总览

| 项 | 状态 |
| --- | --- |
| `RIBBON_SHELL_TAB_ID` 运行时未定义修复 | ✅ |
| 壳层按钮 **所有 Ribbon Tab** 可见 | ✅ |
| 分组 / 单行布局 **壳层区样式联动** | ✅ |
| `pnpm build` | ✅ |

---

## 问题与修复

### 1. Ribbon 整块不渲染

**现象**：控制台 `ReferenceError: RIBBON_SHELL_TAB_ID is not defined`（`RibbonPanel.vue:59`），Ribbon 面板空白。

**原因**：`RIBBON_SHELL_TAB_ID` 误写在 `import type { ... }` 中，编译后运行时符号被剥离。

**修复**：改为值导入：

```ts
import { RIBBON_SHELL_TAB_ID, type RibbonGroupDef, type RibbonTabDef } from "./ribbonConfig";
```

### 2. 壳层按钮仅「系统」Tab 可见

**原行为**：`ribbon-panel-utils` 包在 `v-if="isShellTab"` 内，切到 CAD / Code 时无法从 Ribbon 打开树 / 属性 / 日志等。

**现行为**：**所有功能区 Tab** 的 Ribbon 右侧均显示壳层区（工作空间 comb、模块纵排仍仅 **系统** Tab）。

### 3. 单行 / 分组切换时壳层样式不跟

**原行为**：`ShellPanelToggleBar` · `variant=ribbon` 始终为横向紧凑钮（图标左、文字右），与分组大图标 Ribbon 不一致。

**现行为**：

| Ribbon 布局 | 壳层按钮样式 |
| --- | --- |
| **分组**（默认） | 复用 `RibbonToolButton` · `size=large` · `layout=stacked`；左侧组间竖线 |
| **单行** | 原 `ribbon-util-btn` 横向紧凑 |

`RibbonPanel` → `RibbonPanelUtils` → `ShellPanelToggleBar` 传递 `layout: "group" | "inline"`。

---

## 主要改动文件

| 路径 | 说明 |
| --- | --- |
| `web-ui/src/layout/ribbon/RibbonPanel.vue` | 修复 import；壳层区全 Tab；传 `layout` |
| `web-ui/src/layout/ribbon/RibbonPanelUtils.vue` | 接收并转发 `layout` |
| `web-ui/src/components/ShellPanelToggleBar.vue` | `layout` prop；分组用 `RibbonToolButton` |

---

## 行为说明（与页脚关系）

- **页脚** `StatusBar`：`ShellPanelToggleBar` · `variant=footer`（VS Code 式纯图标 + tooltip），**不变**。
- **Ribbon 右侧**：`variant=ribbon` + `layout` 联动；与页脚共用 `useShellPanelToggles`，状态同步。
- 侧栏停靠 Popover：分组模式下 reference 用 `<span class="ribbon-util-ref">` 包裹 `RibbonToolButton`，避免与 Popover 冲突。

---

## 明确未做

- [ ] 窄屏 Ribbon 横向滚动优化（原 R3 遗留）
- [ ] `app_config.ribbon` 或 API 下发分组 / tooltip

---

**结论**：Ribbon 壳层区与 WPS 分组视觉对齐，且在全 Tab 与单行/分组切换下行为一致；页脚仍为紧凑图标入口。
