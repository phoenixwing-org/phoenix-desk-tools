# Ribbon 配置重构：actions / modules 分离

> 设计阶段，暂不执行。

## 1. 现状

```json
// app_config.json (当前)
{
  "navigation": [
    { "id": "fcstd_map",  "page": "fcstd_map",  "module": "cad",  "ribbonGroup": "索引" },
    { "id": "bom_export", "page": "bom_export", "module": "cad",  "ribbonGroup": "索引" },
    { "id": "cad_bom_viewer", "page": "cad_bom_viewer", "module": "cad-rust", "ribbonGroup": "索引" }
  ]
}
```

**问题**：每个 navigation 项只能属于一个 module/group。同一个功能想放两个 module（如 cad 和 cad-rust 并列对比），必须复制一份。

## 2. 目标

```json
// app_config.json (目标)
{
  "actions": {
    "fcstd_map":       { "page": "fcstd_map",  "label": "CAD 索引",   "description": "…" },
    "bom_export":      { "page": "bom_export", "label": "BOM 列表",   "description": "…" },
    "cad_bom_viewer":  { "page": "cad_bom_viewer", "label": "CR BOM查看", "description": "…" },
    "part_catalog":    { "page": "part_catalog", "label": "零件目录",  "description": "…" }
  },

  "ribbons": [
    {
      "id": "system",
      "label": "系统",
      "groups": [
        { "label": "常用", "actions": ["home", "config"] },
        { "label": "开发", "actions": ["git", "test_fixtures", "unit_tests"] }
      ]
    },
    {
      "id": "cad",
      "label": "CAD",
      "module": "cad",
      "groups": [
        { "label": "索引", "actions": ["fcstd_map", "bom_export", "part_catalog"] },
        { "label": "工具", "actions": ["file_rename", "xlink_fix", "part_dedup", "step_batch", "sw_step_export"] }
      ]
    },
    {
      "id": "cad-rust",
      "label": "Rust",
      "module": "cad-rust",
      "groups": [
        { "label": "索引", "actions": ["cr_fcstd_map", "cad_bom_viewer", "cr_bom_export", "cr_part_catalog"] },
        { "label": "工具", "actions": ["cr_file_rename", "cr_xlink_fix", "cr_part_dedup"] }
      ]
    },
    {
      "id": "code",
      "label": "Code",
      "module": "code",
      "groups": [
        { "label": "索引", "actions": ["code_index"] },
        { "label": "编辑", "actions": ["reorder_members", "code_rename", "code_uuid", "code_ignore"] },
        { "label": "CAA",  "actions": ["caa_dialog_home"] }
      ]
    },
    {
      "id": "cad-compare",
      "label": "CAD 对比",
      "module": "cad",
      "groups": [
        { "label": "BOM (旧)", "actions": ["bom_export"] },
        { "label": "BOM (新)", "actions": ["cad_bom_viewer"] }
      ]
    }
  ],

  "navigation": [
    // 扁平列表，保留用于侧栏树跳转、page_label 查找等
    // 从 actions + modules 自动聚合生成
  ]
}
```

**核心变化**：
- `actions` — 纯动作定义（page、label、description）。不绑定任何 module/ribbon。
- `modules` — 定义 Ribbon 标签页、分组、每个分组引用哪些 action id。
- 同一个 `action` 可以被多个 module/group 引用。
- `navigation` 从 actions+modules 自动聚合，仍保持兼容。

## 3. 命名

| 概念 | 说明 |
|------|------|
| `actions` | 页面/功能定义（不绑定 UI 位置） |
| `ribbons` | 工具条布局（引用 action id 到分组） |
| `modules` (已有) | 功能模块（cad / cad-rust / code），控制可见性 |

**为什么叫 `ribbons` 而不是 `modules`？**
- `modules` 已在 `nav_modules.py` 中表示功能模块（控制 workspace scope 过滤）
- `ribbons` 是 UI 布局概念——一个 ribbon tab 可混合多个 module 的 actions
- 例如迁移对比期，`cad-compare` ribbon 同时放 cad 和 cad-rust 的 BOM 按钮

## 4. 类比

这类似于 VS Code 的 `contributes` 模式：

```json
// package.json (VS Code extension)
{
  "contributes": {
    "commands": [                          // ← actions
      { "command": "extension.hello", "title": "Hello" }
    ],
    "menus": {                             // ← modules (引用 command id)
      "editor/title": [
        { "command": "extension.hello" }
      ]
    }
  }
}
```
同一个 command 可出现在多个 menu 位置。

## 5. Ribbon 元数据

每个 ribbon tab 自带元数据，消除代码中的硬编码（如 `moduleScopeTagType` 的 if/else）：

```json
{
  "ribbons": [
    {
      "id": "cad",
      "label": "CAD",
      "module": "cad",
      "description": "FreeCAD 工作空间管理",
      "tagColor": "success",
      "sortOrder": 1,
      "icon": "cad",
      "defaultPage": "fcstd_map",
      "groups": [...]
    },
    {
      "id": "cad-rust",
      "label": "Rust",
      "module": "cad-rust",
      "description": "Node.js + Rust 新版 BOM 引擎",
      "tagColor": "danger",
      "sortOrder": 2,
      "icon": "cad-rust",
      "defaultPage": "cad_bom_viewer",
      "groups": [...]
    }
  ]
}
```

### ModuleDef 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `label` | `string` | ✅ | 显示名（Ribbon Tab + 模块开关） |
| `description` | `string` | | 模块描述（hover tooltip） |
| `tagColor` | `"info" \| "success" \| "warning" \| "danger"` | | 模块标签颜色（欢迎页） |
| `sortOrder` | `number` | | Ribbon Tab 排列顺序（小→大） |
| `icon` | `string` | | 图标 key（ribbonIcons.ts 查找） |
| `defaultPage` | `string` | | 选中模块时的默认打开页面 |
| `hidden` | `boolean` | | 隐藏模块（定义但不显示，用于预配置） |
| `tabs` | `ModuleTabDef[]` | ✅ | Ribbon 分组定义 |

### 收益

- `moduleScopeTagType()` 不再需要 if/else，直接从 `modules[id].tagColor` 取
- `defaultPageForModuleScope()` 不再需要 if/else，直接从 `modules[id].defaultPage` 取
- `MODULE_SCOPE_OPTIONS` 从 `modules` 动态生成
- 新增模块只需加 JSON，零代码改动

## 5. 改动清单

### 6.1 `phoenix/config/app_config.json` — 数据结构

```diff
- navigation: [{id, page, module, ribbonGroup, ribbonLabel, description}]
+ actions: { [id]: {page, label, description} }
+ modules: { [moduleId]: {label, tabs: [{groups: [{label, actions: [id]}]}]} }
+ navigation: [{id, page, label, module?, description}]  // 自动聚合
```

**兼容策略**：先保留 `navigation` 旧格式，后端/前端同时支持新旧两种格式。新格式优先。

### 5.2 `web-ui/src/types/config.ts` — 类型定义

```diff
### 6.2 `web-ui/src/types/config.ts` — 类型定义

+ export type ActionItem = {
+   page: string;
+   label: string;
+   description?: string;
+   icon?: string;
+ };
+ 
+ export type ModuleRibbonDef = {
+   label: string;
+   tabs: ModuleTabDef[];
+ };
+ 
+ export type ModuleTabDef = {
+   groups: ModuleGroupDef[];
+ };
+ 
+ export type ModuleGroupDef = {
+   label: string;
+   actions: string[];  // action ids
+ };
```

### 5.3 `web-ui/src/layout/ribbon/ribbonConfig.ts` — 生成逻辑

```diff
- export function buildRibbonTabs(navigation: NavItem[]): RibbonTabDef[] {
-   // 从 navigation 的 module + ribbonGroup 字段生成
- }
+ export function buildRibbonTabs(
+   actions: Record<string, ActionItem>,
+   modules: Record<string, ModuleRibbonDef>,
+ ): RibbonTabDef[] {
+   // 从 modules 定义生成 tabs/groups
+   // 用 action id 从 actions map 查找 label
+ }
```

### 5.4 `web-ui/src/layout/ribbon/useRibbonTabs.ts` — 调用签名

```diff
- const ribbonTabs = computed(() => buildRibbonTabs(options.navigation.value));
+ const ribbonTabs = computed(() =>
+   buildRibbonTabs(options.actions.value, options.modules.value)
+ );
```

### 5.5 `web-ui/src/layout/AppShell.vue` — 传参

```diff
  useRibbonTabs({
-   navigation: computed(() => shell.appConfig.value?.navigation ?? []),
+   actions: computed(() => shell.appConfig.value?.actions ?? {}),
+   modules: computed(() => shell.appConfig.value?.modules ?? {}),
    ...
  });
```

## 6. 数据流

```
app_config.json
  ├── actions:  { id → {page, label, desc} }       ← 纯定义
  └── modules:  { moduleId → {tabs → groups → [actionId]} }  ← 引用
        │
        ▼ Python /api/config/app
        │
        ▼ AppShell.appConfig
        │
   buildRibbonTabs(actions, modules)
        │
        │  modules["cad-rust"].tabs[0].groups[0].actions
        │  → ["cr_fcstd_map", "cad_bom_viewer", …]
        │  → resolve: actions["cr_fcstd_map"] → {page, label}
        │
        ▼
   RibbonTabDef[]  →  RibbonPanel  →  用户看到按钮
```

## 7. 收益

| 场景 | 旧方案 | 新方案 |
|------|--------|--------|
| cad + cad-rust 并列 | 复制两份 navigation 项 | 两个 module 引用各自 actions |
| 同一个功能放多个位置 | 不可能 | 两个 group 引用同一个 action id |
| 新增页面 | 改 json + ribbonConfig.ts | 只改 json |
| 插件动态注册 | 无法做到 | 运行时 push action + 引用 |

## 8. 不变量

以下保持不变：
- `PAGE_COMPONENTS` (AppShell.vue) — 仍按 page 名映射 Vue 组件
- `page_context_config` — 仍按 page id 配置 max_tabs
- `resolvePageLabel()` (pageLabels.ts) — 从 actions 查 label
- `NavItem` 类型 — navigation 聚合列表保持兼容，供侧栏树跳转等使用
