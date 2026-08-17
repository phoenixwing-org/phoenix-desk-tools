# tauri branch migration correction log

Last updated: 2026-07-11

This document is the handover baseline for continuing the Python to Node/Rust migration on the `tauri` branch. It intentionally treats earlier checkpoint documents as unverified until current code and runtime checks prove the same claim.

> **Current-document rule (2026-07-11):** this file is a chronological correction log. Statements below can describe an earlier intermediate snapshot and are not automatically current truth. Resume from [Tauri 迁移当前状态基线](tauri-当前迁移状态基线.md); current architecture is maintained in [Tauri 分支迁移审计与接手指南](tauri-分支迁移审计与接手指南.md), and page-level status is maintained in [Tauri 逐页功能二验矩阵](tauri-逐页功能二验矩阵.md). In particular, the old lines saying that no Tauri scaffold exists, Test Fixtures do not clone, the CAA index is live-scan-only, label patching changes only SQLite, or standalone `Document.xml` XLink mode is rejected have all been superseded by later worktree changes.

## Current correction snapshot

- `src-tauri/` now contains a Tauri 2 shell, capabilities, configuration, Rust commands, Node service lifecycle, native directory picker, single-instance handling, window-state persistence, and packaged resource lookup.
- `src-tauri/Cargo.lock` has been generated, the packaged runtime is staged, both Rust native tools exist under `server/bin`, and a release executable has been built successfully.
- Test Fixtures now perform a real shallow `git clone` into a temporary directory followed by an atomic rename for missing enabled fixtures. Existing repositories are reported but are not pulled.
- File Worksets now persist in the workspace SQLite database and import the migration-era JSON store once.
- Code Index now persists in workspace SQLite and imports the migration-era JSON index once. Code Rename and UUID now emit JSON operation reports; UUID returns `unique_new_uuids`; the UUID page exposes GUID32 scanning.
- CAA Index now persists scan/dialog/group/FTS data in workspace SQLite and reuses unchanged files by size/mtime.
- BOM link-label patching now writes FCStd `Document.xml`; File Rename applies real XLink and label patches; XLink Fix supports both indexed FCStd batches and standalone `Document.xml` mode.
- The packaged Unit Tests page intentionally uses runtime/resource/native-tool self-checks, while development mode uses Vitest. This is a documented behavior change from the Python unittest runner and still requires product acceptance.
- Representative functional acceptance (`F`) now exists for Git, File Worksets, Code, CAA, and the synthetic-FCStd CAD chain. The packaged runtime lifecycle, Config desktop status/exit boundary, and release Unit Tests are now `D`; other pages still require release/installed-workspace repetition before promotion from `F`.

## Verified branch baseline

- Current branch: `tauri`; checkpoint HEAD `2a946be9` (`过程状态`) now records the correction worktree described by this log.
- Base from `master`: `9d95803 refactor: rename @phoenix/ -> @desk-tools/, add phoenix-wing auto-detect`.
- Migration commits on this branch:
  - `42c5dd9 refactor: server/caa -> server, add architecture migration plan`.
  - `20281d1 feat: Python -> Rust/TS migration + page adaptation`.
- The original `20281d1` migration commit had no Tauri scaffold. The later checkpoint `2a946be9` contains the Tauri 2 shell, runtime assembly, icons, release configuration, lifecycle code, product corrections, and acceptance evidence; this distinction is important when reviewing history.

## Runtime checks

Known passing checks from this handover pass:

- `pnpm install --frozen-lockfile`
- `pnpm test:ts`
- `pnpm -C web-ui build`
- `cargo test --manifest-path server/fcstd-reader/Cargo.toml`
- `cargo test --manifest-path server/fcstd-xlink/Cargo.toml`

Additional verification run while applying this correction:

- `server/node_modules/.bin/vitest.CMD run src/lib/` -> 9 files / 43 tests passed.
- `packages/catdlg-core/node_modules/.bin/vitest.CMD run src` -> 11 files / 65 tests passed.
- `web-ui/node_modules/.bin/vitest.CMD run` -> 13 files / 161 tests passed.
- `web-ui/node_modules/.bin/vite.CMD build` -> passed with the existing VueUse pure annotation and chunk-size warnings.
- `server/node_modules/.bin/tsx.CMD` route import/smoke -> `shellRoutes` and `cadRoutes` import successfully; `/api/test-fixtures`, `/api/git/info`, `/api/cad/bom/xref/edges` return JSON.
- After the second correction pass, `server/node_modules/.bin/tsx.CMD` route import/smoke -> `shellRoutes`, `cadRoutes`, and `createCaaApp` import successfully; `/api/caa/index/groups?workspaceRoot=..` returns a live `.CATDlg` group payload.
- After the Code Index retry pass, `server/node_modules/.bin/vitest.CMD run src/lib/` -> 15 files / 66 tests passed, including persistent Code Index scan/query/export coverage.
- Code Index route smoke -> `/api/code/index`, `/api/code/index/entries`, `/api/code/index/extension-discovery`, `/api/code/index/catdlg`, and `/api/code/index/scan` return JSON without falling back to empty hard-coded route bodies.
- Code Index route regression -> `server/node_modules/.bin/vitest.CMD run src/routes/shell-code-index.test.ts` -> 1 file / 4 tests passed, covering extra extensions, workspace-scoped route storage, legacy global index migration, prevention of legacy extra-extension leakage, scan, entries, `.CATDlg` sub-index, export, and purge through the Hono routes.
- Code Index focused retry -> `server/node_modules/.bin/vitest.CMD run src/lib/pdtCodeService.test.ts src/routes/shell-code-index.test.ts` -> 2 files / 19 tests passed, including Python-compatible `searchMode=filename` exact filename/path matching.
- Full route regression after the Code Index retry pass -> from `server/`, `node_modules/.bin/vitest.CMD run src/routes` -> 9 files / 16 tests passed. Existing duplicate `_stub` warnings remain in unrelated CAD proxy/stub routes.
- After the Code Rename correction pass, `server/node_modules/.bin/vitest.CMD run src/lib/` -> 9 files / 47 tests passed, including text/file/directory rename preview and apply coverage.
- Code Rename route smoke -> `/api/code/rename/prefs`, `/api/code/rename/preview`, and `/api/code/rename/apply` return the frontend `CodeRenameResult` shape; with no valid workspace they now return `implemented: true` plus a clear workspace error instead of an empty fake result.
- After the Code UUID correction pass, `server/node_modules/.bin/vitest.CMD run src/lib/` -> 9 files / 50 tests passed, including UUID scan, dry-run mapping, and selected-occurrence write coverage.
- Code UUID route regression -> `server/node_modules/.bin/vitest.CMD run src/routes/shell-code-uuid.test.ts` -> 1 file / 1 test passed, covering scan, dry-run, and selected write through the Hono routes.
- Code UUID route smoke -> `/api/code/uuid/scan` and `/api/code/uuid/apply` now return the frontend `CodeUuidScanResult` / `CodeUuidApplyResult` shape; with no valid workspace they return `implemented: true` plus a clear workspace error instead of hard-coded empty results.
- After the first Reorder Members route-shell pass, `server/node_modules/.bin/vitest.CMD run src/lib/` -> 10 files / 53 tests passed, including prefs, top-level discovery, scope resolution, the initial simplified `.cpp` dry-run/write engine, and self-test coverage. This did not yet prove Python algorithm parity or header behavior; the later retry below supersedes that completion assessment.
- Initial Reorder Members route regression -> `server/node_modules/.bin/vitest.CMD run src/routes/shell-reorder-members.test.ts` -> 1 file / 1 test passed, covering prefs, top-level, resolve, run dry-run/write, and self-test through the Hono routes.
- After the File Worksets correction pass, `server/node_modules/.bin/vitest.CMD run src/lib/` -> 11 files / 56 tests passed, including workset normalization, save/load, and prune coverage.
- File Worksets route regression -> `server/node_modules/.bin/vitest.CMD run src/routes/shell-file-worksets.test.ts` -> 1 file / 1 test passed, covering `GET/PUT /api/file-worksets` and `POST /api/file-worksets/prune-missing` through the Hono routes.
- After the Code Ignore correction pass, `server/node_modules/.bin/vitest.CMD run src/lib/` -> 12 files / 58 tests passed, including frontend-shaped prefs, legacy ignore file loading, process-dir suggestions, presets, and effective pattern merging.
- Code Ignore route regression -> `server/node_modules/.bin/vitest.CMD run src/routes/shell-code-ignore.test.ts` -> 1 file / 1 test passed, covering prefs, save, preset/custom merge, and process-dir suggestions through the Hono routes.
- After the Unit Tests / Runtime Catalog correction pass, `server/node_modules/.bin/vitest.CMD run src/lib/` -> 13 files / 62 tests passed, including Vitest catalog parsing, suite planning, runtime catalog maps, and JSON reporter conversion.
- Unit Tests route regression -> from `server/`, `node_modules/.bin/vitest.CMD run src/routes` -> 7 files / 13 tests passed, including `/api/unit-tests/suites`, `plan`, `run/stream`, and runtime catalog route coverage.
- Unit Tests route smoke -> `shellRoutes` reports suites `code:10,cad:6,platform:8,caa:20`; `/api/unit-tests/run/stream` on `server/src/routes/shell-code-index.test.ts` returns NDJSON events and summary `{ tests_run: 3, passed: 3, failed: 0 }`.
- Frontend Unit Tests merge regression -> `web-ui/node_modules/.bin/vitest.CMD run src/utils/unitTestBackendSplit.test.ts` -> 1 file / 13 tests passed, covering preservation of native Vitest suites from the general endpoint.
- After the File Rename correction pass, `server/node_modules/.bin/vitest.CMD run src/lib/` -> 14 files / 65 tests passed, including safe workspace-local rename, rename log persistence, text reference scanning, and apply coverage.
- File Rename route regression -> from `server/`, `node_modules/.bin/vitest.CMD run src/routes` -> 8 files / 14 tests passed, including `/api/file-rename/rename`, `/api/file-rename/scan-refs`, and `/api/cad/rename/{logs,analyze,apply,load}` coverage.
- After the FCStd Map correction pass, `server/node_modules/.bin/vitest.CMD run src/lib/` -> 15 files / 66 tests passed, including native SQLite-backed FCStd map scan/load/search/purge/export/history coverage.
- FCStd Map route regression -> from `server/`, `node_modules/.bin/vitest.CMD run src/routes` -> 9 files / 16 tests passed, including `/api/cad/fcstd-map/{prefs,scan,start,progress,entries,purge-missing,export-json}` plus scan history/resume coverage through `cad-scan.ts`.
- After the BOM File Detail attributes/rename correction pass, `server/node_modules/.bin/vitest.CMD run src/lib/` -> 16 files / 71 tests passed, including filename inference, workspace BOM prefs, field recommendation, label formula, document-kind inference, filename recommendation, BOM rename unsaved-attribute guard, and fcstd-map row rename coverage.
- BOM File Detail route regression -> from `server/`, `node_modules/.bin/vitest.CMD run src/routes` -> 10 files / 17 tests passed, including native `/api/cad/bom/{file,prefs,recommend-field,recommend-all-fields,fill-recommended-values,fill-from-embedded,fill-from-filename,apply-label-formula,document-kinds,recommend-filename,rename}` coverage. Existing duplicate `_stub` warnings remain in unrelated CAD proxy/stub routes.
- After the BOM XRef read-side correction pass, `server/node_modules/.bin/vitest.CMD run src/lib` -> 17 files / 73 tests passed, including native SQLite BOM/XRef meta, counts, outgoing, incoming transitive hosts, usage stats, assembly-host catalog, edge search, file-detail xrefs, and SQLite label snapshot patch coverage.
- BOM XRef route regression -> from `server/`, `node_modules/.bin/vitest.CMD run src/routes` -> 11 files / 18 tests passed, including `/api/cad/bom/xref/{meta,incoming,outgoing,counts,usage-stats,edges,rebuild,patch-labels,assembly-hosts,refresh-host-index/start,refresh-host-index/progress}` plus `/api/file-detail/xrefs` coverage. Existing duplicate `_stub` warnings remain in unrelated CAD proxy/stub routes.
- After the PartKey / assembly-tree correction pass, `server/node_modules/.bin/vitest.CMD run src/lib` -> 18 files / 74 tests passed, including PartKey sync from `phoenix_cad_file_asset`, catalog/detail/infer, PartKey metadata patch, file-link patch, and XRef-backed assembly tree coverage.
- PartKey route regression -> from `server/`, `node_modules/.bin/vitest.CMD run src/routes` -> 12 files / 19 tests passed, including native `/api/cad/parts`, `/api/cad/parts/infer`, `/api/cad/parts/{pn}/{pv}`, `/api/cad/parts/{pn}/{pv}/files/{fileId}`, `/api/cad/parts/{pn}/{pv}/assembly-tree`, `/api/cad/bom/xref/assembly-tree`, and legacy `/api/cad/bom/tree` coverage. Existing duplicate `_stub` warnings remain in unrelated CAD proxy/stub routes.
- Frontend build after the PartKey correction pass -> from `web-ui/`, `node_modules/.bin/vite.CMD build` passed with the existing VueUse pure annotation and chunk-size warnings.
- After the Part Dedup correction pass, `server/node_modules/.bin/vitest.CMD run src/lib` -> 19 files / 82 tests passed, including native Part Dedup prefs, filename/code/version duplicate detection, FCStd model/drawing grouping, CSV export, and workspace path validation.
- Part Dedup route regression -> `server/node_modules/.bin/vitest.CMD run src/lib/pnwPartDedupService.test.ts src/routes/cad-part-dedup.test.ts` -> 2 files / 9 tests passed, covering native `/api/cad/part-dedup/{prefs,scan,export-csv}` without `_proxy`/`_stub`.
- Full route regression after the Part Dedup correction pass -> `server/node_modules/.bin/vitest.CMD run src/routes` -> 13 files / 21 tests passed. Existing duplicate `_stub` warnings remain in STEP/SolidWorks/XLink/legacy scan/worksets proxy routes.
- XLink Fix focused regression -> `server/node_modules/.bin/vitest.CMD run src/lib/pnwXlinkFixService.test.ts src/routes/cad-xlink-fix.test.ts src/lib/pdtCadStub.test.ts` -> 3 files / 8 tests passed, covering prefs, SQLite candidates, broken/resolvable/not-found classification, route response shape, unchanged manual override, and the real `cad-scan.ts`-before-`cad.ts` mount order without `_proxy`/`_stub`.
- Full Node server regression after the XLink Fix correction pass -> `server/node_modules/.bin/vitest.CMD run src/lib src/routes` -> 34 files / 108 tests passed. The duplicate `_stub` object-key warnings in `cad.ts` were removed.
- XLink Rust regression -> `cargo test --manifest-path server/fcstd-xlink/Cargo.toml` -> 5 tests passed, including a real temporary FCStd/ZIP rewrite on Windows and proof that only `<XLink file="...">` attributes are changed.
- STEP Batch focused regression -> `server/node_modules/.bin/vitest.CMD run src/lib/pnwStepBatchService.test.ts src/routes/cad-step-batch.test.ts` -> 2 files / 6 tests passed, covering Python-compatible prefs, shallow/recursive STEP discovery, macOS/Windows FreeCADCmd path resolution, complete `FCD_BATCH_*` environment construction, real child-process execution, summary parsing, validation errors, and all four Hono routes without `_proxy`/`_stub`.
- Full Node server regression after the STEP Batch correction pass -> `server/node_modules/.bin/vitest.CMD run src/lib src/routes` -> 36 files / 114 tests passed.
- SolidWorks STEP focused regression -> `server/node_modules/.bin/vitest.CMD run src/lib/pnwSwStepExportService.test.ts src/routes/cad-sw-step.test.ts` -> 2 files / 6 tests passed, covering prefs, part/assembly filtering, recursive discovery, non-Windows capability behavior, JSON job construction, COM option propagation, real adapter child-process execution, failure shaping, the previously missing prefs PUT route, and all page routes without `_proxy`/`_stub`.
- SolidWorks PowerShell adapter syntax -> PowerShell AST parse passed for `server/scripts/sw-step-export.ps1`; tests also assert that it uses `GetOpenDocumentByName`, `OpenDoc6`, `SaveAs3`/`SaveAs2` fallbacks, and closes only documents opened by the adapter.
- Full Node server regression after the SolidWorks STEP correction pass -> `server/node_modules/.bin/vitest.CMD run src/lib src/routes` -> 38 files / 120 tests passed.
- CAD native-only invariant -> `server/node_modules/.bin/vitest.CMD run src/routes/cad-native-only.test.ts src/routes/cad-scan-fcstd-map.test.ts src/routes/shell-file-worksets.test.ts` -> 3 files / 4 tests passed. The invariant rejects `PYTHON_API`, `proxyToPython`, `_proxy`, `_stub`, and Python-sidecar startup checks in CAD route modules, verifies canonical FCStd Map/File Worksets behavior, and requires invented legacy aliases to remain unregistered.
- Full Node server regression after removing the CAD Python fallback infrastructure -> `server/node_modules/.bin/vitest.CMD run src/lib src/routes` -> 39 files / 122 tests passed.
- Production marker audit after the server-wide cleanup -> `rg` found no `_stub`, `_proxy`, `proxyToPython`, `PYTHON_API`, or `checkPythonSidecar` marker in non-test `server/src/**/*.ts` files. Marker hits that remain under tests are negative assertions/invariant fixtures.
- File Rename context / Unit Tests / Code service focused regression after removing dead compatibility exports and legacy-disabled routes -> 3 files / 17 tests passed.
- Full Node server regression after the production stub cleanup -> `server/node_modules/.bin/vitest.CMD run src/lib src/routes` -> 38 files / 118 tests passed. The file/test count dropped because the obsolete four-case `pdtCodeStub.test.ts` was deleted; its fake-response contract is no longer production behavior.
- Reorder Members retry focused regression -> `server/node_modules/.bin/vitest.CMD run src/lib/reorderCppEngine.test.ts src/lib/reorderHeaderEngine.test.ts src/lib/sourceTextCodec.test.ts src/lib/reorderMembersService.test.ts src/routes/shell-reorder-members.test.ts` -> 5 files / 31 tests passed. Coverage includes both engines, four locked-region rule families, nested locks, three Kevin System Code modes, comments/return types/separators/internal calls, UTF-8 BOM, GBK, CRLF, dry-run/write, route behavior, and self-test.
- Reorder Members migration differential -> all 15 local header fixtures and all 7 local `.cpp` fixtures produce byte-for-byte-equivalent normalized output to the pre-migration Python engine. The `.cpp` parity is locked by seven SHA-256 fixture-output expectations, so Python is not required for future regression runs.
- Full Node server regression after the Reorder Members engine retry -> `server/node_modules/.bin/vitest.CMD run src/lib src/routes` -> 41 files / 145 tests passed. The non-test production marker scan remains empty.
- Code Rename / UUID encoding-prefs retry -> `server/node_modules/.bin/vitest.CMD run src/lib/sourceTextCodec.test.ts src/lib/pdtCodeService.test.ts src/routes/shell-code-rename.test.ts src/routes/shell-code-uuid.test.ts` -> 4 files / 25 tests passed. Coverage includes workspace-local prefs merging/automatic save, GBK-preserving rename and UUID replacement, ASCII-to-GBK target conversion, UTF-8 BOM preservation, lossy GBK rejection, route GET/PUT/preview/apply, and UUID ignore metadata.
- Full Node server regression after the Code Rename / UUID retry -> `server/node_modules/.bin/vitest.CMD run src/lib src/routes` -> 42 files / 151 tests passed. The non-test production marker scan remains empty.
- Code Ignore auto-seed/workspace-prefs retry -> `server/node_modules/.bin/vitest.CMD run src/lib/codeIgnoreService.test.ts src/routes/shell-code-ignore.test.ts src/routes/shell-code-index.test.ts src/routes/shell-code-rename.test.ts src/routes/shell-code-uuid.test.ts src/routes/shell-reorder-members.test.ts` -> 6 files / 12 tests passed. Coverage proves one-time process-directory seeding, side-effect-free effective-pattern reads, workspace prefs merging, migration-era global-store compatibility, and all four Code consumers.
- Full Node server regression after the Code Ignore retry -> `server/node_modules/.bin/vitest.CMD run src/lib src/routes` -> 42 files / 153 tests passed. The non-test production marker scan remains empty.
- FCStd Map workset-scope retry -> `server/node_modules/.bin/vitest.CMD run src/lib/fileWorksetService.test.ts src/lib/pnwFcstdMapService.test.ts src/routes/cad-scan-fcstd-map.test.ts src/routes/shell-file-worksets.test.ts` -> 4 files / 8 tests passed. Coverage includes parent/child directory deduplication, path-boundary-safe explicit files, invalid workset rejection, fresh-workspace scoped indexing, outside-row status preservation, scoped progress/history stats, and stable same-second history ordering.
- Full Node server regression after the FCStd Map scope retry -> `server/node_modules/.bin/vitest.CMD run src/lib src/routes` -> 42 files / 155 tests passed. The non-test production marker scan remains empty.
- FCStd Map async/cancel retry -> `server/node_modules/.bin/vitest.CMD run src/lib/pnwFcstdMapService.test.ts src/routes/cad-scan-fcstd-map.test.ts` -> 2 files / 4 tests passed. Coverage proves that `/scan/start` returns in the walk phase before traversal completes, the background scan reaches done, immediate cancellation reaches a terminal cancelled progress state, cancellation is persisted in scan history, and a completed/cancelled scan cannot be cancelled again.
- FCStd Map async/scope integration regression -> `server/node_modules/.bin/vitest.CMD run src/lib/fileWorksetService.test.ts src/lib/pnwFcstdMapService.test.ts src/routes/cad-scan-fcstd-map.test.ts src/routes/shell-file-worksets.test.ts` -> 4 files / 9 tests passed.
- Full Node server regression after the FCStd Map async/cancel retry -> `server/node_modules/.bin/vitest.CMD run src/lib src/routes` -> 42 files / 156 tests passed. The non-test production marker scan remains empty, and `git diff --check` reports no whitespace errors (only existing LF-to-CRLF notices).
- FCStd Step C / BOM XRef disk-rebuild retry -> `server/node_modules/.bin/vitest.CMD run src/lib/pnwFcstdMapService.test.ts src/lib/pnwBomXrefService.test.ts src/routes/cad-scan-fcstd-map.test.ts src/routes/cad-bom-xref.test.ts` -> 4 files / 10 tests passed. Tests use real FCStd ZIP archives with `Document.xml`, covering scan-triggered XRef rebuild, XLink and object-label extraction, relative target resolution, missing targets, recursive host discovery, stale-edge deletion, local disk refresh, asynchronous completion/cancellation, and migration-era Python `scan_root NOT NULL` schema compatibility.
- CAD native/XRef focused regression -> 5 files / 13 tests passed, including a native-only health payload and the absence of Python sidecar fields. The production marker scan remains empty for `pythonAvailable`, `PYTHON_PORT`, `PYTHON_API`, `proxyToPython`, `_proxy`, `_stub`, and `checkPythonSidecar`.
- Full Node server regression after the BOM XRef rebuild correction -> `server/node_modules/.bin/vitest.CMD run src/lib src/routes` -> 42 files / 160 tests passed.
- Frontend production build after the BOM XRef correction -> `web-ui/node_modules/.bin/vite.CMD build` passed (2256 modules). The existing VueUse pure-annotation notices and large-main-chunk warning remain; generated JS is about 1.32 MB before gzip / 420 kB gzip.
- Type-check gate restoration -> `server/node_modules/.bin/tsc.CMD --noEmit --pretty false` passed. The pass added direct Node typings, a local Phoenix Wing DB-adapter declaration, missing NodeNext `.js` import suffixes, an explicit Code Rename result type, the missing CAA `PROP_LINE` matcher, and the correct ordered-entry conversion for `patchCatNls`.
- CAA core regression after the type-gate fixes -> `packages/catdlg-core/node_modules/.bin/vitest.CMD run` -> 11 files / 65 tests passed. The full Node server regression remains 42 files / 160 tests passed after the same fixes.

Note: an earlier bundled `pnpm` attempt aborted because there was no TTY for a module purge confirmation. The current workspace `pnpm.cmd 9.15.9` later completed `install --offline --frozen-lockfile`; `fflate@0.8.3` and `@types/node@26.0.1` are linked from the existing local store without network access.

Type-check gate note:

- `pnpm typecheck` is now a passing root gate and runs both server `tsc` and web-ui `vue-tsc`. The root `pnpm test` sequence invokes it before Rust and Vitest checks.

Known issue fixed in this pass:

- Root `pnpm dev` used `sleep 2`, which fails on Windows PowerShell/cmd. It now starts server and UI concurrently without the Unix-only sleep.

Known issue stabilized in this pass:

- `pnpm test:caa` was failing on expected `.CATDlg` / `.CATNls` output comparisons because golden files use CRLF while emitters produce LF. The expected-output test now normalizes EOL during comparison. This does not claim exact line-ending preservation; it only makes semantic text comparisons cross-platform.

Final handover verification snapshot:

- `pnpm typecheck` -> server `tsc` and web-ui `vue-tsc` passed without reducing strictness.
- `pnpm -C server test` -> 48 files / 163 tests passed. This now includes both `src/lib` and `src/routes`; the obsolete fake `pdtSystemStub.test.ts` suite has been removed.
- `pnpm -C web-ui test` -> 13 files / 162 tests passed.
- `pnpm test:caa` -> catdlg-core 11 files / 65 tests and web-ui 13 files / 162 tests passed.
- `pnpm -C web-ui build` -> 2244 modules; CSS 533.80 kB / 70.24 kB gzip and JS 1304.21 kB / 415.88 kB gzip. VueUse annotation and large-chunk notices remain warnings.
- Rust `fcstd-reader` -> 6 unit tests and 1 doc test passed; `fcstd-xlink` -> 5 tests passed.
- Rust `fcstd-cli` / `fcstd-query` remain unverified in this snapshot because Cargo needed the missing `jobserver` crate and network download was unavailable. Do not report the four-crate Rust gate as fully passing yet.
- The user manually confirmed that `http://localhost:5173/` opens. Automated localhost browser smoke was blocked by the current Codex browser security preference, so no page-level UI acceptance is inferred from that check.

## Historical intermediate page status

> The table in this section records an early correction snapshot and is retained only to explain why later work was necessary. It is superseded by [Tauri 迁移当前状态基线](tauri-当前迁移状态基线.md) and [Tauri 逐页功能二验矩阵](tauri-逐页功能二验矩阵.md); do not resume work from its “Partial/Mostly migrated” wording.

| Page or module | Current status | Evidence / gap |
| --- | --- | --- |
| App shell / navigation | Mostly migrated | Launcher layout, recent workspaces, enabled navigation modules, workspace navigation state, workbench sessions, the bounded incremental shell log, onboarding status, Phoenix database status/recreate, and server shutdown now use real services. Remaining gaps are browser reload/error smoke and the future Tauri window/process lifecycle; there is still no Tauri scaffold. |
| Config / workspace | Mostly migrated | Workspace open/close, launcher preferences, FreeCAD directory, navigation/layout state, workspace navigation, and v13 database initialization/detection/recreate are implemented. Remaining gaps are native directory-picker/Tauri integration, real browser smoke, and a deliberate migration from the current JSON/SQLite preference split. |
| File worksets / scope sidebar | Partial | `GET/PUT /api/file-worksets` and prune-missing persist workspace-local JSON under `.phoenix/file-worksets.json`, normalize legacy `paths` to typed entries, and support missing-path cleanup. A shared scope resolver now removes nested child directories, removes explicit files already covered by selected directories using path-segment boundaries, and powers FCStd Map in addition to Code Index/Rename/UUID/Reorder. Remaining gaps: storage differs from the old Python SQLite-backed store, no cross-page browser smoke has verified sidebar edits/selection persistence, and migration policy for old SQLite worksets is not explicit. |
| Test fixtures | Partial | `GET/PUT /api/test-fixtures` and `POST /api/test-fixtures/sync` were missing in Node and have now been migrated as the same non-cloning preference/status flow used by the Python service. |
| Git | Partial | `info`, `changes`, `diff`, `init`, `stage`, `restore`, `commit` now have Node implementations for the configured workspace root. Needs UI smoke tests and edge-case tests before marking complete. |
| CAA dialog editor | Mostly migrated | `server/src/routes/dialog.ts` has real TypeScript handlers for list/parse/save/write/create/drafts. Grid-only saves now accept the frontend `patches` payload and call `patchCatDlgGridLayout`; a real temporary-file route regression covers the previous 400/contract failure. Remaining risk is real CATIA/CAA fixture coverage, complex CATDlg/CATNls fidelity, and browser interaction smoke. |
| CAA index | Partial | Node now implements `/api/caa/index/groups` and `/api/caa/index/scan` as live `.CATDlg` scans with control-type coverage stats, and the frontend passes `workspaceRoot`. This is not a persisted/incremental index yet. |
| FCStd map | Mostly migrated | `cad-scan.ts` owns prefs, scan/load/search, scan start/progress/cancel/history/resume, purge-missing, and export-json. The service ensures SQLite schema, persists `.phoenix/phoenix-workspace.sqlite`, computes live present/missing disk status, purges missing rows, exports `.phoenix/fcstd_map.json`, and records scan history. `scope_workset_id` resolves typed File Workset entries, filters the CAD basename map, reports current-scope counts/history, rejects missing/empty worksets, and preserves rows outside a local scan. `/scan/start` returns before traversal completes and runs asynchronous directory walk/BOM extraction with cancellation and terminal history. Step C now rebuilds BOM XRef from the indexed FCStd files instead of emitting a fake xref phase, and inserts include `scan_root='.'` so existing Python-created scan tables remain writable. Remaining gaps: the synchronous compatibility `/scan` route is still blocking, cancellation cannot interrupt a short SQLite transaction, scoped scans retain the old behavior of not marking deleted in-scope rows missing, force-update PartName parity is incomplete, and a real CAD workspace UI smoke is still needed. |
| BOM file attributes | Partial | File Detail now has Node routes for preview, workspace prefs, individual/all recommendation, recommended fill, filename/embedded fill, label formula, document-kind inference, filename recommendation, and BOM-compatible rename. `PUT /api/cad/bom/file` now accepts the frontend `rel` query and maps `label` to `Label` for the Rust `fcstd-read write-bom` CLI. `/api/cad/bom/rename` now rejects unsaved BOM attribute edits unless `write_attrs_first` is set, performs safe disk rename, records a rename log, and updates the SQLite fcstd-map row when present. Remaining gaps: write parity still depends on a debug-path CLI and real FCStd Document.xml behavior is not covered by tests, drawing `App::Link` read-only/source-model handling is only approximated, old Python/SQLite prefs parity is partial, and real File Detail UI smoke is still needed. |
| File detail xrefs | Mostly migrated | `/api/file-detail/xrefs` reads the same SQLite `phoenix_cad_bom_xref` index as the BOM XRef page and returns incoming/outgoing data without the old Rust-query wrapper/stub path. The frontend's `refresh_disk=true` request now re-reads the current FCStd and replaces that host's old edges before returning, while the dedicated rebuild action can include the recursively referenced subtree with progress/cancel. Remaining gaps: a single large FCStd read/decompression is not interruptible mid-file, incoming data is only as fresh as other host rows, and real workspace UI smoke is still needed. |
| File rename | Partial | Read context and disk rename now run natively. `GET /api/file-rename/context` uses the BOM preview service for filename, SQLite, embedded FCStd, and disk metadata instead of returning a stub when an indexed asset is absent. `POST /api/file-rename/rename` validates workspace-local paths, prevents overwrite/escape, renames the file, and persists `.phoenix/rename-logs.json`; FCStd renames share the BOM rename service, so unsaved-attribute guard and fcstd-map row update are now covered. `/api/cad/rename/logs`, `analyze`, `apply`, `load`, and `/api/file-rename/scan-refs` now scan/apply text references by basename. Remaining gaps: real Document.xml write-before-rename still depends on the debug-path `fcstd-read` CLI and lacks round-trip tests, FCStd ZIP/XLink internal patch parity is not complete, label synchronization is shallow, and UI smoke on real CAD workspaces is still needed. |
| BOM xref | Mostly migrated | Meta, incoming, outgoing, counts, usage-stats, edges, assembly-hosts, assembly-tree, legacy `/api/cad/bom/tree`, rebuild, and host refresh now use Node/SQLite. A direct `fflate` engine reads only `Document.xml` from FCStd ZIPs, extracts XLink paths and object labels, applies the migrated same-directory/project-version/nearest-candidate resolution rules, enriches target snapshots/rule labels, atomically replaces full indexes, and deletes/rebuilds selected host rows so removed links do not survive. Recursive host refresh performs disk BFS and `/start` now provides real progress/cancel semantics. `patch-labels` remains a SQLite snapshot update. Remaining gaps: label patching does not write `Document.xml`, cancellation cannot interrupt one in-flight file read/decompression or the final SQLite transaction, materialized occurrence/cache parity is not rebuilt, and real CAD workspace UI smoke is still needed. |
| Part catalog / part detail | Partial | Catalog, detail, infer-from-path, PartKey metadata patch, file-link patch, and PartKey assembly-tree routes now run natively in Node/SQLite. The service creates/syncs `phoenix_cad_part_key` and `phoenix_cad_part_file_link` from `phoenix_cad_file_asset` when needed, returns both frontend `entries` and legacy `items`, and the catalog page consumes the full `PartKeysPayload`. Assembly trees still read XRef rows, but those rows are now rebuilt automatically by FCStd scans and explicitly by the BOM/File Detail actions. Remaining gaps: sync parity is a pragmatic port rather than a complete audit of all Python `part_key_service` edge cases, deep/materialized tree parity is approximate, and real UI smoke is still needed. |
| XLink fix | Partial | Prefs, candidate lookup, dry-run analysis, batch write, and manual override use a Node/SQLite service, while FCStd mutation uses the Rust `fcstd-xlink` CLI. Both duplicate route mounts call the same native service. Analysis skips links that still resolve on disk, limits automatic repair to exact-basename present-file candidates, and reports fixable/not-found rows in the frontend shape. Rust write-back changes only `<XLink file>` attributes and safely replaces the ZIP on Windows; touched hosts are now genuinely re-read from disk afterward. Analysis still relies on `phoenix_cad_bom_xref`, but FCStd scans and explicit refresh actions now keep that index current. Remaining gaps: legacy `all_in_dir=false` Document.xml-only mode is explicitly rejected, binary bootstrap still mixes debug/release/cargo fallback, and a real workspace UI plus non-dry-run route smoke is still required. |
| Part dedup | Partial | Prefs, scan, duplicate grouping, and CSV export now run natively in Node. The service persists the old `part_dedup` prefs section under `.phoenix/phoenix-workspace-prefs.json`, scans selected extensions recursively, preserves the Python filename/code/version grouping behavior including `.FCStd` drawing/model separation, returns frontend `paths_display`, and exports `.phoenix/exports/part_dedup.csv`. Remaining gaps: UI smoke on a real workspace, explicit decision on whether absolute scan directories outside the workspace should remain supported, and exact Chinese CSV labels from the old Python exporter if downstream tooling depends on them. |
| STEP batch | Partial | Workspace prefs, path normalization, shallow/recursive STEP discovery, preview, FreeCADCmd location, process launch, `FCD_BATCH_*` environment construction, report/console summary parsing, and all four page routes now run in Node without the Python Web API. The retained `scripts/freecad_batch_step_runner.py` and `freecad_batch_step_fc.py` are FreeCAD interpreter adapters because STEP import and FCStd creation require FreeCAD's Python API; they no longer own HTTP, preferences, validation, or process orchestration. Remaining gaps: verify a real STEP-to-FCStd conversion against an installed FreeCAD, bundle the runner plus `phoenix.batch_step` modules for the eventual packaged/Tauri app, add cancellation/progress for long jobs, and complete browser UI smoke. |
| SolidWorks STEP export | Partial | Prefs, path handling, `.sldprt`/`.sldasm` filtering, recursive preview, platform/adapter capability, JSON job lifecycle, COM option propagation, result shaping, and all four page routes now run in Node. A thin PowerShell adapter owns only the unavoidable Windows COM calls (`SldWorks.Application`, `OpenDoc6`, `SaveAs3`/`SaveAs2`/`SaveAs`); the old Python Web API and pywin32 dependency are removed from the server path. The migration also adds the previously missing `PUT /api/cad/sw-step/prefs` route and avoids closing documents that were open before the export. Remaining gaps: execute a real part and assembly export on a licensed SolidWorks machine, verify method signatures across supported SolidWorks versions, bundle/sign the PowerShell adapter for the eventual packaged app, add cancellation/progress, and complete browser UI smoke. |
| Code index | Partial | Scan now persists a lightweight Node JSON index, and `index`, `entries`, `catdlg`, `extension-discovery`, `extra-extensions`, `purge-missing`, and `export-json` routes use it. Shell routes store index data per workspace under `~/.phoenix/code-index/<workspace-hash>/`, migrate matching legacy global JSON on first use, retain old rows as `missing` after a later scan no longer sees them, and export `.phoenix/exports/code_index.json`. `searchMode=filename` now matches the old Python exact-file behavior for `foo.cpp` and `dir/foo.cpp`. Still needs UI smoke on a real workspace and parity with any Python SQLite/index metadata not represented in the JSON store. |
| Code ignore | Mostly migrated | `prefs` returns the frontend `CodeIgnorePrefs` shape and merges built-ins, `.phoenix/code.ignore`/legacy files, custom lines, and presets. Preferences now live in workspace `.phoenix/phoenix-workspace-prefs.json` under `code_ignore`, while the migration-era global `~/.phoenix/code-ignore.json` remains a read-compatible source and is migrated on the next save. First API open detects uncovered top-level process directories, merges deduplicated suggestions into `custom_ignore`, and persists `process_dirs_seeded=true` exactly once; effective-pattern reads used by Code Index/Rename/UUID/Reorder remain side-effect free. Remaining work: browser UI smoke on a real workspace, decide when the legacy global store can be retired, and confirm users prefer one-time automatic insertion over suggestion-only behavior for newly created process directories after the first seed. |
| Code rename | Partial | Text replacement plus file/directory basename rename run natively in Node with preview/apply, scope/workset/index filtering, ignore patterns, conflict detection, and tests. GET/PUT plus successful preview/apply now merge `code_rename` into workspace `.phoenix/phoenix-workspace-prefs.json` without replacing unrelated sections. Text scanning is strict UTF-8-then-GBK; preview reports real input/output encoding, writes preserve GBK/BOM/CRLF, `target_encoding` can convert UTF-8/ASCII text to GBK, and unrepresentable GBK writes are rejected without changing disk bytes. Remaining gaps: real browser/workset smoke, old case-only/path-rename edge parity on every platform, JSON report emission, and a fuller Python differential beyond the migrated unit cases. |
| Code UUID | Partial | Scan/apply run natively in Node for dashed UUIDs, 32-hex GUIDs when requested, and CAA/COM `0x...` GUID blocks. It supports dry-run, selected hit replacement, `map_per_value` / `fresh_per_hit`, scope/workset/index filtering, ignore patterns, route tests, and now returns the old ignore-file metadata. UUID scan/write uses the shared strict UTF-8/GBK codec, preserving GBK, BOM, and CRLF instead of corrupting GBK as UTF-8. Remaining gaps: real browser/workset smoke, a visible UI control for `guid32`/`suspicious`, confirm whether `suspicious` has an authoritative scan pattern rather than only a response enum, restore JSON report output/`unique_new_uuids`, and run the larger old UUID fixture bundle differential. |
| Reorder members | Mostly migrated | Prefs, top-level discovery, workset/scope resolution, dry-run/write, summaries, and route self-test run in Node. Dedicated TypeScript engines now reproduce the old Python output across all 15 local header fixtures and all 7 local `.cpp` fixtures: access-section and special-member ordering, optional member sorting, export-macro classes, Doxygen safety warnings, Kevin System Code merge/keep/off modes, function-block comments/return types/separators/internal-call filtering, and four nested locked-region rule families are covered. A strict shared codec preserves UTF-8/BOM or GBK and CRLF. Remaining work: browser UI smoke on real CAA worksets, restore an external KtAlarmClock fixture for the one historical Python test that is not correctly skip-guarded, decide whether prefs should move from the current global per-workspace JSON to legacy workspace-local `code_reorder`, and address inherited algorithm edges such as definitions before the first constructor and a leading comment above a split return-type line. |
| Unit tests page | Partial | General `/api/unit-tests/suites`, `plan`, `run`, `cancel`, and `run/stream` now use a native TS/Vitest catalog and JSON reporter runner across `server`, `web-ui`, and `packages/catdlg-core`, split into `code/cad/platform/caa`. The page can list scope, fetch plans, stream NDJSON results, and run selected modules/cases. Dead `/api/unit-tests-legacy-disabled/*` stub aliases were removed after confirming no frontend caller; the canonical routes remain covered. Remaining gaps: UI smoke in the browser, richer live per-case progress before JSON completion, and non-Vitest/Python unittest parity if those old suites still matter. |
| Runtime catalog | Partial | `/api/runtime-catalog/test-modules` and `/api/runtime-catalog/test-cases` are now backed by the Vitest catalog and return frontend-shaped maps for module/case descriptions. Dead `/api/runtime-catalog-legacy-disabled/*` stub aliases were removed after confirming no consumer. Broader Python runtime-catalog parity such as status/sync/search/doc extraction is still missing. |

## Incorrect or risky earlier claims

- Commit `20281d1` claimed a complete Python-to-Rust/TS migration, zero stubs, and all CAD/Code pages migrated. Its own source contained `PYTHON_API`, `proxyToPython`, `_proxy`, `_stub`, fixed empty responses, and duplicate routes. The commit changed no Python file; 232 Python files remained exactly as on the base branch.
- At the first audit snapshot, the branch was not yet a Tauri implementation: no `src-tauri`, `tauri.conf.*`, capability definition, desktop package lifecycle, or Tauri command boundary existed. The current worktree and frozen release artifacts supersede that historical state.
- The deleted `pdtSystemStub.test.ts` did not exercise production code. It asserted fields on hand-written objects, so the old checklist mapping 14 Python system tests to it was false evidence.
- The removed `Cr*` pages and `CadBomViewerPage` were disconnected migration prototypes, not additional successfully migrated product pages. They retained stale proxy wording and one path targeted a nonexistent page id.
- A source-level claim that current production TypeScript routes contain no `_stub`/`_proxy` marker is now supported by the audit and invariant tests. This is not evidence that all pages are functionally complete: the matrix still records missing parity, shallow implementations, external-engine acceptance gates, and untested UI workflows.
- Earlier in this correction pass, Python entrypoints had been closed while Node routes still proxied Python or returned `_stub`, creating a false-complete state. Those fallback paths are now removed, but the earlier mistake is retained here as a warning against equating route ownership with migrated behavior.
- Commit `20281d1` registered Reorder Members routes as fixed responses (`prefs {scope:"all"}`, empty `resolve`, `run {changed:0}`, and unconditional `self-test {ok:true}`); it did not migrate either sorting engine. The first correction replaced the route stubs but still left headers as a no-op and used a materially simplified `.cpp` parser. Only the later retry's fixture differential supports an algorithm-parity claim.
- The same `20281d1` commit registered Code Rename preview/apply and Code UUID scan/apply as fixed empty payloads. The first correction added working algorithms, but Rename prefs remained an echo-only route, `target_encoding` was ignored, Rename text reads were hard-coded UTF-8, and UUID's permissive UTF-8 decode/write path could corrupt GBK. Those are now corrected; they should not be described as having been complete in the original migration commit.
- The first BOM XRef correction only implemented the SQLite read side: `rebuild` reloaded existing rows, host refresh returned an immediate fake-done task, and File Detail ignored `refresh_disk=true`. Real FCStd ZIP extraction, atomic/full and delete-replace/local rebuilds, Step C integration, and asynchronous progress/cancel were added only in the later retry documented above.
- `server/src/routes/cad.ts` previously contained repeated `fcstd-map` route blocks overlapping with `server/src/routes/cad-scan.ts`; the duplicate operational blocks were removed in this correction pass.
- `server/src/routes/cad.ts.bak` was a tracked stale backup copy of the old CAD route module. It was not imported, but it polluted `rg`/audit results with duplicate old route definitions.
- Earlier correction stages resolved Rust CLI paths from `target/debug` or `target/release`; current release resolution uses packaged `runtime/bin`, while fresh development checkouts still need the documented native-tool build step.
- Several frontend APIs existed without Node routes before this correction pass: test fixtures, workspace DELETE, Git diff, file-detail xrefs, file-rename context/rename, and several BOM xref endpoints.

## Corrections made in this pass

- Made root `pnpm dev` cross-platform by removing Unix-only `sleep`.
- Made CAA expected-output tests compare independent of CRLF/LF.
- Restored the server TypeScript gate with direct Node typings, a DB-adapter declaration, NodeNext import suffixes, explicit Code Rename result typing, the missing CAA property matcher, and the correct CATNls entry-shape conversion.
- Restored the frontend `vue-tsc` gate, fixed API/component/store contract errors, and added root/server/web-ui `typecheck` scripts.
- Replaced shell layout/recent/nav/workbench/log/onboarding/database/shutdown placeholders with persistent Node/SQLite services and route regressions.
- Added Phoenix schema v13 creation, status detection, fixed-family database recreate, and first-use initialization for services that create the workspace database.
- Fixed CAA Grid-only save to use the existing patch contract and added a disk round-trip route test.
- Removed disconnected `Cr*`/legacy BOM viewer pages and the dead file-rename panel instead of carrying two competing migration UIs.
- Removed the fake `pdtSystemStub.test.ts` suite and expanded the normal server test command to include route tests.
- Expanded the root Rust test script from two crates to all four manifests; the last two still require the missing Cargo dependency to be downloaded before this gate can be called green.
- Added Node routes for:
  - `GET/PUT /api/test-fixtures`
  - `POST /api/test-fixtures/sync`
  - `DELETE /api/workspace`
  - `GET /api/git/diff`
  - real basic Git `info/changes/init/stage/restore/commit`
  - `GET /api/file-detail/xrefs`
  - `GET /api/file-rename/context`
  - `POST /api/file-rename/rename`
  - `GET /api/cad/bom/xref/assembly-tree`
  - `GET /api/cad/bom/xref/usage-stats`
  - `GET /api/cad/bom/xref/edges`
  - `POST /api/cad/bom/xref/rebuild`
- Removed duplicate `fcstd-map` operational route registrations from `server/src/routes/cad.ts`; `server/src/routes/cad-scan.ts` is the single owner for scan/load/search/progress/export style routes.
- Removed the remaining `/api/cad/fcstd-map/prefs` Python proxy compatibility routes from `server/src/routes/cad.ts`; FCStd Map prefs are now owned by `server/src/routes/cad-scan.ts`.
- Removed tracked stale backup file `server/src/routes/cad.ts.bak`.
- Replaced File Worksets empty responses with a Node JSON service that:
  - loads and saves workspace-local `.phoenix/file-worksets.json`;
  - normalizes legacy `paths` arrays into typed `{ path, type }` entries;
  - rejects escaping paths and deduplicates entries;
  - prunes missing file/directory entries globally or by workset id.
- Added File Worksets service and Hono route regression tests for save/load and prune behavior.
- Replaced Code Ignore raw/empty responses with a Node service that:
  - returns the full frontend `CodeIgnorePrefs` shape;
  - reads `.phoenix/code.ignore` and legacy `reorder-members.ignore` / `code-rename.ignore`;
  - persists custom ignore lines and preset selection per workspace;
  - exposes process-directory suggestions and suggested patterns;
  - feeds the merged effective ignore patterns into Code Index, Code Rename, Code UUID, and Reorder Members.
- Restored the old one-time process-directory auto-seed contract, moved canonical `code_ignore` storage back into workspace prefs, and retained migration-era global JSON as a compatibility read/migrate source.
- Added Code Ignore service and Hono route regression tests for prefs, save, one-time seeding, legacy migration, side-effect-free consumer reads, suggestions, and effective pattern merging.
- Replaced Unit Tests Python-era stub routes with a native Vitest service that:
  - discovers tests via `vitest list --run` in `server`, `web-ui`, and `packages/catdlg-core`;
  - classifies modules into `code`, `cad`, `platform`, and `caa` suites;
  - builds frontend-shaped plans with include/exclude case and module filtering;
  - runs selected modules/cases with Vitest JSON reporter and returns `UnitTestRunResult`;
  - streams newline-delimited frontend events for start/module/case/done and supports best-effort cancellation of active child processes;
  - backs `/api/runtime-catalog/test-modules` and `/api/runtime-catalog/test-cases`.
- Updated `/api/caa/unit-tests` to use the same Unit Tests service instead of the old fragile parser, while retaining its legacy `{ modules: [...] }` response shape.
- Updated the Unit Tests frontend suite merge helper so native Vitest suites from `/api/unit-tests/suites` are preserved, and the legacy CAA list is only used as a fallback when the general endpoint lacks a native CAA suite.
- Replaced the File Rename 501 route with a native Node service that:
  - validates workspace-local source and target paths;
  - prevents target overwrite and path traversal;
  - renames files on disk;
  - persists rename logs under `.phoenix/rename-logs.json`;
  - exposes rename logs and load/analyze/apply/export routes under `/api/cad/rename/*`;
  - scans and applies text references for renamed basenames as a first migrated pass.
- Added File Rename service and route regression tests for disk rename, log persistence, reference scan, and reference apply.
- Added Node CAA index routes:
  - `GET /api/caa/index/groups`
  - `POST /api/caa/index/scan`
- Updated the web CAA index API client to send the active `workspaceRoot` to these Node routes, while retaining the old 404 fallback for compatibility.
- Added workspace directory validation for CAA index so stale prefs such as `"Cancel"` return `indexed: false` instead of a false successful empty index.
- Fixed syntax damage found in `server/src/routes/cad.ts` after mechanical deduplication and verified the route module imports again.
- Replaced the Code Index empty route bodies with a Node service that:
  - scans the configured workspace for built-in and adopted code/resource extensions;
  - persists route-owned index data per workspace under `~/.phoenix/code-index/<workspace-hash>/`, with matching legacy global JSON migrated on first use;
  - serves paged/filterable entries;
  - exposes `.CATDlg` index entries for CAA navigation;
  - discovers candidate extra extensions while honoring Code Ignore patterns and skipping CAD/binary/archive suffixes such as `.FCStd`, `.STEP`, and `.SLDPRT`;
  - marks rows as `missing` after a subsequent scan no longer sees them;
  - purges missing entries and exports `.phoenix/exports/code_index.json`.
- Added Code Index regression tests for persistence, paging, `.CATDlg` extraction, extra-extension discovery, purge, and export.
- Tightened Code Index legacy migration so `code-index-extra-extensions.json` is only copied when the legacy `code-index.json` belongs to the active workspace; this prevents old global extension preferences from leaking into unrelated workspace-scoped stores.
- Tightened Code Index `filename` search mode to match the old Python contract: `foo.cpp` is an exact filename query, `dir/foo.cpp` is an exact relative-path query, and extensionless terms remain fuzzy filename queries.
- Hardened shell workspace resolution so stale prefs such as `"Cancel"` no longer become fake resolved workspace paths.
- Replaced Code Rename empty preview/apply responses with a Node implementation that:
  - scans the configured workspace or selected scope/workset paths;
  - previews text, file basename, and directory basename replacements;
  - skips binary files and reports conflicts/missing targets;
  - applies text rewrites and path renames inside the workspace only;
  - optionally rescans the Code Index after applying.
- Restored Code Rename workspace-local prefs and automatic run-option persistence, and replaced UTF-8-only text handling with the shared strict UTF-8/GBK codec plus functional `target_encoding` conversion and no-write encoding errors.
- Added Code Rename service/route regression tests for text/file/directory behavior, prefs merging, GBK preservation, target GBK conversion, and lossy-write refusal.
- Replaced Code UUID empty scan/apply responses with a Node implementation that:
  - scans scoped workspace text files for dashed UUIDs, optional 32-hex GUIDs, and CAA/COM GUID literal blocks;
  - returns stable encoded hit ids compatible with the old Python apply flow;
  - previews replacements without writing files;
  - applies only selected hit occurrences inside the workspace;
  - preserves UUID spelling style for braces, hyphens, uppercase hex, and CAA GUID blocks.
- Added Code UUID service and Hono route regression tests for scan, dry-run mapping, selected write behavior, GBK preservation, and ignore-file metadata parity.
- Replaced Reorder Members empty responses with a Node service that:
  - persists page preferences per workspace;
  - lists top-level source-bearing entries and ignored items;
  - resolves workset paths to `.cpp` / header files;
  - runs dry-run/write batches with changed file summaries;
  - reorders `.cpp` `ClassName::member()` blocks with migration-compatible preamble splitting, full special-member ranking, comments/return types/separators, internal-call filtering, and alphabetical stable ordering;
  - reorders header declarations by access section, supports special members, optional member-variable ordering, export macros, nested-type/numbered-Doxygen safety, and Kevin System Code modes;
  - freezes clang-format, Kevin Wizard, CAA2 Wizard, and pragma-region blocks, including nested/overlapping markers;
  - strictly reads and writes UTF-8/BOM or GBK while preserving CRLF and rejecting lossy conversion;
  - exposes a real route self-test.
- Added Reorder Members engine/service/Hono regression tests plus archived Python-output hashes for prefs, discovery, resolve, dry-run, write, encoding, fixture parity, and self-test. Added `iconv-lite` as the explicit GBK codec dependency.
- Replaced FCStd Map native placeholders with a SQLite-backed Node service that:
  - creates/repairs the minimum `phoenix_cad_file_asset` and `phoenix_cad_scan` schema;
  - scans CAD-related files without relying on the `fcstd-query file-upsert` sidecar;
  - returns the frontend `FcstdMapPayload` shape for load/scan;
  - serves paged/filterable entries with live `present` / `missing` disk status;
  - persists scan prefs, records scan history, returns frontend-compatible progress snapshots, purges missing rows, and exports `.phoenix/fcstd_map.json`.
- Applied File Workset scope to FCStd scans, preserved outside-scope DB state, separated current-scan stats from full-map stats, stabilized history ordering, and corrected the Node engine marker.
- Reworked FCStd Map `/scan/start` into a real background operation with asynchronous traversal, asynchronous/cancellable BOM child-process reads, phase/file progress, terminal cancellation semantics, and done/cancelled history persistence.
- Connected FCStd Map Step C to a real BOM XRef rebuild and made scan-history inserts compatible with the migration-era Python `scan_root NOT NULL` schema.
- Added FCStd Map service and Hono route regression tests for prefs, scan/progress, scoped entries, invalid worksets, missing detection, outside-row preservation, purge, export, history, and resume.
- Replaced File Detail BOM attribute Python proxy/stub endpoints with a Node service that:
  - returns the frontend `BomPreview` shape from filename, SQLite fcstd-map hints, and best-effort `fcstd-read` embedded fields;
  - stores BOM apply memory in `.phoenix/phoenix-workspace-prefs.json`;
  - implements prefs, field recommendation, all-field recommendation, recommended fill, filename fill, embedded/preview fill, label formula, document-kind inference, and filename recommendation;
  - fixes the old `PUT /api/cad/bom/file` frontend mismatch by accepting `rel` from the query string and mapping frontend `label` to FCStd `Label`;
  - avoids letting empty DB/embedded fields overwrite useful filename-derived hints.
- Replaced `/api/cad/bom/rename` with the same Node BOM rename service now used by FCStd `/api/file-rename/rename`:
  - rejects unsaved BOM attribute edits unless `write_attrs_first` is set;
  - optionally writes attributes before rename via `fcstd-read write-bom`;
  - performs safe workspace-local disk rename and persists the rename log;
  - updates matching `phoenix_cad_file_asset` SQLite rows while preserving `./` path-key style.
- Added BOM Attribute service and Hono route regression tests for preview/recommend/fill/document-kind/filename/rename flows.
- Replaced the BOM XRef service stub with a Node SQLite read-side implementation that:
  - reads `phoenix_cad_bom_xref` and `phoenix_cad_file_asset` directly;
  - serves meta, counts, incoming transitive hosts, outgoing refs, usage stats, assembly-host catalog, paged edge search, and file-detail xrefs in frontend-shaped payloads;
  - returns explicit `index_pending` payloads when the workspace database or xref table is unavailable;
  - provides a conservative `patch-labels` compatibility path that updates only the SQLite `link_label` snapshot.
- Added a direct FCStd XRef index engine using `fflate` to read `Document.xml`, extract XLink/object-label data, resolve targets, enrich snapshots, atomically rebuild the full table, and delete/replace local host edges.
- Replaced fake host-refresh progress with a background recursive disk rebuild, full frontend-shaped progress payloads, and effective cancellation; wired File Detail's existing `refresh_disk=true` button contract to a real one-host refresh.
- Updated CAD routes so `/api/cad/bom/xref/{meta,incoming,outgoing,counts,usage-stats,edges,rebuild,patch-labels,assembly-hosts,refresh-host-index*}` call the Node service instead of returning hard-coded empty data or relying on unavailable Python fallback.
- Updated `/api/file-detail/xrefs` to use the same Node BOM XRef service, so File Detail's reference tab shares the BOM XRef page behavior.
- Added BOM XRef service and route regression tests for the native SQLite read-side behavior, including transitive incoming hosts and label mismatch/patch coverage.
- Replaced PartKey Python proxy/stub routes with a Node SQLite service that:
  - creates/repairs the minimum `phoenix_cad_part_key` and `phoenix_cad_part_file_link` schema;
  - syncs PartKey rows and file links from `phoenix_cad_file_asset`;
  - serves frontend-shaped catalog/detail payloads plus legacy `items` for old pages;
  - resolves PartKey from filename plus index fallback;
  - patches PartKey metadata and matching file-asset fields;
  - patches per-file link role/notes/status.
- Replaced `/api/cad/bom/xref/assembly-tree` and legacy `/api/cad/bom/tree` with XRef-backed Node read-side tree payloads, including flat `items` for the old CR BOM viewer.
- Replaced `/api/cad/parts/{pn}/{pv}/assembly-tree` with a native route that validates the selected host belongs to the PartKey before returning the XRef-backed tree.
- Updated the Part Catalog page to consume the complete `PartKeysPayload` instead of remapping the response through the old Rust-only `items` shape.
- Added PartKey service and route regression tests for catalog/detail/infer/patch/file-link/assembly-tree behavior.
- Replaced Part Dedup Python proxy/stub routes with a Node service that:
  - persists `part_dedup` prefs under `.phoenix/phoenix-workspace-prefs.json`;
  - validates scan directories and selected extensions;
  - scans workspace files recursively for duplicate filenames, duplicate code groups, and duplicate code+version groups;
  - preserves the old Python `.FCStd` drawing/model duplicate separation;
  - returns frontend-shaped `PartDedupScanResult` payloads with display paths;
  - exports CSV reports to `.phoenix/exports/part_dedup.csv`.
- Added Part Dedup service and route regression tests for prefs, scan, FCStd grouping, CSV export, route shape, and invalid scan-dir handling.
- Replaced XLink Fix Python proxy/stub routes with a Node/SQLite service for prefs, candidate lookup, dry-run analysis, batch execution planning, and manual target override.
- Replaced the duplicate `cad-scan.ts` XLink analyze/run stubs with the same service. This fixes the route-order bug where the earlier `/api/cad` mount could shadow the newer `cad.ts` implementation.
- Kept automatic XLink repair conservative: links that currently resolve on disk are not touched, stale indexed targets must exist, and unresolved automatic matches require an exact FCStd basename; PartKey/prefix candidates remain available for explicit user selection.
- Hardened `fcstd-xlink` write-back so its XML replacement is scoped to `<XLink file>` attributes and its FCStd ZIP replacement works on Windows through a temporary file plus rollback backup.
- Added XLink service, route-order, and Rust real-ZIP regression tests. The native default `all_in_dir=true` flow is covered; the old standalone `Document.xml` mode remains a documented gap.
- Replaced STEP Batch Python Web API proxies with a Node service that:
  - persists the old `step_batch` workspace preference shape;
  - preserves workspace-relative and external absolute directory behavior;
  - computes top-level/deep/selected STEP counts without FreeCAD;
  - resolves FreeCADCmd from Windows, macOS app/Contents/Resources, or an explicit executable;
  - launches the retained FreeCAD runner with the complete legacy `FCD_BATCH_*` environment and parses both console and report summaries.
- Added STEP Batch service and route tests using a real temporary child process. This proves process arguments/environment reach the engine boundary without requiring FreeCAD in CI.
- Corrected stale sidecar documentation: STEP Batch no longer uses a Python HTTP/sidecar service; only the in-FreeCAD adapter remains Python because FreeCAD exposes that conversion API through its Python interpreter.
- Replaced SolidWorks STEP Python/pywin32 Web API proxies with a Node service and a thin Windows PowerShell COM adapter:
  - persists the old `sw_step_export` preference shape and preserves external absolute paths;
  - scans only `.sldprt` and `.sldasm`, with optional recursion;
  - creates and removes per-run JSON job files under `.phoenix/tmp`;
  - propagates `PHOENIX_SW_OPEN_OPTIONS` and `PHOENIX_SW_SAVEAS_SILENT_OPTS`;
  - returns the frontend success/failure/log shape and caps failure detail to 50 rows;
  - leaves already-open SolidWorks documents open while closing documents opened by the adapter.
- Added the missing Node `PUT /api/cad/sw-step/prefs` route; the frontend had always called it, but the earlier migration registered only GET/preview/run.
- Removed the unused `pnwPythonSidecar` module and startup Python availability probe after confirming no production route imports it.
- Added SolidWorks service/route subprocess tests and PowerShell AST/source-contract checks. Real COM behavior remains an explicit licensed-machine acceptance gate rather than being inferred from a fake adapter.
- Removed the final CAD Python proxy infrastructure (`PYTHON_API`, availability checks, proxy/stub helpers) after route-source and consumer audits proved it had no remaining legitimate caller.
- Removed invented `/api/cad/scan/progress`, `/api/cad/scan/recent`, `/api/cad/worksets`, and `/api/cad/bom/batch` aliases. The frontend never called them, the old Python API did not define those contracts, and their real functions are already owned by `/api/cad/fcstd-map/*` and `/api/file-worksets`.
- Removed the duplicate fake worksets handlers from `cad-scan.ts` and changed FCStd entries without a configured workspace from an empty `_stub` success to an explicit HTTP 400.
- Added a CAD native-only source/route invariant so future changes cannot silently reintroduce Python proxy or stub markers into the CAD backend.
- Replaced the File Rename context fallback with the native BOM preview service, so unindexed files receive a real filename/disk/embedded preview rather than an `_stub` payload.
- Removed dead Code-service compatibility exports (`gitWorkspaceInfo`, old rename wrappers, `applyRenameAll`, and `reorderCppFile`) after a zero-caller audit.
- Removed the unconsumed `unit-tests-legacy-disabled` and `runtime-catalog-legacy-disabled` route families; their canonical native routes remain the only supported contracts.
- Removed the obsolete `pdtCodeStub.test.ts` fake-response suite and added focused route assertions for the native File Rename context. A production-source marker scan now has zero stub/proxy/Python-sidecar hits.

## Next migration order

1. Add integration smoke tests that enumerate frontend API calls and fail on missing backend routes.
2. Run browser smoke on real workspaces for FCStd Map, BOM XRef/File Detail, CAA index, Git, and the remaining partial pages; turn each accepted workflow into a route or Playwright regression.
3. Add the now-passing server `tsc --noEmit` command to the normal root/CI verification sequence and fail checkpoints when it regresses.
4. Add/extend route-level tests for CAA index, Git, and partial CAD pages so future checkpoint claims fail fast when a route is missing or returns behavior weaker than the frontend contract.
5. Build a Rust CLI bootstrap script for all required binaries and stop mixing debug/release paths.
6. Replace the CAA index live scan with a persisted/incremental index if the page is expected to scale beyond small workspaces.
7. Finish remaining BOM XRef parity: real `Document.xml` label patching, materialized/cached deep assembly-tree parity, cancellation within very large single-file reads if needed, richer file-detail enrichment, and UI smoke on real CAD workspaces.
8. Finish BOM File Detail write parity: real FCStd Document.xml round-trip tests, drawing source-model/read-only handling, debug/release CLI path cleanup, old prefs parity, and UI smoke on real CAD files.
9. Finish File Rename parity beyond the native disk rename now in place: FCStd ZIP/XLink internal patching, label/reference patch parity, richer transitive xref handling, and UI smoke on real CAD workspaces.
10. Finish PartKey parity beyond the current SQLite sync pass: audit Python edge cases, confirm user metadata preservation rules, add UI smoke, and decide whether PartKey sync should run during FCStd Map scan rather than lazily on Part pages.
11. Finish remaining Code module gaps: Code UUID UI kind controls/suspicious-pattern/report parity, Code Ignore UI smoke/legacy-store retirement, Code Rename path/report/Python edge cases, plus Reorder Members real-workset UI smoke/prefs-location decision and inherited parser edges.
12. Finish Unit Tests / Runtime Catalog parity beyond the current Vitest runner: browser UI smoke, runtime catalog search/status/sync, richer doc extraction, and a decision on whether old Python unittest suites are intentionally retired.
13. Finish XLink Fix parity for legacy standalone `Document.xml` mode, binary bootstrap, and real UI/write smoke; finish STEP Batch and SolidWorks STEP packaging/progress/real-engine smoke. Do not recreate the removed legacy scan/worksets/BOM-batch aliases unless a real consumer and authoritative contract are first identified.
14. Retain only Python that is an explicit external-engine adapter (for example FreeCAD's Python API) until equivalent native bindings exist; remove remaining legacy Python entrypoints only after the page/API matrix and real-engine acceptance checks pass.

## Handover rule

Do not mark a checkpoint complete because a page opens. A page checkpoint is complete only when:

- every frontend API used by the page has a Node/Rust route;
- the route returns the shape expected by `web-ui/src/api.ts`;
- write actions are either fully implemented and tested or intentionally disabled in UI;
- no `_stub`, Python proxy, or empty compatibility response remains on the page's primary workflow;
- a smoke test or manual verification note exists for the page.

## 2026-07-10 functional acceptance and desktop build update

This section supersedes the earlier “next migration order” where the same item has since been completed.

### Representative end-to-end acceptance

- Exercised Git against a disposable real repository through init, status, diff, stage, commit, and restore. Repository-specific `safe.directory` handling is now applied without changing the user's global Git configuration.
- Exercised Code Index scan/query/export/purge and its CATDlg sub-index against a disposable workspace. Code Rename covered exact filenames, case-only changes, text and path changes; Code UUID and Reorder Members performed real writes and disk read-back.
- Built realistic FCStd ZIP fixtures with separate `App::Part` and `App::Link` objects and a three-file hierarchy. The chain covered index scan, BOM/XRef/PartKey reads, BOM property and label writes, broken-link analysis and repair, disk rename, direct/indirect incoming references, transitive apply, report export, and archive-member preservation.
- Fixed `updateFcstdMapEntryRename` so a stale target DB row no longer blocks a valid disk rename, and kept XRef snapshots coherent after the move.
- Corrected FCStd XML mutation across old/new property schemas, object sections, multiline properties, and Windows archive replacement. Real ZIP round-trip regressions cover both native tools.

### CAA browser acceptance and fixes

- CAA Home loaded two indexed dialogs, all 8 catalog types, and 19 control blocks from the disposable workspace.
- The new-dialog flow created `MigrationAcceptanceDlg.CATDlg` and `.CATNls` in a real `.m` module directory; a rescan changed the persistent index from 2 to 3 entries. The files and index entry were then removed and the fixture returned to 2.
- NLS property-sheet editing now records both the IR and default/locale NLS maps in Undo/Redo history. Browser acceptance confirmed edit -> Undo -> Redo -> save -> disk text.
- Grid span resize completed preview -> write -> parse round-trip. A real pointer drag moved `PushButtonPrintMarkdown` from row 0/column 1 to row 1/column 1, with Undo/Redo.
- The drag exposed a product-data bug: rebuilding a moved grid placement discarded `CATGRID_4SIDES`. Drop transforms and both move paths now preserve `anchor`; preview, disk content, and parse round-trip all retained it.
- The disposable PNX CATDlg/CATNls files were restored byte-for-purpose from pre-acceptance backups, and the temporary module directory was deleted.

### Release artifacts

- `pnpm build:tauri-runtime` now builds both native executables, bundles the Node service, smoke-checks it, stages `src-tauri/resources/runtime/runtime-manifest.json` without Python cache files, and starts that final runtime with its own Node binary for a second health/shutdown smoke.
- Product launch exposed that pnpm's `node-sqlite3-wasm` junction had been copied as another repository-pointing symlink. The development bundle smoke therefore passed while release failed with `Cannot find module 'node-sqlite3-wasm'`. Runtime tree copies now dereference links so the package contains physical JS/WASM files.
- `cargo tauri build --no-bundle` produced `src-tauri/target/release/phoenix-desktop.exe`. With port 5180 free it launched its packaged `runtime/node/node.exe`, returned `phoenix-node` protocol 1, displayed both Rust tools as available, and released the port after confirmed desktop exit.
- The release and installed Unit Tests pages each completed 14/14 Code, CAD, Platform, and CAA packaged-resource checks. This is product runtime evidence, not a substitute for repeating every workspace workflow in release.
- Release startup no longer silently reuses a healthy development server on port 5180. Debug builds may reuse it; release builds fail explicitly so they cannot mix packaged UI with repository runtime/user-data paths.
- The project now targets official Tauri NSIS. `pnpm tauri:installer` produced `src-tauri/target/release/bundle/nsis/Phoenix Desktop Tools_0.1.0_x64-setup.exe` (26,037,429 bytes; SHA256 `E3239C4C5737C4AD31F00AFDECD1A91CC7765D191164AE1D917F03D5CD24DA64`). The file is unsigned.
- NSIS installation, launch from the install tree, packaged sidecar, installed 14/14 self-check, clean exit, and uninstall directory cleanup passed. Codex's MSIX test account virtualizes shell known-folders and registry, so ordinary-user Start Menu and Installed Apps registration remain a manual double-click gate rather than a claimed pass.

### Remaining gates

- Manually double-click the generated NSIS outside Codex's MSIX test account and verify the ordinary-user Start Menu target and Installed Apps registration, then uninstall it.
- Repeat representative Shell, File Workset, Git, Code, CAA, and synthetic-FCStd CAD workflows from release or the installed location; only the packaged runtime/Unit Tests/Config exit boundary currently have `D` evidence.
- Run STEP -> FCStd with FreeCADCmd and part/assembly -> STEP with licensed SolidWorks. Source/adapter parity and failure behavior are verified, but real engine success is not.
- Finish the welcome screen's native picker/close-workspace flow and destructive Config factory-reset/desktop-exit boundaries before claiming every Shell surface is complete.

### Shell browser corrections discovered after the first acceptance pass

- Vite prebundled the `phoenix-wing` root barrel while `PnwChoiceDialogHost.vue` loaded the same composable through a Vue subpath. Development mode therefore had two `pnwChoiceDialog` singletons: confirmation buttons received focus but no dialog appeared. `phoenix-wing` is now excluded from dependency prebundling. A clean Vite instance displayed the Config prune confirmation correctly.
- Config's “prune temporary/invalid recent items” route removed duplicate and ephemeral entries but retained nonexistent directories. It now checks directory existence; route regression preserves a valid workspace and reports one pruned missing entry.
- The development Unit Tests runner inherited every `PHOENIX_*` runtime override from the managed server. With `PHOENIX_USER_DATA_DIR` set for acceptance, otherwise isolated route tests shared one real launcher/workspace store and produced nine false Code failures. Source Vitest children now receive a clean environment plus only `PHOENIX_REPO_ROOT`.
- Browser rerun after the environment fix discovered 4 suites / 86 modules and completed the selected Code suite with 73 passed, 0 failed, 0 skipped. Streaming status, the terminal summary, and the watchlist path all rendered correctly.
