# CAA 工具箱 折叠/Ribbon 规划

## 当前状态 ✅

- 独立 Vue 控件 `CaaControlPalette.vue`
- 标题栏 "工具箱" + 📌 折叠按钮
- 折叠时缩为 🧰 图标按钮（36px 宽）
- 带边框、圆角

## TODO：多级折叠

### Level 0：展开（当前）
```
┌─────────────┐
│ 工具箱   📌  │
│             │
│ 容器        │
│ [Frame][Tab]│
│ [Container] │
│ 基础控件    │
│ [Label] ... │
│ ...         │
└─────────────┘
```
宽度 176px，全部可见。

### Level 1：Ribbon 行（点击折叠）
```
┌──────────────────────────────┐
│ 🧰 [Frame][Tab][Container] [Label][Editor][Button] ... │
└──────────────────────────────┘
```
- 所有控件按钮排成一行（横向滚动或换行）
- 组标签隐藏
- 图标 + 短名

### Level 2：完全隐藏（再次点击）
只剩 🧰 浮动图标在画布角落。

### 状态机
```
展开(176px) → 点击📌 → Ribbon行 → 点击🧰 → 隐藏(仅图标) → 点击🧰 → 展开
```

## 技术要点

- 用 Pinia 存储折叠状态跨页面
- Ribbon 模式用 `display: flex; flex-wrap: wrap`
- 隐藏后可改为 `position: fixed` 浮动图标
- each button shows icon (from catalog's icon field) + short label

## 备注

当前 `CaaControlPalette.vue` 仅实现 Level 0 ↔ Level 1（简化版折叠）。
Ribbon + 完全隐藏后续迭代。
