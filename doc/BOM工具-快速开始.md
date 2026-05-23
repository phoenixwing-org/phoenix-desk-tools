# FreeCAD BOM 工具 — 快速开始

> **`bom_generator` 等演示脚本**：若默认分支不包含这些文件，请使用本地归档目录 **`temp/`** 或自备实现；下文中的 `/path/to/phoenix-freecad-desktop` 请改成你的克隆根路径。

> 文档索引：[文档索引.md](文档索引.md)

## 重要说明

**FreeCAD不是Python包，不需要通过pip安装！**

FreeCAD是一个独立的应用程序，内置了Python解释器。这些脚本是在FreeCAD内部的Python环境中运行的。

## 安装FreeCAD

### macOS

从官网下载安装：https://www.freecad.org/downloads.php

### Windows
从官网下载安装程序：
https://www.freecad.org/downloads.php

### Linux
```bash
# Ubuntu/Debian
sudo apt-get install freecad

# Fedora
sudo dnf install freecad
```

## 使用方法

### 方法1：在FreeCAD Python控制台中运行

1. **打开FreeCAD应用程序**

2. **打开Python控制台**：
   - 菜单：`视图` → `面板` → `Python控制台`
   - 或使用快捷键（根据系统不同）

3. **在Python控制台中输入**：
```python
import sys
sys.path.append('/path/to/phoenix-freecad-desktop')

from bom_generator import batch_set_part_properties, create_bom_sheet

# 批量设置零件属性
batch_set_part_properties()

# 创建BOM表（简单格式）
create_bom_sheet(format_type="simple")
```

### 方法2：创建FreeCAD宏

1. **打开FreeCAD宏编辑器**：
   - 菜单：`宏` → `宏...` → `创建`

2. **创建新宏**，将以下代码粘贴进去：
```python
import sys
sys.path.append('/path/to/phoenix-freecad-desktop')

from bom_generator import batch_set_part_properties, create_bom_sheet
from bom_batch_manager import export_bom_to_csv

# 完整工作流程
print("开始BOM生成流程...")

# 1. 批量设置属性
print("步骤1：设置零件属性...")
batch_set_part_properties()

# 2. 创建BOM表
print("步骤2：创建BOM电子表格...")
create_bom_sheet(format_type="simple")

# 3. 导出CSV
print("步骤3：导出CSV...")
export_bom_to_csv(format_type="simple")

print("BOM生成完成！")
```

3. **保存宏**（例如：`BOM_Generator.FCMacro`）

4. **运行宏**：
   - 菜单：`宏` → `宏...` → 选择你的宏 → `执行`

### 方法3：在FreeCAD中直接执行Python脚本

1. **打开FreeCAD**

2. **打开Python控制台**

3. **执行脚本文件**（推荐方式）：
```python
# 方式1：使用execfile（如果可用）
execfile('/path/to/phoenix-freecad-desktop/temp/example_simple_bom.py')

# 方式2：使用exec（需要先设置路径）
import sys
sys.path.append('/path/to/phoenix-freecad-desktop')
exec(open('/path/to/phoenix-freecad-desktop/temp/example_simple_bom.py').read())
exec(open('/path/to/phoenix-freecad-desktop/temp/initial_bom_attributes.py').read())

# 方式3：直接导入并调用函数（推荐）
import sys
sys.path.append('/path/to/phoenix-freecad-desktop')
from example_simple_bom import complete_simple_bom_workflow
complete_simple_bom_workflow()
```

## 验证安装

在FreeCAD Python控制台中运行：
```python
import FreeCAD as App
print(f"FreeCAD版本: {App.Version()}")
print("FreeCAD已正确安装！")
```

如果看到版本号，说明FreeCAD正常工作。

## 下一步

1. 安装FreeCAD（如果还没有）
2. 打开FreeCAD并创建一个测试文档
3. 在Python控制台中运行示例代码
4. 查看生成的BOM表

## 参考

- FreeCAD官网：https://www.freecad.org/
- FreeCAD Python API文档：https://wiki.freecad.org/Python_scripting_tutorial
- 本工具完整文档：[BOM工具说明.md](BOM工具说明.md)
