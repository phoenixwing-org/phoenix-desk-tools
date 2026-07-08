# Python 后端 → Node.js + Rust 迁移计划

> 策略：新增 `cad-rust` 模块（`cr_` 前缀页面），与 Python CAD 模块并行共存。
> 用户对比测试通过后，去掉 Python 后端和旧 CAD 模块。

## 1. 总体策略

### 1.1 三模块架构

```
phoenix-desk-tools/
├── Python 后端（保留）     → 旧 CAD 模块 (module: "cad")
├── Node.js 后端 (server/)  → CAA 模块 + 新 CAD-Rust 模块 (module: "cad-rust")
└── Code 模块               → 暂不迁移
```

### 1.2 迁移分配原则

| 类型 | 目标 | 理由 |
|------|------|------|
| **文件 I/O + 算法** | Rust (napi-rs / CLI) | 性能、零依赖、跨平台 |
| **SQLite 数据库** | TypeScript (node-sqlite3-wasm → phoenix-wing PnwDbAdapter) | 已有封装、零编译 |
| **HTTP 路由** | TypeScript (Hono) | 已有 server/ 基础设施 |
| **Subprocess** | TypeScript (调用 freecadcmd/git CLI) | Node.js child_process 成熟 |

### 1.3 命名约定

新增 `cad-rust` 模块页面：`cr_` 前缀，标签加 `CR ` 前缀。

| 旧 CAD (Python) | 新 CAD-Rust (Node.js) |
|-----------------|----------------------|
| page: `fcstd_map`, label: `CAD 索引` | page: `cr_fcstd_map`, label: `CR 索引` |
| page: `bom_export`, label: `BOM 列表` | page: `cr_bom_export`, label: `CR BOM列表` |
| page: `part_catalog`, label: `零件目录` | page: `cr_part_catalog`, label: `CR 零件` |
| module: `cad`, ribbon: `CAD` | module: `cad-rust`, ribbon: `CAD-Rust` |

## 2. Python 模块 → Rust/TypeScript 分配

### 2.1 → Rust（文件 I/O + 纯算法）

| Python 模块 | 行数 | 功能 | Rust 新 crate |
|------------|------|------|--------------|
| `fcstd-reader` (已有) | ~400 | FCStd ZIP→XML 解析 | `server/fcstd-reader/` ✅ 已有 |
| `fcstd_document_kind.py` | ~150 | 文档类型分类 | 并入 fcstd-reader |
| `fcstd_document_bom_props.py` | ~350 | Document.xml BOM 属性读写 | 并入 fcstd-reader |
| `fcstd_drawing_bom.py` | ~200 | 图纸 BOM 解析 | 并入 fcstd-reader |
| `fcstd_embedded_attrs.py` | ~120 | 嵌入式属性读写 | 并入 fcstd-reader |
| `bom_xref/extract.py` | ~80 | XLink 属性提取 | 并入 fcstd-reader |
| `rename_analysis/xlink.py` | ~600 | XLink 属性修改 | 新 crate `fcstd-xlink` |
| `cad_index_types.py` | ~50 | 类型判断（纯函数） | 并入 fcstd-reader |
| `part_naming.py` | ~100 | 零件号解析（纯函数） | 并入 fcstd-reader |
| `cad_index/bom_compute.py` | ~200 | BOM 森林构建（纯算法） | **→ TypeScript**（数据驱动简单） |

### 2.2 → TypeScript（SQLite 数据库访问）

| Python 模块 | 行数 | 功能 | TS 文件 |
|------------|------|------|--------|
| `phoenix_store.py` | ~2300 | 全部 SQLite CRUD | `server/src/routes/cad-queries.ts` |
| `phoenix_schema.py` | ~200 | 数据库 Schema | 仅读不改（Python 维护 Schema） |
| `cad_index/scan_store.py` | ~150 | 扫描持久化 | `server/src/routes/cad-queries.ts` |
| `cad_index/bom_xref_index.py` | ~500 | BOM xref 索引构建 | `server/src/routes/cad-xref.ts` |
| `cad_index/context.py` | ~80 | xref 上下文加载 | `server/src/routes/cad-queries.ts` |
| `code/store.py` | ~100 | Code 索引 CRUD | `server/src/routes/code-queries.ts` |

### 2.3 → TypeScript（HTTP 路由 + 编排）

| Python 模块 | 功能 | TS 文件 |
|------------|------|--------|
| `web/app.py` BOM 端点 | `/api/bom`, `/api/bom/prefs` 等 | `server/src/routes/cad.ts` (已有) |
| `web/app.py` xref 端点 | `/api/bom-xrefs/*` | `server/src/routes/cad-xref.ts` |
| `web/app.py` scan 端点 | CAD 索引扫描 | `server/src/routes/cad-scan.ts` |
| `bom_apply_service.py` | BOM 属性回写 | `server/src/routes/cad-apply.ts` |
| `bom_xref_service.py` | 引用关系查询 | `server/src/routes/cad-xref.ts` |
| `fcstd_map_service.py` | 扫描编排 | `server/src/routes/cad-scan.ts` |
| `part_key_service.py` | 零件号管理 | `server/src/routes/cad-parts.ts` |

### 2.4 暂不迁移（需外部工具或极复杂）

| 模块 | 原因 |
|------|------|
| `step_batch_service.py` | 依赖 freecadcmd（保留 Python 或独立脚本） |
| `sw_step_export_service.py` | Windows-only COM（保留 Python） |
| `code/reorder_members.py` (1900行) | C++ 解析极其复杂（最后迁移） |
| `service_manager.py` | 平台进程管理（用 Node.js pm2 或保留） |
| `unit_test_service.py` | Python 进程内测试（保留） |
| `shell/app.py` | CustomTkinter 壳（Tauri 替代时删除） |

## 3. 分阶段实施

### Phase 1：CAD-Rust 模块 BOM 查看（1-2 页）

**目标**：最小可用，证明架构可行。

```
server/src/routes/cad.ts    ← 已有（代理 Python /api/bom）
                              ↓ 改为：直接调 Rust CLI + TS SQLite
web-ui/src/pages/
  CadBomViewerPage.vue       ← 已有（cr_bom_viewer）
  CrFcstdMapPage.vue         ← 新增（1:1 镜像 FcstdMapPage）
```

**技术栈**：
- Rust: `fcstd-reader` 读 FCStd ZIP→XML（修复 FreeCAD 1.x 格式）
- TS SQLite: 查 `phoenix_cad_file_asset`，替换代理为直接查询
- Hono: `/api/cad/bom/file`, `/api/cad/bom/xref`

**验证**：
- 打开 CR 索引页 → 扫描工作空间 → 显示 FCStd 列表
- 打开 CR BOM 页 → 选择文件 → 显示 BOM 行
- 与 Python 版对比数据一致

### Phase 2：BOM 全套迁移（4-5 页）

**新增页面**：`cr_bom_export`, `cr_part_catalog`, `cr_file_detail`

```
server/src/routes/
  cad.ts          ← BOM 预览 + 回写
  cad-xref.ts     ← xref 引用查询
  cad-parts.ts    ← 零件号管理
  cad-queries.ts  ← SQLite 共享查询
```

**技术栈**：
- Rust: `fcstd-reader` 完善（BOM 属性读写、XLink 提取）
- TS SQLite: `phoenix_store.py` 全量迁移到 `cad-queries.ts`
- Hono: 迁移 `/api/bom*`, `/api/bom-xrefs*`, `/api/part-key*`

### Phase 3：CAD 索引 + 改名（6-8 页）

**新增页面**：`cr_xlink_fix`, `cr_file_rename`, `cr_part_dedup`

```
server/src/routes/
  cad-scan.ts     ← 工作空间扫描
  cad-apply.ts    ← BOM 属性回写
  cad-rename.ts   ← 文件改名 + 引用修复
```

**技术栈**：
- Rust: `fcstd-xlink` crate（XLink 修改）
- TS: 扫描编排、改名逻辑

### Phase 4：Code 模块 + 去 Python

**新增页面**：Code 模块页面（`cn_` 前缀）
**最终**：用户验证通过，删除 Python 后端 + 旧 CAD/Code 模块

## 4. 页面命名清单

| Python 页面 (旧) | Node.js 页面 (新) | 所属 Phase |
|-----------------|------------------|-----------|
| `fcstd_map` | `cr_fcstd_map` | 1 |
| `cad_bom_viewer` | 已有 | 1 |
| `bom_export` | `cr_bom_export` | 2 |
| `part_catalog` | `cr_part_catalog` | 2 |
| `bom_apply` (file_detail) | `cr_file_detail` | 2 |
| `part_key_detail` | `cr_part_key_detail` | 2 |
| `xlink_fix` | `cr_xlink_fix` | 3 |
| `file_rename` | `cr_file_rename` | 3 |
| `part_dedup` | `cr_part_dedup` | 3 |
| `step_batch` | 保留 Python | — |
| `sw_step_export` | 保留 Python (Win only) | — |

**注册点**（每个页面 3 处）：
1. `phoenix/config/app_config.json` — navigation + ribbonGroup + page_context_config
2. `web-ui/src/layout/AppShell.vue` — `PAGE_COMPONENTS` 映射
3. `web-ui/src/layout/ribbon/ribbonConfig.ts` — 不需要！(已改为 JSON 驱动)

## 5. Rust crate 规划

```
server/
├── fcstd-reader/          ✅ 已有 (ZIP→XML 解析)
│   TODO: 适配 FreeCAD 1.x Objects/Object + ObjectData/Object 结构
├── fcstd-xlink/           🆕 Phase 2 (XLink 属性修改)
└── cli/                   ✅ 已有 (fcstd-read 命令)
```

### fcstd-reader 待完成

- [ ] 支持 FreeCAD 1.x XML 格式（`<Objects/Object type="...">` + `<ObjectData/Object name="...">`）
- [ ] 提取 BOM 属性（PartNumber, PartVersion, TypeCode, ModelSeries, PartName, Label）
- [ ] 提取 XLink 引用
- [ ] 提取 Group 层级结构
- [ ] 提取 Placement (XYZ)
- [ ] 提取 Material

### fcstd-xlink (新) 功能

- [ ] 读取 XLink `file` 属性
- [ ] 修改 XLink `file` 属性
- [ ] 修改 Reference Label
- [ ] 解析 Document.xml 中 XLink 段落

## 6. 关键决策

| 决定 | 理由 |
|------|------|
| `cr_` 前缀命名 | 不与旧 CAD 页面 ID 冲突，两套并行 |
| SQLite 用 TS 不用 Rust | `phoenix-wing/db/pnwDbAdapter` 已有，跨平台零编译 |
| BOM 森林计算 → TS | 数据量小（<10000 行），纯数据操作，非性能瓶颈 |
| FCStd XML 解析 → Rust | 文件 I/O 密集型，ZIP+XML 解析 Rust 比 Python 快 5-10x |
| step_batch 保留 Python | 依赖 freecadcmd，迁移无收益 |
| 不创建新 ribbon tab | `module: "cad-rust"` 已自动生成 Ribbon tab（JSON 驱动） |
