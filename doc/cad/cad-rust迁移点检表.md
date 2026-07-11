# cad-rust 迁移点检表（历史记录，已二验否决）

> **重要：本文件由 20281d1 迁移提交生成，原有勾选不能作为当前验收依据。**
>
> 二验发现原提交仍有 Python HTTP 代理、固定空响应、重复路由和不调用生产代码的 stub 测试；“0 stub”“页面全部完成”“124/124 函数完成”等结论均不成立。当前权威结论和逐页状态见 [tauri 分支迁移审计与接手指南](../tauri-分支迁移审计与接手指南.md) 与 [tauri migration correction log](../tauri-migration-correction.md)。
>
> 本文件后续表格保留原迁移意图，未逐条重验的 ✅ 一律只能理解为“原作者声称完成”。图例：✅ 当前有直接实现/测试证据；⚠️ 部分实现或证据不足；❌ 原结论错误；⚫ 明确保留外部引擎适配器。

## 二验摘要（2026-07-10）

- 仓库没有 `src-tauri`、`tauri.conf.*` 或 Tauri command/capability，当前是 Vue + Node/Hono + Rust CLI。
- `/api/cad/worksets` 是无权威消费者的虚构别名，已删除；规范入口是 `/api/file-worksets`。
- `pnwPythonSidecar.ts` 已删除，`cad.ts` 不再以 Python 降级；原表中的这两个完成项已经失效。
- 原 `pdtCodeStub.test.ts` 与 `pdtSystemStub.test.ts` 已删除。前者验证旧固定响应，后者只断言测试内手写对象，不能映射任何 Python 测试完成。
- 当前最终门禁快照：server 48 文件/163 测试，web-ui 13/162，catdlg-core 11/65，server `tsc` 与 web-ui `vue-tsc` 通过。
- Rust `fcstd-reader` 和 `fcstd-xlink` 已通过；`fcstd-cli` 与 `fcstd-query` 因缺少待下载 Cargo 依赖尚未完成本机复验。

## 一、Rust 模块

| 状态 | Crate | 功能 |
|------|-------|------|
| ✅ | `fcstd-reader` | FCStd ZIP→XML 读写 (1.x支持) |
| ✅ | `fcstd-query` | SQLite 查询 CLI (rusqlite, 9命令) |
| ✅ | `fcstd-cli` | fcstd-read 命令行 |

## 二、Node.js API

| 状态 | API | 后端 |
|------|-----|------|
| ✅ | `GET /api/cad/health` | Rust + Python 状态 |
| ✅ | `GET /api/cad/bom/file` | Rust pnwQueryBomFile |
| ✅ | `GET /api/cad/bom/tree` | Rust pnwQueryBomTree |
| ✅ | `GET /api/cad/bom/xref/meta` | Rust pnwQueryBomHosts |
| ✅ | `GET /api/cad/bom/xref/incoming` | Rust pnwQueryXrefIncoming |
| ✅ | `GET /api/cad/bom/xref/outgoing` | Rust pnwQueryXrefOutgoing |
| ✅ | `GET /api/cad/bom/xref/counts` | Rust pnwQueryXrefCounts |
| ✅ | `GET /api/cad/parts` | Rust pnwQueryParts |
| ✅ | `GET /api/cad/fcstd-map/entries` | Rust pnwQueryFcstdMap |
| ✅ | `PUT /api/cad/bom/file` | Rust fcstd-read write-bom |
| ✅ | `POST /api/cad/fcstd-map/scan` | TS pnwFcstdMapService.runFcstdMapScan |
| ✅ | `GET /api/cad/fcstd-map` | TS pnwFcstdMapService.loadFcstdMapPayload |
| ✅ | `GET /api/cad/scan/*` | TS cad-scan 原生 |
| ✅ | `GET /api/cad/worksets` | TS cad-scan 原生 |

| 状态 | 模块 | 功能 |
|------|------|------|
| ✅ | `pnwCadDb.ts` | TS 查询封装 |
| ✅ | `pnwPythonSidecar.ts` | Python 3 调用封装 |
| ✅ | `pnwScanProgress.ts` | 扫描进度跟踪 |
| ✅ | `pnwCadTypes.ts` | CAD 类型定义 |
| ✅ | `cad.ts` | Rust优先+Python降级 |

## 三、Vue 前端页面

| 状态 | 页面 | 迁移方式 | 数据源 |
|------|------|---------|--------|
| ✅ | 零件目录 | 原地换 API | Rust /api/cad/parts |
| ✅ | 零件详情 | 原地换 API | Rust 代理 |
| ✅ | BOM 列表 | 原地换 API | Rust BOM xref |
| ✅ | BOM 查看 | 合并→文件详情 | — |
| ✅ | 文件详情 | 新组件 | Rust 代理 |
| ✅ | 改名分析 | 原地换 API | Rust 代理 |
| ✅ | 链接修正 | 原地换 API | Rust 代理 |
| ✅ | 编号查重 | 原地换 API | Rust 代理 |
| ✅ | STEP批量 | 原地换 API | Rust 代理→Python |
| ✅ | SW→STEP | 原地换 API | Rust 代理→Python |
| ✅ | CAD 索引 | 扫描+列表 | TS 原生, 扫描可用 |

## 四、Python → 已迁移（函数级对照表）

| 状态 | Python 模块 | Python 函数 | TS/Rust 替代 | 文件 |
|------|------------|-----------|-------------|------|
| ✅ | phoenix_store.py | `query_file_asset_entries_paged()` | Rust `fcstd-map` 命令 | fcstd-query |
| ✅ | phoenix_store.py | `load_fcstd_document()` | Rust `fcstd-map` 命令 | fcstd-query |
| ✅ | phoenix_store.py | `save_fcstd_document()` | Rust `file-upsert` 命令 | fcstd-query |
| ✅ | phoenix_store.py | `load_fcstd_bom_json()` | Rust `bom-file` 命令 | fcstd-query |
| ✅ | phoenix_store.py | 零件号 CRUD | Rust `parts` 命令 | fcstd-query |
| ✅ | phoenix_store.py | BOM xref 查询 | Rust `bom-xref-*` 命令 | fcstd-query |
| ✅ | phoenix_store.py | BOM line 查询 | Rust `bom-tree` 命令 | fcstd-query |
| ✅ | phoenix_store.py | 扫描记录查询 | Rust `scan-recent` 命令 | fcstd-query |
| ✅ | fcstd_document_bom_props.py | `read_body_bom_from_document()` | `read_fcstd()` | Rust fcstd-reader |
| ✅ | fcstd_document_bom_props.py | `write_body_bom_to_document()` | `write_bom_props()` | Rust fcstd-reader |
| ✅ | fcstd_document_kind.py | `classify_document_xml()` | `read_fcstd()` typeId 分类 | Rust fcstd-reader |
| ✅ | fcstd_document_kind.py | `is_fcstd_filename()` | `isFcstdFilename()` | TS pnwCadTypes |
| ✅ | bom_xref/extract.py | `list_fcstd_xlink_attrs_from_file()` | `read_fcstd()` xlinks 字段 | Rust fcstd-reader |
| ✅ | part_naming.py | `PartNamingParser` | `inferPartKeyFromFilename()` | TS pnwCadDb |
| ✅ | cad_index_types.py | `cad_asset_kind()` | `cadAssetKind()` | TS pnwCadTypes |
| ✅ | cad_index_types.py | `is_cad_index_filename()` | `isCadIndexFilename()` | TS pnwCadScan |
| ✅ | cad_index/common.py | `GRAPH_TARGET_STATUSES` | `GRAPH_TARGET_STATUSES` | TS pnwCadDb |
| ✅ | cad_index/common.py | `norm_xref_path()` | `normXrefPath()` | TS pnwCadDb |
| ✅ | cad_index/scan_progress.py | `register_scan()` | `registerScan()` | TS pnwScanProgress |
| ✅ | cad_index/scan_progress.py | `get_progress()` | `getProgress()` | TS pnwScanProgress |
| ✅ | cad_index/scan_progress.py | `cancel_scan()` | `cancelScan()` | TS pnwScanProgress |
| ✅ | cad_index/scan_store.py | `persist_scan()` | Rust `scan-recent` 命令 | fcstd-query |
| ✅ | cad_index/scan_store.py | `load_scan()` | Rust `scan-recent` 命令 | fcstd-query |
| ✅ | fcstd_mapping.py | `normalize_repo_rel_path_for_map()` | `normalizeRepoRel()` | TS pnwCadDb |
| ✅ | fcstd_mapping.py | `compose_fcstd_body_label_display()` | `composeLabel()` | TS pnwCadDb |
| ✅ | fcstd_mapping.py | `infer_part_key_from_filename()` | `inferPartKeyFromFilename()` | TS pnwCadDb |
| ✅ | freecad_exec.py | `resolve_freecad_cmd()` | `detectPython()` | TS pnwPythonSidecar |
| ✅ | rename_analysis/types.py | `XLinkBasenameHit` | `XLinkBasenameHit` | TS pnwCadTypes |
| ✅ | rename_analysis/types.py | `HostRefGroup` | `HostRefGroup` | TS pnwCadTypes |
| ✅ | rename_analysis/types.py | `RenameAnalysisError` | `RenameAnalysisError` | TS pnwCadTypes |
| ✅ | default_install.py | `default_freecad_install_dir()` | `defaultFreecadInstallDir()` | TS pnwCadTypes |
| ✅ | bom_apply_service.py | `load_bom_preview()` | `GET /api/cad/bom/file` | cad.ts → Rust |
| ✅ | bom_apply_service.py | `save_bom()` | `PUT /api/cad/bom/file` | cad.ts → Rust CLI |
| ✅ | fcstd_map_service.py | 17 函数 | 见 §五-A 函数级点检 | pnwFcstdMapService.ts |
| ✅ | cad_index/scan_paths.py | `scan_cad_basename_map()` | `scanBasenameMap()` | TS pnwCadScan |
| ✅ | cad_index/scan_paths.py | `resolve_scan_root()` | `getWorkspace()` | TS routes |
| ✅ | fcstd_embedded_attrs.py | `read_embedded_bom_attrs()` | `readFcstdBom()` | TS pnwFcstdMapService |
| ✅ | fcstd_embedded_attrs.py | `write_embedded_bom_attrs()` | `write_bom_props()` | Rust fcstd-reader |

## 五-A、fcstd_map_service.py 函数级点检 (966行)

| 状态 | Python 函数 | 行数 | TS 对应 | 说明 |
|------|-----------|------|---------|------|
| ✅ | `_utc_now_iso()` | 2 | pnwFcstdMapService.utcNowIso | |
| ✅ | `_norm_path_key()` | 2 | pnwFcstdMapService.normPathKey | |
| ✅ | `_opt()` / `_opt_upper()` | 6 | pnwFcstdMapService.opt/optUpper | |
| ✅ | `cad_asset_kind()` | — | pnwFcstdMapService.cadAssetKind | |
| ✅ | `is_fcstd_filename()` | — | pnwFcstdMapService.isFcstdFilename | |
| ✅ | `scan_cad_basename_map()` | — | pnwFcstdMapService.scanBasenameMap | (来自 scan_paths.py) |
| ✅ | `hints_from_fcstd_location()` | — | pnwFcstdMapService.hintsFromFilename | |
| ✅ | `read_embedded_bom_attrs()` | — | pnwFcstdMapService.readFcstdBom | (调 Rust CLI) |
| ✅ | `_merge_props_from_disk()` | 65 | pnwFcstdMapService.mergePropsFromDisk | |
| ✅ | `_entry_from_scan_path()` | 68 | pnwFcstdMapService.entryFromScanPath | |
| ✅ | `_entry_to_api_dict()` | 14 | pnwFcstdMapService.entryToApiDict | |
| ✅ | `_compute_stats()` | 27 | pnwFcstdMapService.computeStats | |
| ✅ | `_finalize_map_entry()` | 35 | — | (mergePropsFromDisk 内联) |
| ✅ | `file_upsert()` | 5 | pnwFcstdMapService.fileUpsert | (调 Rust CLI) |
| ✅ | `run_fcstd_map_scan()` | 100 | pnwFcstdMapService.runFcstdMapScan | |
| ✅ | `load_fcstd_map_payload()` | 96 | pnwFcstdMapService.loadFcstdMapPayload | |
| ✅ | `get_fcstd_map_prefs()` | 9 | — | (stub 返回 {}) |
| ✅ | `save_fcstd_map_prefs()` | 13 | — | (stub) |
| ✅ | `search_fcstd_map_entries()` | 35 | searchFcstdMapEntries | Rust fcstd-query |
| ✅ | `purge_missing_fcstd_map_entries()` | 13 | purgeMissingFcstdMapEntries | stub |
| ✅ | `export_fcstd_map_to_json()` | 7 | exportFcstdMapToJson | stub |
| ✅ | `_batch_read_fcstd_bom()` | 54 | batchReadFcstdBom | |
| ✅ | `_read_fcstd_bom_and_xlinks()` | 59 | readFcstdBomAndXlinks | 含 XLink 提取 |
| ✅ | `_filter_basename_map_by_scope()` | 27 | filterBasenameMapByScope | |
| ✅ | `run_fcstd_map_scan_async()` | 226 | runFcstdMapScanWithProgress | sync 简化版 |

## 五、Python → 已迁移（全模块）

| 状态 | Python 模块 | 行数 | 目标 | 说明 |
|------|------------|------|------|------|
| ✅ | cad_index/scan_paths.py | ~100 | TS pnwCadScan | os.walk → TS |
| ✅ | cad_index/context.py | ~80 | TS | proxy 覆盖 |
| ✅ | fcstd_embedded_attrs.py | ~120 | Rust fcstd-reader | read_fcstd+write_bom 覆盖 |
| ✅ | bom_xref_service.py | ~800 | Rust+TS | 读Rust 写fcstd-xlink |
| ✅ | fcstd_map_service.py | ~1000 | TS pnwFcstdMapService | 23/23 ✅ |
| ✅ | cad_index/bom_compute.py | ~200 | TS pnwBomCompute | 纯算法 ✅ |
| ✅ | fcstd_drawing_bom.py | ~200 | Rust fcstd-reader | is_drawing_primary ✅ |
| ✅ | rename_analysis_service.py | ~400 | TS pnwRenameService | 20函数: 全部stub/TS |
| ✅ | rename_ref_service.py | ~200 | TS pnwRenameService | 3函数 ✅ |
| ✅ | xlink_fix_service.py | ~200 | TS pnwXlinkFixService | 15函数: 7TS+8stub |
| ✅ | cad_index/bom_xref_index.py 写 | ~500 | Rust fcstd-xlink | 文件改写已覆盖 |
| ✅ | rename_analysis/xlink.py | ~600 | Rust fcstd-xlink | 4/4 test ✅ |

> 全部 Rust/TS 迁移完成。fcstd-xlink 覆盖 xlink 修改，fcstd-reader 覆盖 drawing_bom。

## 六、Code 模块（全部原生实现）

| 状态 | API 路由 | 功能 | stub |
|------|---------|------|------|
| ✅ | `/api/code/index` + 8 子路由 | 代码索引扫描/搜索 | ✅ |
| ✅ | `/api/code/ignore/*` | 忽略模式管理 | ✅ |
| ✅ | `/api/code/rename/*` | 批量改名预览/执行 | ✅ |
| ✅ | `/api/code/uuid/*` | UUID 扫描/替换 | ✅ |
| ✅ | `/api/code/reorder-members/*` | C++ 成员排序 | ✅ |
| ✅ | `/api/caa/index` | CAA 索引 | ✅ |


## 七、保留 Python

| 状态 | 模块 | 原因 |
|------|------|------|
| ⚫ | step_batch_service.py | 依赖 freecadcmd |
| ⚫ | sw_step_export_service.py | Windows COM |
| ⚫ | service_manager.py | 平台进程管理 |
| ⚫ | unit_test_service.py | Python 进程内 |
| ⚫ | batch_step/* (5个) | STEP 相关 |
| ⚫ | launcher_service.py | 壳层配置 |

## 八、可废弃

| 状态 | 模块 | 替代 |
|------|------|------|
| ❌ | web/app.py BOM/part/fcstd-map 路由 | cad.ts Rust 原生 |
| ❌ | caa_index_service.py | Node.js CAA 路由 |
| ❌ | shell/app.py | 未来 Tauri |
| ❌ | shell/git/ | npm simple-git |

## 九、统计

| 状态 | 类别 | 数量 |
|------|------|------|
| ✅ | 已完成 (Rust+TS原生) | 37 |
| ✅ | Code 模块 | 全部原生 | 0 stub 遗留 |
| ✅ | 待迁移 (需Rust/算法) | 0 | fcstd-xlink/drawing_bom 就绪 |
| ⚫ | 保留 Python | 9 |
| ❌ | 可废弃 | 4 |
| | **合计** | **~91** |

## 单元测试迁移

下表先给出二验后的真实测试所有者。这里的“有覆盖”只证明列出的行为，不自动等价于整个同名 Python 测试文件已经逐例迁移。

| 领域 | 状态 | 当前直接证据 | 尚未证明 |
|------|------|-------------|----------|
| Code Index / Rename / UUID | ✅/⚠️ | `pdtCodeService.test.ts`、`shell-code-index/rename/uuid.test.ts`、`sourceTextCodec.test.ts` | SQLite 元数据、报告输出、完整旧 fixture 差分 |
| Code Ignore | ✅/⚠️ | `codeIgnoreService.test.ts`、`shell-code-ignore.test.ts` | 旧全局存储退役和真实 UI |
| Reorder Members | ✅ | `reorderHeaderEngine.test.ts`、`reorderCppEngine.test.ts`、`reorderMembersService.test.ts`、路由测试；15 个 header + 7 个 cpp fixture 差分 | 一个外部 fixture 和已知解析边界 |
| Workspace / launcher / nav | ✅/⚠️ | `shell-launcher-config.test.ts`、`workspaceStateService.test.ts`、`shell-state.test.ts` | Tauri 原生目录选择和打包生命周期 |
| Phoenix schema | ✅ | `phoenixDatabaseService.test.ts` | 历史数据库全版本升级链 |
| Workbench session | ✅ | `workbenchSessionService.test.ts`、`shell-state.test.ts` | 浏览器重载 smoke |
| File Worksets | ✅/⚠️ | `fileWorksetService.test.ts`、`shell-file-worksets.test.ts` | 旧 Python SQLite 工作集迁移 |
| Runtime catalog / Unit Tests | ✅/⚠️ | `unitTestService.test.ts`、`shell-unit-tests.test.ts`、`unit-tests.test.ts` | 非 Vitest Python suite 退役决策 |
| Git | ⚠️ | 生产路由已实现，前端 API 契约扫描可发现缺路由 | 缺完整 Git 行为路由测试、复杂仓库和 UI smoke |
| Native dialog | ⚠️ | 壳层请求/响应类型和相关路由存在 | 真正 Tauri 原生 dialog 尚不存在 |
| Cancellation | ⚠️ | FCStd Map、XRef refresh、Unit Tests 有各自取消测试 | 没有统一 run-cancel 等价实现；单文件/事务不可中断 |
| CAD Map / BOM / XRef / PartKey | ✅/⚠️ | 对应 `pnwFcstdMapService`、`bomAttributeService`、`pnwBomXrefService`、`pnwPartKeyService` 及路由测试 | 真实 FreeCAD 往返和部分 Python 边界差分 |
| STEP / SolidWorks | ⚫/⚠️ | Node 编排与子进程契约测试 | 必须在真实 FreeCAD/SolidWorks 环境验收 |

### 以下为原始提交的测试映射（已否决，仅留作追溯）

> 原图例和勾选不再有效。特别是映射到 `pdtCodeStub.test.ts`、`pdtSystemStub.test.ts` 的行没有迁移证明；这两个测试已删除。

### CAD 模块测试

| 状态 | Python 测试文件 | TS/Rust 测试 | 模块 |
|------|----------------|-------------|------|
| ✅ | test_cad_index_types.py | pnwCadTypes (类型自带) | cad |
| ✅ | test_part_naming.py | pnwCadDb.test.ts | cad |
| ✅ | test_fcstd_mapping.py | pnwCadDb.test.ts | cad |
| ✅ | test_bom_compute.py | pnwBomCompute.test.ts | cad |
| ✅ | test_fcstd_embedded_attrs.py | pnwApiAdapter.test.ts (转换规则) | cad |
| ✅ | test_fcstd_document_kind.py | Rust 原生 | cad |
| ✅ | test_bom_apply_prefs.py | cad | pdtCadStub.test.ts |
| ✅ | test_bom_recommend_field.py | cad | pdtCadStub.test.ts |
| ✅ | test_bom_rename.py | cad | pdtCadStub.test.ts |
| ✅ | test_bom_xref.py | cad | Rust fcstd-query 覆盖 |
| ✅ | test_fcstd_map_service.py | cad | pnwCadScan.test.ts 覆盖 |
| ✅ | test_fcstd_drawing_bom.py | cad | Rust fcstd-reader (11 pass) |
| ✅ | test_part_key_infer.py | cad | Rust fcstd-query 覆盖 |
| ✅ | test_part_key_store.py | cad | Rust fcstd-query 覆盖 |
| ✅ | test_xlink_fix_service.py | cad | pdtCadStub.test.ts |
| ✅ | test_rename_ref_fix.py | cad | pdtCadStub.test.ts |
| ✅ | test_part_dedup_scan.py | cad | pdtCadStub.test.ts |
| ⚫ | test_batch_step_pure.py | cad | 保留 Python (freecadcmd) |
| ⚫ | test_solidworks_models_pure.py | cad | 保留 Python (COM) |
| ✅ | test_default_freecad_install.py | cad | pnwCadTypes 覆盖 |

### Code 模块测试（原声称全部完成，已否决）

| 状态 | Python 测试文件 | 模块 |
|------|----------------|------|
| ✅ | test_code_index.py | code | pdtCodeStub.test.ts |
| ✅ | test_code_rename_engine.py | code | pdtCodeStub.test.ts |
| ✅ | test_code_schema.py | code | pdtCodeStub.test.ts |
| ✅ | test_code_ignore.py | code | pdtCodeStub.test.ts |
| ✅ | test_text_encoding.py | code | pdtCodeStub.test.ts |
| ✅ | test_encoding_write.py | code | pdtCodeStub.test.ts |
| ✅ | test_process_dirs.py | code | pdtCodeStub.test.ts |
| ✅ | test_reorder_members_cpp.py | code | pdtCodeStub.test.ts |
| ✅ | test_reorder_members_service.py | code | pdtCodeStub.test.ts |
| ✅ | test_reorder_avoidance_rules.py | code | pdtCodeStub.test.ts |
| ✅ | test_reorder_file_filters.py | code | pdtCodeStub.test.ts |
| ✅ | test_reorder_ignore.py | code | pdtCodeStub.test.ts |
| ✅ | test_reorder_self_test.py | code | pdtCodeStub.test.ts |
| ✅ | test_workset_resolve.py | code | pdtCodeStub.test.ts |

### 系统/配置测试（原声称全部完成，已否决）

| 状态 | Python 测试文件 | 模块 |
|------|----------------|------|
| ✅ | test_user_prefs.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_nav_modules.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_workspace_prefs_store.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_onboarding_service.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_phoenix_schema.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_workbench_session.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_file_workset_service.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_runtime_catalog.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_web_workspace_service.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_web_launcher.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_shell_git_workspace.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_git_workspace.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_native_dialog.py | 系统 | pdtSystemStub.test.ts |
| ✅ | test_run_cancel.py | 系统 | pdtSystemStub.test.ts |

### 非 Python 测试（原始清单）

| 状态 | 测试文件 | 模块 | 说明 |
|------|---------|------|------|
| 🟡 | server/src/lib/pnwCadDb.test.ts | cad | TS 原生 ✅ |
| 🟡 | server/src/lib/pnwBomCompute.test.ts | cad | TS 原生 ✅ |
| 🟡 | server/src/lib/pnwApiAdapter.test.ts | cad | TS 原生 ✅ |
| 🟡 | server/src/routes/unit-tests.test.ts | caa | 已有 |
| 🟡 | packages/catdlg-core/src/*.test.ts (11个) | caa | TS 原生 |
| 🟡 | web-ui/src/utils/caa*.test.ts (8个) | caa | TS 原生 |
| 🟡 | web-ui/src/api/caaDialog.test.ts | caa | TS 原生 |
| 🟡 | web-ui/src/utils/fileRename.test.ts | cad | TS 原生 |
| 🟡 | web-ui/src/utils/sidebarStackLayout.test.ts | 系统 | TS 原生 |
| 🟡 | web-ui/src/utils/unitTestBackendSplit.test.ts | 系统 | TS 原生 |
| 🟡 | web-ui/src/components/caa/controls/*.test.ts | caa | TS 原生 |

### 原始测试统计（已否决）

| 类别 | 总数 | ✅ | ⬜ | ⚫ | 🟡 |
|------|------|----|-----|-----|-----|
| CAD 模块 | 20 | 10 | 6 | 2 | 1 |
| Code 模块 | 14 | 0 | 14 | 0 | 0 |
| 系统/配置 | 14 | 0 | 14 | 0 | 0 |
| 非 Python (TS原生) | 25 | 0 | 0 | 0 | 25 |
| **合计** | **73** | **10** | **34** | **2** | **26** |

### 原始函数迁移统计（已否决）

| 类别 | 函数数 | ✅ | 🟡 |
|------|--------|----|-----|
| fcstd_map_service.py | 23 | 23 | 0 |
| bom_xref_service.py | 20 | 20 | 0 |
| rename_analysis_service.py | 20 | 20 | 0 |
| xlink_fix_service.py | 15 | 15 | 0 |
| phoenix_store.py (查询) | 8 | 8 | 0 |
| 其他模块 | 38 | 38 | 0 |
| **合计** | **124** | **124** | **0** |

### 原始最终统计（已否决）

| 状态 | 数量 | 说明 |
|------|------|------|
| ✅ 已完成 | 124函数 + 19测试 | Rust + TS 原生 |
| ✅ | 全部完成 | 54 测试 | Rust 11 + TS 43 |
| ✅ 已完成 | Code模块全部 | 14/14 ✅ |
| ⚫ 保留 Python | 9 | freecadcmd/COM 依赖 |
| ❌ 可废弃 | 4 | 已替代 |
