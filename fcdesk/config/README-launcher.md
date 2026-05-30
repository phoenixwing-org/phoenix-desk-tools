# 启动器配置（launcher）

| 用途 | 路径 |
| --- | --- |
| **Web / 主路径** | `web-ui/.local/launcher.json`（gitignore，见 `web-ui/config/launcher.json.example`） |
| **桌面壳旧路径（兼容）** | `fcdesk/config/workspace.custom.json`（本机，见 `workspace.custom.json.example`） |

Web 启动或打开「配置」页时会自动把旧文件中的 **最近工作空间**、`freecad_dir` 等合并进 `web-ui/.local/launcher.json`。

各功能页偏好（STEP 目录、XLink 选项等）仍在 **工作空间根** 的 `.phoenix-freecad-desktop.json`，不在 launcher 里。
