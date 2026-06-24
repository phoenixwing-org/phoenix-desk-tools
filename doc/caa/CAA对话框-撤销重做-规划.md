# CAA 对话框 Builder — 撤销/重做（Undo/Redo）规划

> 背景：拖放添加/移动控件是高危操作，需要可撤销。  
> 范围：CAA 对话框编辑器的 IR 树变更。  
> 不包括：NLS 文案编辑、Grid 伸缩开关（这些可后续纳管）。

## 方案：快照式历史栈

每次 IR 树变更操作（add/move/remove/insertRowCol）前保存完整 IR 快照。

### 数据结构

```typescript
// web-ui/src/composables/useCaaHistory.ts
interface HistoryEntry {
  ir: string;          // JSON.stringify(localIr) — 深拷贝快照
  selectedId: string | null;
  timestamp: number;
}

// 状态
const undoStack = ref<HistoryEntry[]>([]);  // 过去
const redoStack = ref<HistoryEntry[]>([]);  // 未来
const MAX_HISTORY = 50;
```

### 核心 API

| 方法 | 说明 |
|---|---|
| `pushSnapshot(ir, selectedId)` | 操作前调用，压入 undo 栈，清空 redo 栈 |
| `undo()` | 弹出 undo 栈顶 → 恢复 IR → 压入 redo 栈 |
| `redo()` | 弹出 redo 栈顶 → 恢复 IR → 压入 undo 栈 |
| `canUndo` / `canRedo` | computed，控制按钮/快捷键启用 |
| `clearHistory()` | 切换对话框时清空 |

### 触发时机

在 `CaaDialogEditorPage.vue` 的 Builder 操作方法内部，**变更 IR 前**调用 `pushSnapshot`：

```typescript
addControl(...) {
  pushSnapshot(localIr.value, localSelectedId.value);  // ← 变更前
  // ... 执行变更 ...
}
insertRow / insertCol / removeControl — 同上
```

同容器拖移（直接改 grid 位置）也需要 snapshot。

### 快捷键

| 快捷键 | 操作 |
|---|---|
| `Ctrl+Z` | undo |
| `Ctrl+Shift+Z` / `Ctrl+Y` | redo |

全局 `@keydown` 监听，仅在 CAA 编辑器页面激活时生效。

### 界面

- 工具栏新增两个小按钮：`↩ 撤销` / `↪ 重做`
- 无历史时 disabled
- 可显示最近操作描述（可选，后续迭代）

### 纳入管理的操作

| 操作 | 快照时机 |
|---|---|
| 从面板新建控件（COPY） | 添加前 |
| 拖移已有控件（MOVE） | 移动前 |
| 插入行/列 | 插入前 |
| 删除控件（后续右键菜单） | 删除前 |

### 暂不纳入

- NLS 双语编辑（Key/Value 修改）→ 复杂度高，后续
- Grid 伸缩开关 → 影响小，后续
- 编辑/预览模式切换 → 不需要

### 草稿联动

undo/redo 后 IR 变更，触发草稿自动保存（debounced），保证退出后回来仍是最新状态。

### 性能

- 单次快照 ≈ `JSON.stringify(ir)`，典型 IR <50KB，耗时 <1ms
- 50 个快照 ≈ 2.5MB 内存，可接受
- 切换对话框时 `clearHistory()` 释放

### 需修改的文件

| 文件 | 操作 |
|---|---|
| `web-ui/src/composables/useCaaHistory.ts` | **新建** — 历史栈 composable |
| `web-ui/src/pages/CaaDialogEditorPage.vue` | **修改** — 引入 history，变更前 push，工具栏加按钮，键盘监听 |
| `web-ui/src/components/caa/CaaDialogGrid.vue` | 不变 — 同容器拖移通过 ctx 方法间接触发 snapshot |

### 测试策略

`useCaaHistory.ts` 是纯逻辑 composable，可单元测试：
- push → undo → redo 往返一致
- 新操作后 redo 栈清空
- 达到 MAX_HISTORY 时旧快照被裁剪
- canUndo/canRedo 正确反映栈状态

### 后续扩展

- 命令模式替代快照 → 更低内存，但实现复杂
- 操作描述文字显示（"添加 Label"、"移动 Editor"）
- NLS 文案编辑的 undo 纳管
