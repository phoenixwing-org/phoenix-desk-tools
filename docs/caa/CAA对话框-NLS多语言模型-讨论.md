# CAA 对话框 — NLS 多语言模型（讨论）

> 状态：设计讨论 · 2026-06-25

## 现状

```
CaaDialogIr
  root: CaaDialogNode          ← 树结构
  localeNls: Record<string, Record<string, string>>  ← 扁平表，localeId→key→value

CaaDialogNode
  nls?: ControlNls             ← 仅主 locale 的 NLS 数据
    title?: string
    help?: string
    shortHelp?: string
    longHelp?: string
    columnTitles?: string[]
```

问题：
- `node.nls` 只存了主 locale，多语言切换需要重新 apply 整个扁平表到树
- `ir.localeNls` 是独立扁平表，与树结构脱节
- 控件顺序变化时，NLS 顺序不知如何同步

## 目标

- 每个 `CaaDialogNode.nls` 指向**当前显示 locale** 的 NLS 数据
- 有一个 `LocaleNlsSet` 数组管理所有 locale 的翻译
- 切换语言 = 从 `LocaleNlsSet` 取出目标 locale 数据写入 `node.nls`
- NLS 文件写入顺序由 model 树遍历顺序决定

## 提议结构

```typescript
/** 单个 locale 的控件级 NLS */
interface LocaleControlNls {
  title?: string;
  help?: string;
  shortHelp?: string;
  longHelp?: string;
  columnTitles?: string[];
}

/** 多 locale NLS 集合 */
interface LocaleNlsEntry {
  localeId: string;           // "en", "Simplified_Chinese"
  catNlsRel?: string;         // 对应的 .CATNls 文件路径
  sourceText?: string;        // 原始文件文本（保留注释/结构）
  dirty: boolean;             // 是否有未保存修改
}

/** 在 CaaDialogIr 中 */
interface CaaDialogIr {
  root: CaaDialogNode;
  locales: LocaleNlsEntry[];  // ← 替代 localeNls 扁平表
  activeLocale: string;       // ← 当前显示/编辑的 locale
}

/** CaaDialogNode.nls 指向当前活跃 locale 的数据 */
// 各 locale 的完整 NLS 数据存在 node._localeNls?: Record<string, LocaleControlNls>
```

## 数据流

```
parse .CATNls (en)        parse .CATNls (zh)
      ↓                          ↓
LocaleControlNls tree     LocaleControlNls tree
      ↓                          ↓
  node._localeNls["en"]   node._localeNls["zh"]
      ↓                          ↓
      └──────────┬───────────────┘
                 ↓
    切换语言：node.nls = node._localeNls[activeLocale]
                 ↓
    写 NLS：按 model 树 DFS 遍历 → emitCatNlsFile(flat)
```

## 切换语言流程

```
1. 用户切换 locale → ir.activeLocale = "zh"
2. walk tree: node.nls = node._localeNls["zh"] ?? 空
3. UI 即时反映新语言文本
```

## 写 NLS 流程

```
1. 确保当前编辑的 locale 已写回 _localeNls[activeLocale]
2. 遍历 _localeNls 中每个 dirty 的 locale
3. 对每个 locale：collectNlsFlat(root, locale) → emitCatNlsFile(flat)
4. 写入对应 .CATNls 文件
```

## 待确定

- `_localeNls` 放在 node 上还是独立索引表？
- 新建 locale 时的默认值策略（空字符串 vs 复制主 locale）
- NLS key 格式是否需要调整（当前 `RootId.ChildId...Prop`）

## 与当前迭代的关系

当前迭代首先让 `.CATDlg` 保存工作（`emitCatDlg`），NLS 多语言模型重构在后续迭代进行。
