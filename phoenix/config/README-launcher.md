# 启动器配置（launcher）

## 本机路径（当前实现）

| 平台 | `launcher.json` |
| --- | --- |
| **macOS** | `~/Library/Application Support/phoenix-wing/phoenix/launcher.json` |
| **Windows** | `%LOCALAPPDATA%\phoenix-wing\phoenix\launcher.json` |
| **Linux** | `~/.config/phoenix-wing/phoenix/launcher.json` |

`phoenix-wing` 与 Gitee 组织 **PhoenixWing321** / 仓库 **phoenix-freecad-desktop** 对应；与 **源码 clone 路径无关**。字段示例见 `web-ui/config/launcher.json.example`。

## 迁移来源（首次启动 / 配置页合并时）

按顺序合并写入上表路径：

1. `phoenix/config/workspace.custom.json`（桌面壳旧路径；包名曾为 `fcdesk/`）
2. `web-ui/.local/launcher.json`（旧 Web 样例路径，**不再写入**）
3. 旧版 `…/phoenix-wing/fcdesk/launcher.json`、单层 `…/fcdesk/launcher.json`（**不再写入**）
4. 已有 `…/phoenix-wing/phoenix/launcher.json`

旧文件**不自动删除**；确认迁移成功后可自行清理。

## 覆盖

| 变量 | 含义 |
| --- | --- |
| `PHOENIX_LAUNCHER_CONFIG` | 指定 launcher JSON 绝对路径（`PHOENIX_LAUNCHER_CONFIG` 仍兼容） |

## 内容

| 键 | 用途 |
| --- | --- |
| `recent_workspaces` | 最近工作空间根 |
| `freecad_dir` | FreeCAD 安装目录 |
| `window_geometry` | 桌面壳窗口（Tk） |
| `shell_layout` | Web / 桌面壳侧栏布局 |

各功能页偏好（STEP 目录、XLink 等）在 **工作空间** `.phoenix/phoenix-freecad-desktop.json`，不在 launcher 里。

详见 [doc/启动器配置路径-规划讨论.md](../../doc/启动器配置路径-规划讨论.md)。
