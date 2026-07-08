# pnwCadDb 数据库封装计划

> 目标：替代 Python SQLite 访问，提供统一的 TS 查询接口。
> `pnw-` 前缀 = Phoenix Wing，未来可拆到 phoenix-wing 包。

## 1. 现状

```
Python (FastAPI)          Node.js (Hono)           Rust
    │                         │                     │
    ├─ SQLite ───────────────┼─────────────────────┤
    │  (aiosqlite)            │                     │
    │                         │  pnwCadDb.ts ──────→ fcstd-query (rusqlite)
    │                         │                     │
    ▼                         ▼                     ▼
  /api/bom                  /api/cad/*            JSON stdout
```

- **Python**：`phoenix_store.py`（2300行）直接操作 SQLite
- **Node.js**：`pnwCadDb.ts` 调 Rust CLI → JSON
- **Rust**：`fcstd-query` 用 rusqlite bundled 编译

## 2. 近期目标（当前 tauri 分支）

### 2.1 完成 pnwCadDb 查询接口

```
server/src/lib/pnwCadDb.ts        ← TS 封装层（可拆到 phoenix-wing）
server/fcstd-query/src/main.rs    ← Rust CLI（rusqlite）
```

**已实现**：

| 函数 | Rust 命令 | 查询表 |
|------|----------|--------|
| `pnwQueryParts(ws, opts)` | `fcstd-query parts` | `phoenix_cad_part_key` |
| `pnwQueryFcstdMap(ws, opts)` | `fcstd-query fcstd-map` | `phoenix_cad_file_asset` |
| `pnwQueryBomHosts(ws)` | `fcstd-query bom-xref-meta` | `phoenix_cad_bom_xref` |
| `pnwQueryBomFile(ws, rel)` | `fcstd-query bom-file` | `phoenix_cad_file_asset` |

**待实现**：

| 函数 | Rust 命令 | 用途 |
|------|----------|------|
| `pnwQueryXrefIncoming(ws, rel)` | `fcstd-query bom-xref-incoming` | 被引用列表 |
| `pnwQueryXrefOutgoing(ws, rel)` | `fcstd-query bom-xref-outgoing` | 引用列表 |
| `pnwQueryXrefCounts(ws, rel)` | `fcstd-query bom-xref-counts` | 引用计数 |
| `pnwQueryAssemblyTree(ws, rel)` | `fcstd-query assembly-tree` | 装配树 |
| `pnwQueryScanProgress(ws)` | `fcstd-query scan-progress` | 扫描进度 |

### 2.2 cad.ts 路由全面切换

- [ ] `/api/cad/bom/file` → `pnwQueryBomFile` ✅
- [ ] `/api/cad/parts` → `pnwQueryParts` ✅
- [ ] `/api/cad/fcstd-map/entries` → `pnwQueryFcstdMap` ✅
- [ ] `/api/cad/bom/xref/meta` → `pnwQueryBomHosts` ✅
- [ ] `/api/cad/bom/xref/incoming` → `pnwQueryXrefIncoming` ⬜
- [ ] `/api/cad/bom/xref/outgoing` → `pnwQueryXrefOutgoing` ⬜
- [ ] `/api/cad/bom/xref/counts` → `pnwQueryXrefCounts` ⬜
- [ ] `/api/cad/bom/xref/assembly-tree` → `pnwQueryAssemblyTree` ⬜

### 2.3 前端页面全部原生

- [ ] CrPartCatalogPage → 原生 Rust ✅
- [ ] CrFcstdMapPage → 原生 Rust ✅
- [ ] CrBomExportPage → 原生 Rust ⬜
- [ ] CadBomViewerPage → 原生 Rust ⬜

## 3. 中期目标（拆到 phoenix-wing）

### 3.1 目录结构

```
phoenix-wing/src/db/
├── pnwDbAdapter.ts        ← 已有（node-sqlite3-wasm 封装）
├── pnwDbAdapter.test.ts   ← 已有
├── pnwCadDb.ts            ← 🆕 从 server/src/lib/ 移入
└── pnwCadDb.test.ts       ← 🆕 单元测试
```

### 3.2 pnwCadDb 双后端策略

```typescript
// pnwCadDb.ts — 自动选择后端
export async function pnwQueryParts(workspace: string, opts?) {
  // 1. 优先：node-sqlite3-wasm（小数据库 / 新数据库）
  if (canUseWasm(workspace)) {
    const db = pnwCreateDb(pnwCadDbPath(workspace));
    return db.all("SELECT ... FROM phoenix_cad_part_key ...");
  }
  // 2. 降级：Rust CLI（大数据库 / WASM 不支持）
  return pnwExecRust(["parts", pnwCadDbPath(workspace), ...]);
}
```

统一接口，自动选择最佳后端。上层调用者无感知。

### 3.3 发布

- `phoenix-wing` npm 包包含 `pnwCadDb`
- `server/` 依赖 `phoenix-wing/db/pnwCadDb`
- `fcstd-query` Rust 二进制作为 optional sidecar

## 4. 远期目标（去 Rust CLI）

### 4.1 前提条件

Rust CLI 是临时方案。以下条件之一满足即可去掉：

1. **node-sqlite3-wasm 支持大文件**（上游修复 WASM 内存限制）
2. **Node.js 内置 `node:sqlite` 稳定**（Node 22.5+ experimental → 24 LTS）
3. **phoenix-desk-tools 要求 Node ≥ 24**

### 4.2 迁移路径

```
当前                         近期                    远期
Rust rusqlite (CLI)  →  pnwCadDb (TS 封装)  →  node:sqlite (Node 24+)
                              │
                    phoenix-wing/db/pnwCadDb.ts
                    （统一接口，后端可替换）
```

### 4.3 Rust fcstd-query 的归宿

- `fcstd-query` 保留作为 fallback（Node < 24 的环境）
- 或完全删除（当所有环境都支持 node:sqlite）
- `fcstd-reader` 保留（FCStd 文件解析是 Rust 的独特能力）

## 5. 接口规范

### 5.1 命名约定

| 前缀 | 含义 | 示例 |
|------|------|------|
| `pnwQuery` | 查询（只读） | `pnwQueryParts` |
| `pnwMutate` | 变更（读写） | `pnwMutateBomApply`（远期） |
| `pnwExec` | 内部底层 | `pnwExec(args)` |
| `pnwCadDb` | 模块/路径 | `pnwCadDbPath(ws)` |

### 5.2 错误处理

```typescript
// pnwCadDb 所有函数：
// - 成功：返回类型化数据
// - 失败：throw Error（调用方决定降级策略）
// - 不返回 null（用 try/catch 判断）
```

### 5.3 Workspace 参数

所有函数第一个参数是 `workspace: string`（工作空间绝对路径），统一使用 `pnwCadDbPath(ws)` 推导数据库路径。
