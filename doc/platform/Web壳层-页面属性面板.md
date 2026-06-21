# Web 壳层 — 页面属性面板

> [文档索引](../文档索引.md) · 状态：**P2 已归档 · MVC 研讨中 · 2026-06-19**  
> **规划**：[Web壳层-页面属性面板-规划.md](Web壳层-页面属性面板-规划.md) · **P1 归档**：[Web壳层-页面属性面板-P1归档.md](Web壳层-页面属性面板-P1归档.md) · **P2 归档**：[Web壳层-页面属性面板-P2归档.md](Web壳层-页面属性面板-P2归档.md) · **MVC 研讨**：[Web壳层-页面参数与属性-MVC研讨.md](Web壳层-页面参数与属性-MVC研讨.md)（暂不执行） · 待办：[TODO.md](../TODO.md) §侧栏·页面属性面板

## 设计原则（对齐 FreeCAD）

**业务页只声明「属性描述符」，壳层自动画界面**——不在页面里写 `el-checkbox` / `el-select` 表单布局。

| FreeCAD | Phoenix Web |
| --- | --- |
| `App::PropertyBool` 等 | `propBool` / `propEnum` / … |
| 属性视图按类型选编辑器 | `PagePropertyFieldRow.vue` 按 `kind` |
| 分组折叠段 | `propGroup` |
| 左名右值表格 | `<table>` + 分组段；**无**「名称/值」表头（页标题即面板名） |
| **一名一值** | 一行只绑一个控件；多控件拆 **子分组**（`propGroup` + `hidden`） |
| 枚举 | 统一 **下拉**（`propEnum`），不用 radio |
| **无按钮** | 操作放主区 / Ribbon / 页脚；属性区仅 bool / string / number / enum / 只读 |

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
| `fcstd_map` | `useFcstdMapPropertySheet.ts` |
| `bom_export` | `useBomExportPropertySheet.ts` |

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

工作集范围：`useWorksetScopePropertyGroups(pageId)` → 范围模式 + 条件子分组（工作集：**选择**下拉 + **侧栏活动**只读）。打开/管理工作集用 Ribbon 或页脚「工作集」。

## 生命周期

1. `usePagePropertySheet` → `registerPageProperties`
2. `AppShell` 切页 → `setPropertiesActivePage`
3. 无 sheet → 「当前页无可配置项」

## 文件索引

| 文件 | 职责 |
| --- | --- |
| `types/pageProperties.ts` | 类型联合 |
| `utils/pagePropertySchema.ts` | 描述符工厂 |
| `composables/useWorksetScopePropertyGroups.ts` | 扫描范围 1:1 字段 + 条件子分组 |
| `composables/pagePropertiesHost.ts` | 全局 Map |
| `composables/use*PropertySheet.ts` | 各页描述符 |
| `components/PagePropertiesPanel.vue` | 分组表格 |
| `components/PagePropertyFieldRow.vue` | 单行渲染 |
