# CAA 对话框 · 控件组件化设计

> 关联：[CAA对话框-Web编辑器-规划.md](CAA对话框-Web编辑器-规划.md) · [CAA模块-概览.md](CAA模块-概览.md)  
> 状态：**设计稿**（2026-06-24）  
> 背景：P0 用 `CaaDialogNodeView.vue` 以 `v-if` 区分控件类型。随着控件类型增多、交互变复杂（点击选中、右键菜单、内联编辑），应拆分为**每控件一个 Vue 组件**，封装行为与样式。

---

## 1. 设计原则

| 原则 | 说明 |
|------|------|
| **一控件一组件** | 每个 `CATDlg*` 类型对应一个 `.vue` 文件，如 `CaaControlLabel.vue`、`CaaControlEditor.vue` |
| **组合优于分支** | 用 `<component :is>` 动态选择组件，替代 `v-if/else-if` 长链 |
| **行为封装** | 每个组件自带：点击选中、高亮、右键菜单注册、NLS 内联编辑 |
| **容器递归** | 容器控件内部递归渲染子控件，天然支持 Frame 嵌套 |
| **provide/inject** | 对话框级上下文（IR、选中状态、编辑状态）通过 `provide` 向下传递 |
| **Label 提供文字，部件不显示文字** | CAA 对话框布局：Label 控件放在 Editor/Spinner/Combo/SelectorList 旁边的 grid cell 里提供标签文字；部件控件本身是纯交互部件（空输入框、空下拉、空列表），不应显示任何 NLS 文本 |

---

## 2. 组件树结构（草案）

```text
CaaDialogCanvas
└── CaaControlDialog (根 Dialog)
    ├── CaaControlFrame
    │   ├── CaaControlLabel
    │   ├── CaaControlSelectorList
    │   └── CaaControlEditor
    ├── CaaControlFrame              ← Frame 可嵌套
    │   ├── CaaControlMultiList
    │   └── CaaControlPushButton
    └── CaaControlEditor (Multiline)
```

### 2.1 组件文件名约定

```
web-ui/src/components/caa/controls/
├── CaaControlDialog.vue
├── CaaControlFrame.vue
├── CaaControlTabContainer.vue
├── CaaControlTabPage.vue
├── CaaControlContainer.vue
├── CaaControlLabel.vue
├── CaaControlEditor.vue
├── CaaControlSelectorList.vue
├── CaaControlMultiList.vue
├── CaaControlPushButton.vue
├── CaaControlSpinner.vue
├── CaaControlCheckButton.vue
├── CaaControlRadioButton.vue
├── CaaControlCombo.vue
├── CaaControlSeparator.vue
└── CaaControlUnknown.vue           ← 未识别类型 · 灰盒占位
```

### 2.2 类型注册表

```ts
// web-ui/src/components/caa/controls/registry.ts

import CaaControlDialog from "./CaaControlDialog.vue";
import CaaControlFrame from "./CaaControlFrame.vue";
// ... etc

/** CAA 类型 → Vue 组件映射 */
export const caaControlMap: Record<string, Component> = {
  CATDlgDialog: CaaControlDialog,
  CATDlgFrame: CaaControlFrame,
  CATDlgTabContainer: CaaControlTabContainer,
  CATDlgTabPage: CaaControlTabPage,
  CATDlgContainer: CaaControlContainer,
  CATDlgLabel: CaaControlLabel,
  CATDlgEditor: CaaControlEditor,
  CATDlgSelectorList: CaaControlSelectorList,
  CATDlgMultiList: CaaControlMultiList,
  CATDlgPushButton: CaaControlPushButton,
  CATDlgSpinner: CaaControlSpinner,
  CATDlgCheckButton: CaaControlCheckButton,
  CATDlgRadioButton: CaaControlRadioButton,
  CATDlgCombo: CaaControlCombo,
  CATDlgSeparator: CaaControlSeparator,
};

/** 未注册类型走灰盒 */
export function resolveCaaControl(type: string): Component {
  return caaControlMap[type] ?? CaaControlUnknown;
}
```

---

## 3. 共享注入上下文

每个控件通过 `inject` 获取对话框级的共享上下文，避免 Props 层层传递：

```ts
// web-ui/src/composables/useCaaControlContext.ts

export interface CaaControlContext {
  /** 对话框根节点（NLS 路径计算用） */
  dialogRoot: CaaDialogNode;
  /** 当前选中的控件 ID */
  selectedId: Ref<string | null>;
  /** 选中控件 */
  select: (nodeId: string) => void;
  /** 是否可编辑（非 Demo 且有 .CATNls） */
  canEdit: Ref<boolean>;
  /** 当前活动的 NLS locale（切换语言时画布即时变化） */
  activeLocale: Ref<string>;
  /** NLS 内联编辑提交 */
  commitNls: (key: string, value: string, target: CaaNlsEditTarget) => void;
  /** 右键菜单注册 */
  registerContextMenu: (nodeId: string, items: ContextMenuItem[]) => void;
}

export const CAA_CONTROL_KEY: InjectionKey<CaaControlContext> = Symbol("caa-control");
```

### 3.1 控件通过 provide/inject 获取上下文

```vue
<!-- CaaControlFrame.vue -->
<script setup lang="ts">
import { inject } from "vue";
import { CAA_CONTROL_KEY } from "../../composables/useCaaControlContext";

const ctx = inject(CAA_CONTROL_KEY)!;
const isSelected = computed(() => ctx.selectedId.value === props.node.id);

function onClick(e: MouseEvent) {
  e.stopPropagation();
  ctx.select(props.node.id);
}
</script>
```

---

## 4. 容器控件的 Grid 行为

### 4.1 核心规则

CAA 容器（Dialog、Frame、TabContainer、TabPage、Container）的内部布局：

| 属性 | 含义 | Web 映射 |
|------|------|----------|
| `GRID`（子控件） | 在父容器中的行列位置 | `grid-row` / `grid-column` + `span` |
| `ROWRES` | 哪些行可伸缩 | 对应行 `grid-template-rows: 1fr` |
| `COLRES` | 哪些列可伸缩 | 对应列 `grid-template-columns: 1fr` |
| **无 ROWRES/COLRES** | 行/列以最小尺寸适应内容 | `grid-template-rows/columns: auto`（最小尺寸） |

### 4.2 伸缩与填充的对应关系

```
.CATDlg 声明                   CSS Grid 映射
────────────────────────────────────────────────
ROWRES = { 1 };                grid-template-rows: 1fr auto auto;
COLRES = { 0, 1 };             grid-template-columns: 1fr 1fr;
（无 ROWRES）                   grid-template-rows: auto auto;  ← 最小尺寸
```

### 4.3 关键行为：无伸缩 → 最小尺寸，子控件不充满

**核心规则：非伸缩列/行 = 内容最小尺寸，靠左/上对齐。**

| 列模式 | 布局行为 | 子控件宽度 |
|--------|----------|-----------|
| `COLRES = { 1 }` | 列 1 `1fr`(撑满)，其余 `auto`(内容宽) | 伸缩列控件 `width:100%`，固定列控件内容宽 |
| `COLRES = {}`（无伸缩） | **所有列 `auto`**，按内容最小宽度排列 | 所有控件内容宽，不拉伸 |
| `COLRES = { 0, 1, 2 }`（全部伸缩） | 三列均分可用宽 | 所有控件 `width:100%` |

**无伸缩时的具体表现**：
- 所有控件靠左排列（`justify-items: start`）
- 每列宽度 = 该列最宽控件的内容宽
- 控件不充满列——如按钮宽度 = 按钮文本宽，不会撑到列宽
- 最后一列同理：按钮/控件保持最小内容宽，不会"充满右边"

**行同理**：
- `ROWRES = {}` → 所有行 `auto`，行高 = 行内最高控件高
- 高度始终由内容自底向上驱动，不拉伸

### 4.4 Frame 嵌套

Frame 可嵌套——子 Frame 放在父容器 Grid 中，内部递归渲染，每个 Frame 独立维护自己的 `ROWRES`/`COLRES`。

```text
Dialog (ROWRES={1}, COLRES={0})
├── FrameParent (COLRES={1})
│   ├── Label...         ← Frame 内部
│   └── FrameChild (ROWRES={0})
│       └── Editor...    ← 嵌套 Frame
└── Button...             ← Dialog 内部
```

### 4.5 baseContainer 统一 resize 函数（设计）

容器控件（Dialog / Frame / TabPage / Container / TabContainer）共享一个 **`useCaaContainerResize`** composable，用 JS 显式计算子控件宽度，取代 CSS 的 `width: 100%` / `1fr` 依赖。

**动机**：CSS 内联样式与 class 的优先级冲突（如 `width: Xch` 覆盖 `width: 100%`），且 CSS Grid `1fr` + `auto` 的伸缩语义不如 JS 显式计算可控。

**接口草案**：

```ts
// web-ui/src/components/caa/controls/useCaaContainerResize.ts

export interface ContainerResizeResult {
  /** grid-template-columns（显式 px 用于伸缩列，auto 用于固定列） */
  columnTemplate: string;
  /** 按 childId 获取显式宽度样式 */
  getChildWidth: (child: CaaDialogNode) => Record<string, string> | undefined;
  /** 网格总宽 */
  gridWidth: string;
}

/** 容器控件统一 resize 逻辑 */
export function useCaaContainerResize(
  node: () => CaaDialogNode,
  availableWidthPx?: number,
): ComputedRef<ContainerResizeResult>;
```

**计算流程**：

```
1. avail = availableWidthPx ?? CAA_DIALOG_PREVIEW_WIDTH_PX (500px)
2. 遍历 node.children → 得出 maxCol、每列控件列表
3. 固定列（非 COLRES）→ 宽度 = max(TW × ch, content)
4. 伸缩列（COLRES）→ 宽度 = (avail - sum(固定列) - gaps) / COLRES 数
5. 每子控件 → 根据所在列 + span 计算显式 width px
6. 返回 columnTemplate（如 "200px 1fr 80px"）+ childWidthMap
```

**容器使用方式**（以 Frame 为例）：

```vue
<script setup>
import { useCaaContainerResize } from "./useCaaContainerResize";

const props = defineProps<{ node: CaaDialogNode; fillParent?: boolean }>();
const resize = useCaaContainerResize(() => props.node, /* availableWidth */);
</script>
<template>
  <CaaDialogGrid :node="node" :fill-parent="fillParent" :resize="resize" />
</template>
```

Grid 将 `getChildWidth` 传给每个 `CaaDialogNodeView`，最终作为控件的内联 `style`。

### 4.6 编辑/预览模式切换

容器 Grid 有两个显示模式，由 `CaaControlContext.editMode`（Pinia store 缓存，默认编辑模式）控制：

| 模式 | Grid bar (⊞ N×M) | 伸缩标签 | Grid 辅助线 | 单元格边界 |
|------|-------------------|----------|-------------|-----------|
| **编辑** | 显示 | 显示 | 显示（灰色 gap 背景） | 显示（浅色 box-shadow） |
| **预览** | 隐藏 | 隐藏 | 隐藏 | 隐藏 |

页头按钮 `编辑/预览`（`store.toggleEditMode()`）统一切换所有 Grid 的显示模式。

---

## 5. 右键行为封装

### 5.1 右键菜单设计

每个控件独立的右键菜单，提供常用操作：

| 菜单项 | 适用控件 | 说明 |
|--------|----------|------|
| **编辑 Title** | 所有有 NLS 的控件 | 直接在树/画布上选中该控件，滚动 NLS 属性 |
| **编辑 Help / Tooltip** | Label, Editor, SelectorList, Combo, PushButton 等 | 打开 NLS 树编辑器（§6），定位到该控件的 Help 键组 |
| **Grid 属性** | 所有在 Grid 中的控件 | 查看/修改 `row`/`col`/`rowSpan`/`colSpan`/`anchor` |
| **尺寸属性** | Editor, SelectorList, MultiList 等 | 修改 TH/TW/CC/VCC |
| **Spinner 属性** | Spinner | 修改 MIN/MAX/STEP/PREC |
| **设为伸缩行** | 容器控件 | 将当前子控件所在行加入父容器的 ROWRES |
| **取消伸缩行** | 容器控件 | 将当前子控件所在行从父容器的 ROWRES 移除 |

### 5.2 右键菜单技术方案

```vue
<!-- CaaControlContextMenu.vue -->
<script setup lang="ts">
import { computed, ref } from "vue";

export interface ContextMenuItem {
  label: string;
  action: () => void;
  divider?: boolean;
  disabled?: boolean;
  icon?: string;
}

const visible = ref(false);
const position = ref({ x: 0, y: 0 });
const items = ref<ContextMenuItem[]>([]);
const targetId = ref<string | null>(null);

function show(nodeId: string, menuItems: ContextMenuItem[], pos: { x: number; y: number }) {
  targetId.value = nodeId;
  items.value = menuItems;
  position.value = pos;
  visible.value = true;
}

function hide() {
  visible.value = false;
  targetId.value = null;
}
</script>
```

每个控件组件在 `onContextmenu` 时，通过注入的 `registerContextMenu` 构建菜单项，调用 `show()`。

### 5.3 菜单项构建（示例）

```ts
// 每个控件组件内
function buildMenu(node: CaaDialogNode): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  
  // 所有有 NLS 的控件
  if (node.nls) {
    items.push({
      label: "编辑 Title",
      action: () => ctx.select(node.id) // 选中并聚焦 NLS 面板
    });
    items.push({
      label: "编辑 Help / Tooltip",
      action: () => ctx.openNlsTreeFor(node.id)
    });
  }
  
  items.push({ divider: true });
  
  // Grid 属性
  if (node.grid) {
    items.push({
      label: "Grid 属性",
      action: () => ctx.openGridEditor(node.id)
    });
  }
  
  // 尺寸属性
  if (node.size) {
    items.push({
      label: "尺寸 (TH/TW/CC/VCC)",
      action: () => ctx.openSizeEditor(node.id)
    });
  }
  
  // 容器操作
  if (isContainer(node) && node.grid) {
    const parentRow = node.grid.row;
    const father = findNode(ctx.dialogRoot, node.father);
    const isResizable = father?.gridLayout?.rowResizable?.includes(parentRow) ?? false;
    items.push({ divider: true });
    items.push({
      label: isResizable ? "取消此行伸缩" : "设为伸缩行",
      action: () => ctx.toggleRowResize(node.father!, parentRow)
    });
  }
  
  return items;
}
```

---

## 6. 文案编辑器（NLS 树视图）

### 6.1 设计目标

替代当前扁平的 `CaaCatNlsEditDialog`（平铺键值列表），用**树视图**组织 NLS 文案：

- **按控件分组**：每个控件一个树节点，展开后显示其 NLS 属性（Title、Help、ShortHelp、LongHelp、ColumnTitle*）
- **相同值折叠**：若 Help / ShortHelp / LongHelp 三者值相同，折叠为一个「统称提示」组节点；编辑时三个键一起改
- **默认折叠**：值相同的属性组默认折叠显示
- **全文搜索**：支持按键/值/控件名搜索过滤

### 6.2 树结构

```text
🌐 全部文案 (42 键)
├── 📦 PNXBomAnalysisDlg (Dialog)        ← 控件分组
│   └── 📝 Title = "PNX Bom Analysis"
├── 📦 FrameParams (Frame) · 2 键
│   ├── 📝 Title = "参数"
│   └── 📦 FrameParams.Help / ShortHelp / LongHelp  ← 值相同，折叠
│       └── 🔗 "PNX Bom Analysis help text"         ← 编辑一个 → 三个同步
├── 📦 LabelFirstProduct (Label) · 1 键
│   └── 📝 Title = "Root Product:"
├── 📦 SelectorListFirstProduct (SelectorList) · 4 键
│   ├── 📝 Title（选择列表）                      ← 占位符，可选编辑
│   └── 📦 Help / ShortHelp / LongHelp              ← 三个值相同 = "Select Base Curve"
│       └── 🔗 "Select Base Curve"
├── 📦 EditorFirstPartNumber (Editor) · 3 键
│   ├── 📝 Title（输入框）                         ← 占位符
│   └── 📦 Help / ShortHelp / LongHelp
│       └── 🔗 "Enter part number"
├── 📦 MultiListPartBom (MultiList) · 5 键
│   ├── 📝 Title（表格）
│   ├── 📝 ColumnTitle1 = "name"
│   ├── 📝 ColumnTitle2 = "type"
│   ├── 📝 ColumnTitle3 = "quantity"
│   └── 📝 ColumnTitle4 = "unit"
└── 📦 EditorOutInfo (Editor) · 2 键
    ├── 📝 Title（输出信息）
    └── 📝 Help = "Build output information"
```

### 6.3 各控件 NLS 属性适用性

CAA 原生对话框编辑器中，不是所有控件都暴露 Title / Help 属性。Web 编辑器的 NLS 树表格应匹配此行为。

| 控件类型 | Title | Help/ShortHelp/LongHelp | 备注 |
|----------|-------|-------------------------|------|
| `CATDlgDialog` | ✓ | — | Title = 窗口标题 |
| `CATDlgFrame` | — | ✓ | Title = frame 标题 (legend) |
| `CATDlgLabel` | ✓ | ✓ | Title = 显示文本 |
| `CATDlgEditor` | — | ✓ | |
| `CATDlgSelectorList` | — | ✓ | |
| `CATDlgCombo` | — | ✓ | |
| `CATDlgMultiList` | — | ✓ | Title + ColumnTitle[] |
| `CATDlgPushButton` | ✓ | ✓ | Title = 按钮文本 |
| `CATDlgCheckButton` | ✓ | ✓ | |
| `CATDlgRadioButton` | ✓ | ✓ | |
| `CATDlgSpinner` | — | ✓ | |
| `CATDlgTabPage` | ✓ | — | Title = tab 标签 |
| `CATDlgTabContainer` | — | — | 容器，Title 无意义 |
| `CATDlgContainer` | — | — | 滚动容器，Title 无意义 |
| `CATDlgSeparator` | — | — | 分隔线，无文本 |

**规则**：
- Title 列为 `—` 的控件：不显示 Title 行
- Help 列为 `—` 的控件：不显示 Help 组，也没有 `[+ 添加提示]` 按钮

### 6.4 Help / ShortHelp / LongHelp 显示规则

**背景**：IR 中所有控件都可以有 Help/ShortHelp/LongHelp 属性，但绝大多数为空。

| 规则 | 说明 |
|------|------|
| **R1 · 空值不显示** | Help / ShortHelp / LongHelp 值 trim 后为空的不显示。三个全空 → 该控件不展示任何 Help 行 |
| **R2 · 添加 Help** | 无 Help 行的控件，显示 `[+ 添加提示]` 按钮。点击后展开三个空行（Help / ShortHelp / LongHelp） |
| **R3 · 保存即保留** | 用户填写并保存的行，下次打开保留。填写后留空 → 保存时空字符串写入 → 下次不显示（R1） |
| **R4 · 全同折叠** | Help === ShortHelp === LongHelp 且非空 → 合并为一折叠行「Help / ShortHelp / LongHelp」 |
| **R5 · 折叠行可编辑** | 点击折叠行 → 编辑值 → 三个键同时写入。展开后各自独立编辑 |
| **R6 · 部分相同** | Help === ShortHelp 且非空，LongHelp 不同 → Help+ShortHelp 合并一行 + LongHelp 独立一行 |
| **R7 · 三者不同** | 分别显示 Help、ShortHelp、LongHelp 三行 |
| **R8 · 展开/折叠记忆** | 折叠状态不持久化，每次打开编辑器默认折叠同值组 |

### 6.4 编辑行为

| 操作 | 单键节点 | 折叠组节点 |
|------|----------|------------|
| 点击值 | 内联编辑，回车确认 | 内联编辑，回车确认 → **同时写入组内所有键** |
| 修改后 | `currentNlsFlat[key] = value` | `forEach(key in groupKeys) currentNlsFlat[key] = value` |
| 添加 Help | 创建三个空键，填写后保存 | — |

### 6.5 双语对比模式（保留）

在树视图下也支持双语对比——树节点展开后，每个键的编辑区显示两列（英文 / 中文），与当前 `CaaCatNlsEditDialog` 的「双语对比」模式功能对齐。

### 6.6 搜索过滤

```
┌─────────────────────────────────────┐
│ 🔍 搜索键/值/控件…        [中英对比]  │  ← 工具栏
├─────────────────────────────────────┤
│ 🌐 全部文案 (匹配 8/42 键)           │  ← 只展开匹配的节点
│ ├── 📦 SelectorListFirstProduct · 4键│  ← 匹配「Select」→ 展开
│ │   ├── 📝 Title（选择列表）          │
│ │   └── 📦 Help/ShortHelp/LongHelp   │
│ │       └── 🔗 "Select Base Curve"   │  ← 匹配高亮
│ ├── 📦 EditorOutInfo · 1 键          │
│ │   └── 📝 Help = "Build output..."  │
```

### 6.7 组件接口草案

```ts
// CaaNlsTreeEditor.vue props
interface CaaNlsTreeEditorProps {
  open: boolean;
  /** IR 树根节点 */
  root: CaaDialogNode;
  /** 当前 locale 的 flat NLS */
  nlsFlat: Record<string, string>;
  /** baseline 用于 dirty 检测 */
  baselineFlat: Record<string, string>;
  /** 是否显示双语对比 */
  compareMode?: boolean;
  /** 对比模式下的中文 NLS */
  cnNlsFlat?: Record<string, string>;
  /** 对比模式下的中文 baseline */
  cnBaselineFlat?: Record<string, string>;
}

// emits
interface CaaNlsTreeEditorEmits {
  close: [];
  "update:value": [key: string, value: string, locale?: "en" | "cn"];
}
```

### 6.8 切换策略

保留现有 `CaaCatNlsEditDialog.vue`，新增 `CaaNlsTreeEditor.vue`，通过配置或页头按钮切换。树视图是默认模式，用户可选回旧的平铺表视图。

---

## 7. 重构步骤

| 步骤 | 说明 | 影响 |
|------|------|------|
| **S1** | 抽取 `CAA_CONTROL_KEY` 上下文注入 | `CaaDialogEditorPage.vue` 增加 `provide` |
| **S2** | 创建 `controls/` 目录，逐个迁移控件组件 | 从 `CaaDialogNodeView.vue` 的 `v-if` 分支拆分 |
| **S3** | 新增点击选中 + 蓝色边框高亮 | 每个控件组件内置 `onClick` + `isSelected` class |
| **S4** | 新增右键菜单基础设施 | `CaaControlContextMenu.vue` + 各控件 `onContextmenu` |
| **S5** | 新增 `CaaNlsTreeEditor.vue` | 与现有 `CaaCatNlsEditDialog` 平行运行 |
| **S6** | 清理旧分支 `CaaDialogNodeView.vue` | 替换为 `<component :is="resolveCaaControl(node.type)">` |

---

## 8. 决策记录

| 项 | 决策 | 日期 |
|------|------|------|
| 控件组件化 | **一控件一 `.vue`**，`<component :is>` 动态选择 | 2026-06-24 |
| 上下文传递 | **`provide/inject`**，不 props 层层透传 | 2026-06-24 |
| 右键菜单 | 每个控件组件自行构建菜单项，注入 `showContextMenu` | 2026-06-24 |
| NLS 编辑 | **树视图**为默认，平铺表可选保留 | 2026-06-24 |
| NLS 入口合并 | 编辑文案 / 编辑 CATNls 合并为单一按钮，内部分树/表切换 | 2026-06-24 |
| Help 折叠 | 值相同的 Help/ShortHelp/LongHelp **默认折叠为组**，编辑组节点 → 三个键同步 | 2026-06-24 |
| Grid 伸缩 | ROWRES/COLRES 正确映射 `fr`/`auto`；无伸缩 → `auto`（最小尺寸） | 2026-06-24 |
| 控件宽度 | **JS 显式计算**（`useCaaContainerResize`），避免 CSS 优先级冲突 | 2026-06-24 |
| 编辑/预览 | **`editMode`** 统一切换 Grid bar / 辅助线 / 单元格边界显隐，Pinia 缓存 | 2026-06-24 |
| 旧组件 | `CaaDialogNodeView.vue` 保留为过渡，最终替换 | 2026-06-24 |
| 空白新建 | 主页入口 → 空白 Dialog IR + 左侧控件工具箱 + 右侧画布 | 2026-06-24 |

---

## 9. 空白对话框新建（Builder 模式）

### 9.1 定位

不依赖已有 `.CATDlg` 文件，从零构建对话框。

### 9.2 页面布局

```
┌──────────────────────────────────────────┐
│ 页头：Dialog 名称 [保存] [编辑/预览]       │
├──────────┬───────────────────────────────┤
│ 工具箱    │ 画布                          │
│ (n×2)    │                               │
│          │  ┌─────────────────────┐      │
│ Label    │  │ Dialog (500px)      │      │
│ Editor   │  │  ┌────────────────┐ │      │
│ Combo    │  │  │ Frame          │ │      │
│ Button   │  │  │  MultiList     │ │      │
│ ...      │  │  │  Button        │ │      │
│          │  │  └────────────────┘ │      │
│ Frame    │  └─────────────────────┘      │
│ Tab…     │                               │
├──────────┴───────────────────────────────┤
│ 属性面板 / NLS 编辑器（可折叠）             │
└──────────────────────────────────────────┘
```

### 9.3 数据流

1. Pinia 维护空白 IR（`schemaVersion:1`，仅 Dialog 根节点）
2. 点击工具箱控件 → `addControl(parentId, type)` → IR 树更新 → 画布即时渲染
3. Grid 位置由用户拖拽或右键菜单设置
4. 保存时：后端生成 `.CATDlg` 文本 + `.CATNls` 骨架，写入磁盘

### 9.4 工具箱设计

| 分组 | 控件 |
|------|------|
| 基础 | Label, Editor, SelectorList, Combo, Spinner, PushButton, CheckButton, RadioButton |
| 列表 | MultiList |
| 容器 | Frame, TabContainer+TabPage, Container |
| 装饰 | Separator |
