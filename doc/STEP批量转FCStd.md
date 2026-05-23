# STEP 批量导入为 FCStd

在 **FreeCADCmd**（或带 Python 的 FreeCAD 会话）中运行批量脚本，将 **`step` 目录下的 `.stp`/`.step`** 转为 **输出目录** 中的 **`.FCStd`**，并生成 Markdown 报告。

## 桌面「STEP 批量」页

已在主界面 **导航 → STEP 批量** 中接入：填写 **STEP 目录** 与 **输出目录**（或填写 **工程相对路径** 后点 **套用约定**），并在 **导航 → 配置** 中设置 **FreeCAD 目录**，即可通过子进程调用 **命令行批次解释器**（macOS dmg 常为 `FreeCAD.app/Contents/Resources/bin/freecadcmd`，旧版偶有 `Contents/MacOS/FreeCADCmd`）执行 `scripts/freecad_batch_step_runner.py`。

**macOS：** 在 **配置** 页中选 **`/Applications/FreeCAD.app`**（整个 App 文件夹）即可，程序会自动在 **`Contents/Resources/bin/freecadcmd`** 下查找。

**桥接（类似「连着已开的 CAD」）**：在页面勾选 **通过已打开的 FreeCAD**，并先在 FreeCAD 里执行一次 **`scripts/freecad_fcdesk_inbox_listener.py`** 启动收件箱监听；说明见 **`doc/FreeCAD-fcdesk桥接.md`**（此模式**不要求**再走 freecadcmd 子进程）。
偏好保存在 `fcdesk/config/workspace.custom.json` 的 **`step_batch`** 小节。

## 目录约定（与数据仓库对齐）

| 层级 | 说明 |
| --- | --- |
| 工作空间根（配置页） | 桌面壳中选定的项目根，`Sample…/step` 等相对路径以此为基准 |
| `{工程}/{step}` | STEP 来源目录 |
| `{工程}/FreeCAD` | 输出的 `.FCStd` 目录（可改为任意输出目录输入框）。 |

桌面页中的「工程相对路径」即 `{工程}`，`step`/`FreeCAD` 子路径固定。

## 纯算法模块（可被测试与共用）

- **`fcdesk.batch_step`**：STEP 文件名解析、`iter_step_paths` / 递归枚举、Markdown 报告、**`StepBatchJob`**（含传给子进程的环境变量）。
- **`scripts/freecad_batch_step_fc.py`**：仅在 **FreeCAD Python** 内 `import`，负责 `Import.insert`、PartDesign Body 等内核 API。

命令行入口使用 **`scripts/freecad_batch_step_runner.py`**（勿用系统 `python` 直接运行，须由 **FreeCADCmd** 执行）。

## 环境变量（与子进程/UI 对齐）

以下为 **`StepBatchJob.subprocess_env()`** / **runner** 所读取的键：

| 变量 | 含义 |
| --- | --- |
| `FCD_BATCH_STEP_DIR` | STEP 输入目录绝对路径 |
| `FCD_BATCH_OUT_DIR` | FCStd 输出目录绝对路径 |
| `FCD_BATCH_SKIP_EXISTING` | `1` / `true`：目标同名 `.FCStd` 已存在则跳过 |
| `FCD_BATCH_VIEW_FIT_LAST` | `1`：仅最后一个文件在会话内尝试「等轴测 + ViewFit」（需带 GUI 的 FreeCAD；纯 FreeCADCmd 通常无效果） |
| `FCD_BATCH_VIEW_FIT_ALL` | `1`：每个文件都尝试（与上一项互斥时以「全部」为准） |
| `FCD_BATCH_REPORT_NAME` | 报告文件名，默认 `batch_step_convert_report.md` |
| `FCD_BATCH_PROJECT_TAG` | 写入报告的工程标识（如 `Sample2TA002`，可选）。 |
| `FCD_BATCH_STEP_RECURSIVE` | `1`：**递归**遍历子文件夹中的 `.stp`/`.step`（默认仅当前目录第一层） |
| `FCD_BATCH_VERBOSE` | `1`：stderr 列出前若干个待处理 STEP 的完整路径 |

### 常见问题：没有生成任何 `.FCStd`

1. **FreeCADCmd 未执行脚本主体**：较早若入口写在 `if __name__ == "__main__"` 下，在某些加载方式里 `main()` 不会运行。当前 `freecad_batch_step_runner.py` 在载入末尾**无条件**调用 `main()`；请更新桌面工具源码后再跑。
2. **STEP 在子目录里**：批量默认只看 **输入目录顶一层**。若 STEP 仅在子文件夹，请 **`export FCD_BATCH_STEP_RECURSIVE=1`**，或在桌面「STEP 批量」勾选 **包含子文件夹中的 STEP**。
3. **全部为「跳过」**：`FCD_BATCH_SKIP_EXISTING=1` 且输出目录里已有同名 `.FCStd`。查报告 `batch_step_convert_report.md`。
4. **终端看不到日志**：可加 `export FCD_BATCH_VERBOSE=1`；成功/跳过/失败行也会写到 **stderr**（与 FreeCAD Console 并重）。

手写调用示例（**一定要先 `export`**，否则 `freecadcmd` **看不到**变量，不会产生任何输出文件）：

```bash
export FCD_BATCH_STEP_DIR="/path/repo/Sample2TA/step"
export FCD_BATCH_OUT_DIR="/path/repo/Sample2TA/FreeCAD"
export FCD_BATCH_SKIP_EXISTING=1
# 若 STEP 只在子文件夹里：export FCD_BATCH_STEP_RECURSIVE=1
# 更详细的 stderr 列表：export FCD_BATCH_VERBOSE=1
# macOS dmg 常为 freecadcmd，少数为 FreeCADCmd
/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd \\
  /path/repo/scripts/freecad_batch_step_runner.py
```

也可拷贝编辑 **`scripts/example_run_step_batch.sh`**；纯算法单测在项目根：`python -m unittest discover -s tests -v`。

## 与旧 `temp/`、`ABC_BATCH_*` 的关系

早前实验脚本与 **`ABC_BATCH_*`** / 硬编码 `Sample2TAxxx` 入口已收口为 **`fcdesk.batch_step`** + **`FCD_BATCH_*`**。若你仍有本地 **`temp/`** 副本，仅以备份参考；请以本仓库 **`scripts/freecad_batch_step_fc.py`** 为准。
