# STEP 批量导入为 FCStd

在 **FreeCADCmd**（或 FreeCAD Python 会话）中批量 **`step/**/*.stp|.step`** → 输出目录 **`.FCStd`**；**汇总与明细默认写入运行日志**（stderr / 界面日志区），**不**在输出目录生成 `batch_step_convert_report.md`。

## Phoenix「STEP 批量」页

选 **STEP 目录**、**输出目录**（相对工作空间即可）；**配置**页设 **FreeCAD 目录**。调用 **`scripts/freecad_batch_step_runner.py`**。macOS 选 **`/Applications/FreeCAD.app`** 即可。

**收件箱桥接**：页内勾选后在 **已打开的 FreeCAD** 执行一次 **`scripts/freecad_phoenix_inbox_listener.py`**；见 [FreeCAD-Phoenix桥接.md](FreeCAD-Phoenix桥接.md)。偏好存工作空间 **`step_batch`**（当前为 dotfile；目标态 SQLite 见 [Phoenix工作空间存储-规划讨论.md](../platform/Phoenix工作空间存储-规划讨论.md)）。

## 目录

| 层级 | 说明 |
| --- | --- |
| 工作空间根 | 「配置」里选定的项目根，相对路径以此为准 |
| 输入 / 输出 | 页面上任选；常见为工程下 **`step`** 与 **`FreeCAD`** |

## 实现分层

| 模块 | 作用 |
| --- | --- |
| **`phoenix.batch_step`** | 枚举 STEP、Markdown 报告、**`StepBatchJob`**、子进程环境 |
| **`scripts/freecad_batch_step_fc.py`** | 仅在 FreeCAD 内 `import`，Import/Body 等 |
| **`scripts/freecad_batch_step_runner.py`** | 勿用系统 Python；须 **freecadcmd** 调起 |

## `FCD_BATCH_*` 环境变量

| 变量 | 含义 |
| --- | --- |
| `FCD_BATCH_STEP_DIR` / `FCD_BATCH_OUT_DIR` | 输入、输出目录（绝对路径） |
| `FCD_BATCH_SKIP_EXISTING` | `1`：已有同名 `.FCStd` 则跳过 |
| `FCD_BATCH_STEP_RECURSIVE` | `1`：含子文件夹 |
| `FCD_BATCH_VIEW_FIT_LAST` / `FCD_BATCH_VIEW_FIT_ALL` | 会话内视图（CLI 多半无效） |
| `FCD_BATCH_REPORT_NAME` | 可选写盘时的报告文件名（默认 `batch_step_convert_report.md`） |
| `FCD_BATCH_WRITE_REPORT` | `1`：额外在输出目录写入 Markdown 报告文件；默认不写 |
| `FCD_BATCH_PROJECT_TAG` | 报告中的工程标记（可选） |
| `FCD_BATCH_VERBOSE` | `1`：stderr 多打路径 |

Desk Server 与 `scripts/example_run_step_batch.sh` 都以空环境启动 FreeCADCmd，只注入系统运行白名单和上述 `FCD_BATCH_*` 任务变量；当前 Shell 中的令牌、Cookie、代理认证和其它凭据不会继承。STEP 若在子目录需 **`FCD_BATCH_STEP_RECURSIVE=1`**，CLI 需落盘报告时设 **`FCD_BATCH_WRITE_REPORT=1`**。禁止调用 `FreeCAD.app/Contents/MacOS/FreeCAD` GUI launcher；macOS 使用内部 `Contents/Resources/bin/freecadcmd`。日志、异常和 CAD 点检回执会脱敏并限制外部进程输出长度。

## 手写一例

```bash
STEP_DIR="/path/repo/proj/step" \\
OUT_DIR="/path/repo/proj/FreeCAD" \\
FCD_BATCH_SKIP_EXISTING=1 \\
./scripts/example_run_step_batch.sh
```

安全门禁：`pnpm verify:freecad-security`。旧 Python 单元测试仍可用
`python -m unittest discover -s tests -v` 复验 adapter 本身。
