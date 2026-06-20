# FileWorkset（文件工作集）— 系统模块

> **壳层系统能力**：为 CAD / Code 等各业务模块提供统一的「文件 path 集合」归集与跨页执行支撑。  
> 流程：**发现 → 归集 → 跨页执行**。

最后更新：2026-06-20

---

## 1. 定位

| 层级 | 职责 |
| --- | --- |
| **发现** | 工作空间树、Code/CAD 索引、各页扫描结果 |
| **归集（本模块）** | 命名工作集、活动集、`phoenix-workspace.sqlite` 内 `phoenix_workset*` |
| **执行** | 各模块工具页通过 `scope` / `repo_rel_paths` 消费工作集 |

不属于 CAD 或 Code 子模块；API 为 `/api/file-worksets`，侧栏 **工作集** Tab 在双模块下均可见。

---

## 2. 数据

```ts
interface FileWorkset {
  id: string;
  name: string;
  paths: string[];       // repo_rel_path
  source?: string;
  updated_at: string;
}
```

**SQLite（与 CAD/Code 同库）**

| 表 | 说明 |
| --- | --- |
| `phoenix_workset` | 工作集元数据（id、name、source、updated_at） |
| `phoenix_workset_path` | path 明细（workset_id + repo_rel_path） |

- 工作集 → **`phoenix-workspace.sqlite`** 表 `phoenix_workset` / `phoenix_workset_path`（旧 `file-worksets.json` 首次打开可自动导入）
- **活动工作集**、各页 `worksetId` → 浏览器 localStorage（按工作空间）

---

## 3. API

| 方法 | 路径 |
| --- | --- |
| GET | `/api/file-worksets` |
| PUT | `/api/file-worksets` `{ worksets: [...] }` |

模块扩展：请求体增加 `repo_rel_paths?: string[]`（UUID 扫描已支持；改名/转码/CAD 批量待接）。

---

## 4. 前端（壳层）

| 组件 / Store | 说明 |
| --- | --- |
| `stores/fileWorksets.ts` | 工作集 CRUD + 各页 scope 偏好 |
| `composables/useWorksetPageScope.ts` | 页面接入：`buildPathScopeBody()` |
| `FileWorksetPanel.vue` | 侧栏工作集 Tab |
| `WorksetScopePicker.vue` | 工具页范围选择（可隐藏「Code 索引」项） |

入口：索引/树 → **加入当前工作集**；Ribbon「开始」→ 打开工作集侧栏。

---

## 5. 模块接入约定

1. 页面声明 `pageId`（如 `code_uuid`），用 `useWorksetPageScope(pageId)` 读写偏好。
2. 扫描/执行 API 优先 `repo_rel_paths`，其次 `scope` / `use_index_scope`。
3. CAD 页可不显示「Code 索引 present」选项（`show-index-scope=false`）。

---

## 6. 分期

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| A | API + store + 侧栏 Tab | **已完成** |
| B | 索引/树 → 加入工作集 | **已完成** |
| C | Code UUID · WorksetScopePicker | **已完成** |
| D | 改名、转码、CAD 批量 | 待做 |
| E | Saved Query 物化 | 待做 |
