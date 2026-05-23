# FreeCAD BOM（材料清单）管理工具

> 文档索引：[文档索引.md](文档索引.md)

本目录包含用于在 FreeCAD 中创建和管理 BOM（材料清单）的 Python 脚本（代码在上一级 `python/`）。

## 文件说明

### 1. `initial_bom_attributes.py` - BOM属性初始化工具
为零件对象添加BOM自定义属性的独立模块：
- **is_part_object()**: 判断对象是否是有效的零件对象
- **add_custom_properties()**: 为单个零件对象添加BOM属性
- **batch_add_bom_attributes()**: 批量为所有零件对象添加BOM属性
- **add_bom_attributes_to_selection()**: 为选中的对象添加BOM属性

### 2. `bom_generator.py` - BOM生成器核心模块
提供BOM生成的核心功能：
- **BomGenerator类**：智能BOM生成器
  - `add_custom_properties()`: 为对象添加自定义BOM属性
  - `generate_bom()`: 生成BOM数据
  - `export_to_spreadsheet()`: 导出到电子表格
  - `calculate_weight()`: 计算零件重量
  - `detect_part_type()`: 自动检测零件类型

- **主要函数**：
  - `batch_set_part_properties()`: 批量设置零件属性
  - `create_bom_sheet()`: 创建BOM电子表格

### 3. `bom_techdraw.py` - TechDraw BOM表工具
在TechDraw工程图中创建BOM表：
- `create_bom_drawing()`: 创建带BOM的工程图
- `create_bom_drawing_with_template()`: 使用指定模板创建BOM工程图

### 4. `bom_batch_manager.py` - 批量管理工具
提供批量操作功能：
- `batch_set_part_properties_by_type()`: 根据特征批量设置零件类型
- `batch_set_part_numbers()`: 批量设置零件号
- `batch_set_material()`: 批量设置材料
- `batch_set_version()`: 批量设置版本号
- `update_bom_sheet()`: 更新BOM电子表格
- `export_bom_to_csv()`: 导出BOM到CSV文件
- `apply_bom_template_to_selection()`: 为选中对象应用BOM模板

## 使用方法

### 在FreeCAD中使用

1. **打开FreeCAD宏编辑器**：
   - 菜单：`宏` → `宏...` → `创建`
   - 或者直接打开Python控制台

2. **导入模块**：
```python
import sys
sys.path.append('/path/to/phoenix-freecad-desktop')

# 方式1：使用独立的属性初始化模块
from initial_bom_attributes import batch_add_bom_attributes, add_bom_attributes_to_selection

# 方式2：使用BOM生成器（内部会调用属性初始化）
from bom_generator import batch_set_part_properties, create_bom_sheet
from bom_batch_manager import batch_set_part_numbers, export_bom_to_csv
from bom_techdraw import create_bom_drawing
```

3. **基本使用流程**：

```python
# 方式1：使用独立的属性初始化模块
from initial_bom_attributes import batch_add_bom_attributes
batch_add_bom_attributes()  # 只添加属性，不设置默认值

# 方式2：使用BOM生成器（推荐，会添加属性并设置默认值）
from bom_generator import batch_set_part_properties, create_bom_sheet
batch_set_part_properties()  # 添加属性并设置默认值

# 步骤2：创建BOM电子表格（标准格式）
create_bom_sheet()

# 或者创建简单格式的BOM表（Index, Name, Description, File Name, Quantity）
create_bom_sheet(format_type="simple")

# 步骤3：在TechDraw中创建BOM表（可选）
from bom_techdraw import create_bom_drawing
create_bom_drawing()
```

### 高级用法

#### 批量设置零件号
```python
from bom_batch_manager import batch_set_part_numbers
batch_set_part_numbers(prefix="PN", start_index=1)
```

#### 批量设置材料
```python
from bom_batch_manager import batch_set_material
batch_set_material("Q235", part_type_filter="H")  # H=一般件, S=标准件, R=参考件
```

#### 导出BOM到CSV
```python
from bom_batch_manager import export_bom_to_csv

# 标准格式
export_bom_to_csv(file_path="/path/to/output.csv", format_type="standard")

# 简单格式（Index, Name, Description, File Name, Quantity）
export_bom_to_csv(file_path="/path/to/output.csv", format_type="simple")
```

#### 为选中对象应用BOM模板
```python
# 方式1：使用独立的属性初始化模块
from initial_bom_attributes import add_bom_attributes_to_selection
# 先在FreeCAD中选择对象，然后运行
add_bom_attributes_to_selection()

# 方式2：使用批量管理工具
from bom_batch_manager import apply_bom_template_to_selection
apply_bom_template_to_selection()
```

## BOM格式说明

### 简单格式（Simple Format）
包含基本列，适用于标准BOM表：
- **Index**: 序号
- **Name**: 零件名称
- **Description**: 描述
- **File Name**: 文件路径（如果是链接的外部文件，显示源文件路径）
- **Quantity**: 数量

### 标准格式（Standard Format）
包含完整的BOM信息：
- 序号、零件号、零件名、版本、类型、数量、材料、体积、重量、图号、供应商、状态、描述

## BOM属性说明

**重要**：BOM属性只添加到**零件对象**（有Shape且有体积的对象）上，不会添加到文档级别、电子表格、页面等其他对象。

每个零件对象可以包含以下BOM属性：

| 属性名 | 类型 | 说明 | 默认值 |
|--------|------|------|--------|
| PartNumber | 字符串 | 零件号 | PN-{Label} |
| PartName | 字符串 | 零件名 | Label |
| PartVersion | 字符串 | 零件版本 | 01.00 |
| PartType | 枚举 | 零件类型 | H |
| Material | 字符串 | 材料 | 未指定 |
| Supplier | 字符串 | 供应商 | - |
| Cost | 浮点数 | 成本 | 0.0 |
| DrawingNumber | 字符串 | 图号 | - |
| Description | 字符串 | 描述 | - |
| Status | 枚举 | 状态 | 设计中 |

### 零件类型选项
- **H** - 一般件（默认）
- **S** - 标准件
- **R** - 参考件

### 状态选项
- 设计中
- 已发布
- 已停产
- 待审核

## 材料密度表

系统内置了常用材料的密度（kg/m³）：

| 材料 | 密度 |
|------|------|
| Q235 | 7850 |
| 45# | 7850 |
| 304 | 7930 |
| 316 | 8000 |
| 6061 | 2700 |
| 7075 | 2810 |
| 塑料 | 1200 |
| ABS | 1050 |
| PC | 1200 |
| POM | 1410 |

## 工作流程建议

1. **初始化阶段**：
   - 运行 `batch_set_part_properties()` 为所有零件添加BOM属性
   - 运行 `batch_set_part_numbers()` 批量设置零件号

2. **设计阶段**：
   - 手动设置每个零件的材料、图号等属性
   - 使用 `apply_bom_template_to_selection()` 为新建零件快速添加属性

3. **生成BOM**：
   - 运行 `create_bom_sheet(format_type="simple")` 生成简单格式BOM表
   - 或运行 `create_bom_sheet()` 生成标准格式BOM表
   - 运行 `create_bom_drawing()` 在工程图中创建BOM表

4. **导出和分享**：
   - 运行 `export_bom_to_csv(format_type="simple")` 导出简单格式CSV
   - 或运行 `export_bom_to_csv()` 导出标准格式CSV
   - 在FreeCAD中打开电子表格，可以进一步编辑和格式化

## 注意事项

1. **文件路径**：确保在FreeCAD中正确设置Python路径，指向 `python` 目录
2. **文档要求**：使用前请确保已打开FreeCAD文档
3. **对象选择**：某些功能需要先选择对象
4. **模板路径**：TechDraw模板路径可能需要根据FreeCAD安装位置调整
5. **属性位置**：BOM属性只添加到零件对象（有Shape且有体积的对象）上，不会添加到文档级别或其他对象类型（如电子表格、页面等）

## 扩展开发

如需添加新的BOM属性或功能，可以：

1. 在 `BomGenerator.add_custom_properties()` 中添加新属性
2. 在 `BomGenerator.generate_bom()` 中添加新字段
3. 在 `BomGenerator.export_to_spreadsheet()` 中添加新列

## 示例脚本

创建一个完整的BOM工作流程：

```python
import sys
sys.path.append('/path/to/phoenix-freecad-desktop')

from bom_generator import batch_set_part_properties, create_bom_sheet
from bom_batch_manager import batch_set_part_numbers, export_bom_to_csv
from bom_techdraw import create_bom_drawing

# 完整工作流程
print("开始BOM生成流程...")

# 1. 批量设置属性
print("步骤1：设置零件属性...")
batch_set_part_properties()

# 2. 设置零件号
print("步骤2：设置零件号...")
batch_set_part_numbers(prefix="PN", start_index=1)

# 3. 创建BOM表
print("步骤3：创建BOM电子表格...")
create_bom_sheet()

# 4. 创建工程图（可选）
print("步骤4：创建BOM工程图...")
create_bom_drawing()

# 5. 导出CSV（可选）
print("步骤5：导出CSV...")
export_bom_to_csv()

print("BOM生成完成！")
```

## 故障排除

**问题**：找不到模块
- **解决**：检查Python路径是否正确设置

**问题**：电子表格为空
- **解决**：确保文档中有包含Shape的对象

**问题**：TechDraw模板无法加载
- **解决**：手动指定模板路径，或使用 `create_bom_drawing_with_template()` 函数

## 更新日志

- 2026-01-26: 初始版本，包含基本BOM生成和管理功能
