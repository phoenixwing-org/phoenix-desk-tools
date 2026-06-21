# Web 壳层 — 页面属性面板

> [文档索引](../文档索引.md) · 状态：**P1 已落地 · P2 进行中 · 2026-06-21**  
> **规划**：[Web壳层-页面属性面板-规划.md](Web壳层-页面属性面板-规划.md) · **P1 归档**：[Web壳层-页面属性面板-P1归档.md](Web壳层-页面属性面板-P1归档.md) · 待办：[TODO.md](../TODO.md) §侧栏·页面属性面板

## 设计原则（对齐 FreeCAD）

**业务页只声明「属性描述符」，壳层自动画界面**——不在页面里写 `el-checkbox` / `el-select` 表单布局。

| FreeCAD | Phoenix Web |
| --- | --- |
| `App::PropertyBool` 等 | `propBool` / `propEnum` / … |
| 属性视图按类型选编辑器 | `PagePropertyFieldRow.vue` 按 `kind` |
| 分组折叠段 | `propGroup` |
| 左名右值表格 | `<table>` + 名称列拖拽（`shell_layout`） |

## 位置

工作空间侧栏 · **工作空间树 Tab 下方**（与运行日志同侧可上下分栏；页脚图标可开关）。

## 已接入页面

| pageId | composable |
| --- | --- |
| `reorder_members` | `useReorderMembersPropertySheet.ts` |
| `xlink_fix` | `useXlinkFixPropertySheet.ts` |
| `code_rename` | `useCodeRenamePropertySheet.ts` |
| `code_uuid` | `useCodeUuidPropertySheet.ts` |
| `part_dedup` | `usePartDedupPropertySheet.ts` |

## 业务页接入

```typescript
usePagePropertySheet("page_id", () =>
  propSheet([
    propGroup("run", "运行选项", [
      propBool("flag", "选项", {
        value: computed(() => store.flag),
        onChange: (v) => { store.setFlag(v); onPersist(); },
      }),
    ]),
  ], { title: "页面标题" }),
);
```

复杂块：`propSlot` + `WorksetScopePicker`（见 `useCodeRenamePropertySheet.ts`）。

## 生命周期

1. `usePagePropertySheet` → `registerPageProperties`
2. `AppShell` 切页 → `setPropertiesActivePage`
3. 无 sheet → 「当前页无可配置项」

## 文件索引

| 文件 | 职责 |
| --- | --- |
| `types/pageProperties.ts` | 类型联合 |
| `utils/pagePropertySchema.ts` | 描述符工厂 |
| `composables/usePagePropertySheet.ts` | 注册 hook |
| `composables/pagePropertiesHost.ts` | 全局 Map |
| `composables/use*PropertySheet.ts` | 各页描述符 |
| `components/PagePropertiesPanel.vue` | 分组表格 |
| `components/PagePropertyFieldRow.vue` | 单行渲染 |
