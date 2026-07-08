# API 接口兼容规则

> **规则**: 前端接口格式不能动。所有 Node.js 端点返回格式必须与 Python 原版 100% 一致。
> **转换**: Rust snake_case → Python PascalCase，统一由 `pnwApiAdapter.ts` 处理。

## 字段映射规则

| Rust (fcstd-query) | Python/Frontend | 说明 |
|-------------------|-----------------|------|
| `part_number` | `PartNumber` | PascalCase |
| `part_version` | `PartVersion` | PascalCase |
| `type_code` | `TypeCode` | PascalCase + UPPER |
| `model_series` | `ModelSeries` | PascalCase + UPPER |
| `part_name` | `PartName` | PascalCase |
| `repo_rel_path` | `repo_rel_path` | snake_case 不变 |
| `file_status` | `file_status` | snake_case 不变 |

## 端点对照表

| 状态 | Python 端点 | Node.js 端点 | 返回格式 |
|------|-----------|-------------|---------|
| ✅ | `GET /api/fcstd-map/entries` | 同 | `{offset,limit,total,count,entries:FcstdMapEntry[],debug_sql}` |
| ✅ | `POST /api/fcstd-map/scan` | 同 | `{exists,stats,entries,scan_log,...}` |
| ✅ | `GET /api/fcstd-map` | 同 | loadFcstdMapPayload 格式 |
| ✅ | `GET /api/bom` | `/api/cad/bom/file` | BomPreview 格式 |
| ✅ | `GET /api/bom-xrefs/meta` | `/api/cad/bom/xref/meta` | `{hosts:BomHost[]}` |
| ✅ | `GET /api/bom-xrefs/incoming` | 同 | `{items:XrefRow[]}` |
| ✅ | `GET /api/bom-xrefs/outgoing` | 同 | `{items:XrefRow[]}` |
| ✅ | `GET /api/bom-xrefs/counts` | 同 | `{incoming,outgoing,flat_lines}` |
| ✅ | `GET /api/part-keys` | `/api/cad/parts` | `{items:PartKeyEntry[]}` |
| ✅ | `GET /api/part-keys/:pn/:pv` | `/api/cad/parts/:pn/:pv` | PartKeyDetail |
| 🟡 | `PUT /api/bom` | `/api/cad/bom/file` | stub |
| 🟡 | `POST /api/fcstd-map/scan/start` | 同 | 扫描进度 |
| 🟡 | `GET /api/xlink-fix/*` | 同 | stub |
| 🟡 | `GET /api/rename-analysis/*` | 同 | stub |
| 🟡 | `GET /api/part-dedup/*` | 同 | stub |
| 🟡 | `POST /api/step-batch/*` | 同 | stub |
| 🟡 | `POST /api/sw-step/*` | 同 | stub |

## 已验证接口（格式与 Python 一致）

- `GET /api/cad/fcstd-map/entries` — ✅ 使用 entryToApiDict 转换
- `GET /api/cad/parts` — ✅ 使用 toPartKeyEntry 转换
- `GET /api/cad/bom/xref/meta` — ✅ 使用 toBomHost 转换
- `GET /api/cad/bom/file` — ✅ 使用 pnwApiAdapter

## 待验证接口

- `GET /api/cad/bom/tree` — 需确认 bom_path/depth/part_key 字段
- `GET /api/cad/bom/xref/incoming` — 需确认 host_repo_rel_path 字段
- `PUT /api/cad/bom/file` — BOM 回写格式

## 命名规则

- **`pdt`** (phoenix desk tools) — 本项目专有前缀，用于所有新建 TS 模块
- **`pnw`** (phoenix wing) — 旧前缀，计划迁移。已有文件加 `// TODO: pnw → pdt`

```typescript
// ✅ 新文件
pdtCadDb.ts       // 数据库查询封装
pdtCadTypes.ts    // CAD 类型定义

// ⬜ 旧文件（待改名）
pnwCadDb.ts       // TODO: rename to pdtCadDb
pnwCadScan.ts     // TODO: rename to pdtCadScan
```
