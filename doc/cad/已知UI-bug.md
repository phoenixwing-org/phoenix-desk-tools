# 已知 UI Bug

> tauri 分支预存问题，非本次引入。

## 1. Ribbon utils 按钮无法靠右

- **现象**：CAD tab 右侧工具按钮（工作空间树、运行日志、侧栏）未紧贴右边缘
- **排查**：spacer `flex:1` 被 `.ribbon-group-body { flex:1 }` 抢占空间，但去掉后仍未解决
- **状态**：待修

## 2. （已修）布局切换按钮重复

- **修复**：删除 RibbonPanel 内重复的 `ribbon-layout-toggle`，统一由 PnwRibbonShell 管理

## 3. （已修）树点击 FCStd 跳到旧页面

- **修复**：`_fallbackOpenFile` → `goToPage(cad_bom_viewer)`
