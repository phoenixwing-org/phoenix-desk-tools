# FreeCAD BOM 宏 — 轻量 Python 界面

## 背景

参考 [FreeCAD-BOM-Macro](https://github.com/compoundcad/FreeCAD-BOM-Macro)，它用 PySide2 做 UI，太重。
需要一版用 Python 自带 tkinter 的轻量 BOM 宏，放到 phoenix-desk-tools 的 `phoenix/freecad/` 模块里。

## 目标

在 FreeCAD 里跑一个 BOM 宏，遍历当前文档的对象树，提取 BOM 数据，用 tkinter 显示表格，支持搜索和 CSV 导出。

## 文件结构

```
phoenix/freecad/bom_macro/        # 新增包
  __init__.py                     # 导出 BomItem, BomResult, compute_bom, run_bom_macro
  bom_data.py                     # 纯数据逻辑：遍历文档 → BOM 数据（不依赖 UI）
  bom_ui.py                       # tkinter 界面：表格、搜索、导出
  bom_macro.py                    # 入口：在 FreeCAD 宏里调用，串联数据 + UI

tests/
  test_bom_macro_data.py          # 单元测试（mock FreeCAD 对象）

phoenix/freecad/__init__.py       # 修改：增加 run_bom_macro 导出
```

## 数据模型

```python
# bom_data.py

VALID_OBJECT_TYPES = {"Part::Feature", "App::Part", "App::LinkGroup"}

@dataclass(frozen=True)
class BomItem:
    type: str          # "Assembly" | "Part"
    name: str          # FreeCAD 内部名
    label: str         # 用户标签
    quantity: int      # 聚合后的数量（修正原版 bug）
    material: str      # 材料或 "N/A"
    level: int         # 嵌套层级

@dataclass
class BomResult:
    items: list[BomItem]
    document_name: str
    total_unique_items: int
    total_quantity_sum: int
```

## 核心逻辑（bom_data.py）

1. **`_is_valid_item(obj)`** — 检查 `obj.TypeId` 是否在白名单
2. **`_traverse_objects(obj, level, bom_map, visited)`** — 递归遍历 `OutList`，带 visited 防循环引用
3. **`_aggregate_quantities(bom_map)`** — 按 `(name, label, level)` 分组统计数量
4. **`compute_bom(doc)`** — 主入口，找到顶层对象（无父对象），遍历聚合，返回 `BomResult`

### 修正原版「数量总是 1」的 bug

原版 `populate_table` 里用 `bom_data.count(item)` 按 dict 引用计数，每个 item 都是独立 dict，所以永远返回 1。

新版做法：
- 遍历时用 `dict[(name, label, level)] → count` 累计
- 相同零件在相同层级只出现一次，数量正确

## tkinter 界面（bom_ui.py）

只用 `tkinter` + `tkinter.ttk`，不需要任何第三方库。

### 布局

```
+----------------------------------------------------------+
| BOM - [文档名]                                            |
+----------------------------------------------------------+
| 搜索: [________]  字段: [Type v]  [3 items match]        |
+----------------------------------------------------------+
| Type   | Name      | Label       | Qty | Material | Lvl  |
+--------+-----------+-------------+-----+----------+------+
| Assem  | Root      | Root Assy   |  1  | N/A      |  0   |
| Part   | Bracket_L | LH Bracket  |  2  | Steel    |  1   |
| Part   | Screw_M6  | M6 Screw    |  8  | Steel    |  2   |
| ...                                                       |
+----------------------------------------------------------+
| [导出 CSV]  [关闭]        共 12 种 / 总数量 45            |
+----------------------------------------------------------+
```

### 功能清单

| 功能 | 实现 | 说明 |
|------|------|------|
| BOM 表格 | `ttk.Treeview` | 支持排序（点列头切换升/降序） |
| 搜索过滤 | `ttk.Entry` + `ttk.Combobox` | 实时过滤，选字段，显示匹配数 |
| CSV 导出 | `csv.DictWriter` + `filedialog` | UTF-8，弹窗选保存路径 |
| 双向选择同步 | FreeCAD SelectionObserver | 点 BOM 行→选中 FreeCAD 对象；选对象→高亮 BOM 行 |

### 事件循环集成

FreeCAD 跑 Qt 事件循环。tkinter 窗口在宏里用 `root.mainloop()` 阻塞运行，FreeCAD 的 Qt 循环在宏执行期间挂起，这是标准宏行为，不冲突。

备选方案：如遇兼容问题，改用 `root.update()` + Qt timer。

## 不做的功能（保持轻量）

对比原版宏：

| 功能 | 原版 | 新版 | 理由 |
|------|------|------|------|
| 列管理对话框 | ✅ | ❌ | 过于复杂，固定 6 列足够 |
| 列拖拽排序 | ✅ | ❌ | 非必需 |
| 右键菜单（复制/清除） | ✅ | ❌ | 可用 Ctrl+C 代替 |
| 高级搜索对话框 | ✅ 定义了但没用 | ❌ | 本来就没在用 |
| 窗口尺寸限制 | ✅ min 600 max 1000 | ❌ | tkinter 自动适配 |

## 入口（bom_macro.py）

```python
def run_bom_macro():
    """在 FreeCAD 宏中调用。"""
    try:
        import FreeCAD
        doc = FreeCAD.ActiveDocument
        if doc is None:
            FreeCAD.Console.PrintError("BOM: 没有打开的文档。\n")
            return
        result = compute_bom(doc)
        if not result.items:
            FreeCAD.Console.PrintMessage("BOM: 文档中没有有效零件。\n")
            return
        show_bom_ui(result)
    except Exception as e:
        FreeCAD.Console.PrintError(f"BOM 宏出错: {e}\n")
```

## 错误处理

| 场景 | 处理 |
|------|------|
| 无活动文档 | Console.PrintError，返回 |
| 文档无有效对象 | Console.PrintMessage，不弹窗 |
| 对象无 OutList | `getattr(obj, 'OutList', [])` 兜底 |
| 对象无 Material | 显示 "N/A" |
| LinkGroup 循环引用 | visited set 防无限递归 |
| CSV 写入失败 | 状态栏显示错误，不崩 |

## 测试（test_bom_macro_data.py）

不需要 FreeCAD 环境，用 mock 对象测：

- `MockObject(name, label, type_id, out_list, in_list, material)`
- `MockDocument(objects)`

测试用例：
- 空文档 → 空 BomResult
- 单零件 → 1 行，qty=1
- 装配含 2 个相同零件 → 该零件 qty=2
- 多层嵌套 → level 正确递增
- 循环引用 → 不无限递归
- 无效类型对象 → 被跳过

## 实现顺序

1. **创建 `phoenix/freecad/bom_macro/` 目录和空文件**
2. **`bom_data.py`** — 数据模型 + 遍历 + 聚合逻辑
3. **`test_bom_macro_data.py`** — 单元测试，验证数量统计修正
4. **`bom_ui.py`** — tkinter 表格 + 搜索 + 导出
5. **`bom_macro.py`** — 入口串联
6. **修改 `phoenix/freecad/__init__.py`** — 注册导出
7. **在 FreeCAD 中实测**

## 与现有项目的复用关系

项目已有 BOM 相关代码，但场景不同：

- `phoenix/services/cad_index/bom_compute.py` — 从 FCStd 文件（zip/XML）构建 BOM 森林，用于工作空间级 BOM
- `phoenix/services/bom_apply_service.py` — 读/写 FCStd 内嵌 BOM 属性
- `web-ui/src/pages/BomExportPage.vue` — Web 端 BOM 导出页

新宏是 **在 FreeCAD 内部直接遍历活跃文档对象树**，与上述文件级 BOM 互补不冲突。
