# FreeCAD ↔ Phoenix 收件箱（STEP 批量）

FreeCAD **无官方远程自动化接口**。Phoenix 把工作写到 **`~/.phoenix/freecad_bridge/inbox/<id>_queued.json`**；在 **已打开的 FreeCAD GUI** 里跑一次 **`scripts/freecad_phoenix_inbox_listener.py`**（Qt 定时器轮询），与 **freecadcmd 子进程**走同一 **`freecad_batch_step_fc`** 逻辑。

## 步骤

1. 打开 FreeCAD。  
2. **宏路径**包含本仓库 **`scripts/`**（或拷贝 listener 到个人宏目录）。  
3. 执行 **`freecad_phoenix_inbox_listener.py`**；控制台应有「已启动收件箱监听」。  
4. Phoenix **STEP 批量**勾选 **通过已打开的 FreeCAD**，再运行。

## 注意

仅本机目录；勿多开监听抢同一收件箱。无 PySide2/6 或版本过旧时退回 **freecadcmd**。投递侧需能 `import` **桌面克隆根**（`pip install -e`，与「工作空间根」不同）。
