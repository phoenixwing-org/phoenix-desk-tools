# 变更日志

本文件记录 Phoenix Desk Tools 的用户可见变化。版本号遵循语义化版本；发布制品、平台门禁与已知缺口见对应版本的发布说明。

## 0.4.0 — 2026-08-17

### 新增

- 接入 Phoenix Wing 0.7.0 工作台：无工作空间时显示全屏 Welcome，打开工作空间后进入普通 Workbench Home。
- 新增工作空间打开、最近使用、返回 Welcome、关闭工作空间与刷新恢复流程；关闭工作空间后 required Gate 不再进入工作台。
- Welcome 新增“项目与运行方式”和“贡献与维护”信息区，最近使用与两个信息区采用统一可折叠 Block；贡献内容由 JSON DTO 驱动，可继续追加卡片。
- 支持 light、dark 与跟随系统三种主题；统一凤凰之翼标志、favicon、主题切换动画和确认对话框。
- 接入 Wing Dockable Tool、Primary、中央 View、Properties 与 Bottom Panel 工作台能力。

### 调整

- Web 与 Tauri 统一发现并复用单一 Desk API；API 未运行时由当前宿主启动，避免重复后台竞争。
- FCStd 文件发现、ZIP/XML 读取、SQLite 查询与 BOM/XLink 处理由 TypeScript 承担；Tauri Rust 收敛为桌面窗口和 Node sidecar 生命周期薄壳。
- KT Codegen 的共享算法、状态契约和 Web UI 继续下沉至 Phoenix Wing；VS Code 专有能力留在 KT Auto Code，CAD 与本地宿主能力留在 Desk Tools。
- 文档目录统一为 `docs/`，更新 Phoenix Wing 组织、仓库、安装和贡献链接。

### 修复

- 修复异步 View 首次打开时的白屏闪烁、工作台底部面板注入、Vite 本地 Wing 缓存隔离及 Tauri 本地端口探测问题。
- 修复 Welcome 关闭工作空间后的巡游入口、主题根、首次主题切换动画圆心及明暗主题高亮配色。

### 依赖与兼容性

- Registry 精确依赖 `phoenix-wing@0.7.0`；Desk 直接使用的稳定 `@phoenix-wing/*` 包保持 `0.6.3`。
- 本地 Wing 联调继续通过并列 `../phoenix-wing` 源码 resolver，不使用 `link:`、`file:`、`workspace:` 或 override。
- macOS arm64 未签名 Tauri `.app` 已通过真实启动、Codegen、FCStd、正常退出和 sidecar 回收门禁。
- Windows 0.4.0 NSIS 的真实构建、安装、代表工作流、卸载与回执仍需在 Windows runner 完成；代码签名前发布说明必须明确制品未签名。

