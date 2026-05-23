# FreeCAD GUI ↔ fcdesk 收件箱桥接

FreeCAD **没有**类似 SolidWorks COM / CATIA Automation 的官方远程接口。fcdesk 提供 **本地收件箱桥接**：桌面把任务写成 `~/.fcdesk/freecad_bridge/inbox/<id>_queued.json`，**已打开**的 FreeCAD 里跑一个 **Qt 定时器宏**（主线程轮询），在同一进程内执行 STEP 批量逻辑。

## 你要做的

1. 正常 **打开 FreeCAD**（带界面）。
2. **宏** → 在「宏路径」中加入本仓库的 **`scripts/`**（或把 `freecad_fcdesk_inbox_listener.py` 拷到个人宏目录）。
3. **执行一次** `scripts/freecad_fcdesk_inbox_listener.py`（底部会自动 `start()`）。报告区应出现  
   `[fcdesk 桥接] 已启动收件箱监听…`
4. 回到 fcdesk **STEP 批量** 页，勾选 **通过已打开的 FreeCAD（fcdesk 收件箱桥接）**，再点 **运行 STEP 批量**。

## 与 freecadcmd 子进程的区别

| 方式 | 说明 |
| --- | --- |
| 子进程 `freecadcmd` | 不必开 FreeCAD 窗口；需在 **配置** 页选对 FreeCAD 安装目录。 |
| 收件箱桥接 | 必须在 **已启动的 FreeCAD GUI** 里跑过监听宏；适合习惯「先开 CAD 再干活」的流程。 |

两种方式的 **转换与报告逻辑相同**（`freecad_batch_step_fc.run_step_batch_from_environ`）。

## 安全与局限

- 仅使用本机目录，**无网络、无鉴权**；勿把 `~/.fcdesk/freecad_bridge` 暴露到共享盘。
- 监听按固定间隔轮询，**不要**同时开两个 FreeCAD 都跑监听（会抢同一收件箱）。
- 若 FreeCAD 版本过旧、无 PySide2/PySide6，监听无法启动，请仍用 **freecadcmd** 方式。

## 故障：fcdesk 一直「超时未收到回信」

- 确认 FreeCAD 未崩溃，且宏已执行、控制台有「已启动收件箱监听」。
- 确认 **`fcdesk`** 已通过 `pip install -e …/phoenix-freecad-desktop` 或 `PYTHONPATH` 指向桌面工具克隆根；fcdesk「桥接投递」发往 FreeCAD 的仍是 **桌面工具仓库根**（内含 `fcdesk/`、`scripts/`），与「配置」中选定的工作空间根（如工程数据 **`ABC-Sample`**）是两回事。
