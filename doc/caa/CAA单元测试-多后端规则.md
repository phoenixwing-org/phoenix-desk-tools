# CAA 单元测试 — 多后端规则

> 状态：已定案 · 2026-06-25 · 最后修正 `3858613` squash 后

## 架构规则

```
前端 (Vue) 并行调两个后端，自行合并
  │
  ├─ Python /api/unit-tests/suites
  │   └─ suite_registry.list_suites() → code/cad/platform 套件 (Python unittest)
  │   └─ 含 caa 套件 (backend=vitest，仅当 Node 不可用时作为回落)
  │
  ├─ Node   /api/caa/unit-tests/suites
  │   └─ testCatalog.readModulesByBackend("vitest") → SQLite 读取 vitest 模块
  │   └─ 启动时 refreshVitestCatalog() 扫描 packages/catdlg-core + web-ui
  │
  └─ 前端 mergeSuites() → 合并去重，展示统一列表
```

## 前端 MVC 分离规则

> **强制**：算法逻辑必须抽离到 `web-ui/src/utils/` 纯 TS 模块，Vue 组件只做视图绑定和事件转发。

### 原则

```
Vue 组件 (.vue)          纯 TS 模块 (utils/*.ts)         vitest 单元测试
─────────────           ──────────────────────         ────────────────
模板渲染                export function 纯函数           import { describe, it }
事件转发 (调用函数)      无 Vue/React/DOM 依赖           数据 in → 断言 out
状态绑定 (ref/reactive)  输入明确、输出确定
                                                      不 mock DOM，不 mount 组件
```

### 哪些必须抽离

| 场景 | 抽到 utils | 测试方式 |
|------|-----------|---------|
| 数据合并/去重 | `mergeSuites(py, vitest)` | 数据 in → 断言 suites |
| 列表分类/过滤 | `partitionSuiteIds(suites, ids)` | 输入 ID 列表 → 断言分组 |
| 格式化/排序 | `formatRunSummary(result)` | 输入 result → 断言文本 |
| 状态计算 (computed) | 独立导出函数 | 直接测试函数返回 |
| API 响应映射 | `mapVitestResult(raw)` | 输入 JSON → 断言类型 |

### 哪些留在组件

| 场景 | 留在 .vue | 原因 |
|------|----------|------|
| `onClick` / `@change` | ✅ | DOM 事件转发 |
| `v-for` / `v-if` | ✅ | 模板逻辑 |
| `watch` / `watchEffect` | ✅ | 需要组件生命周期 |
| `ref` / `reactive` 声明 | ✅ | Vue 响应式系统 |
| 调用 API 函数 | ✅ | 组合纯函数 + API |

### 检查清单

- [ ] `utils/*.ts` 文件没有任何 `import { ref } from "vue"` 或 DOM API 调用
- [ ] 每个导出函数都有对应的 `utils/*.test.ts`
- [ ] `.vue` 的 `<script setup>` 里没有超过 5 行的纯计算逻辑（应抽到 utils）
- [ ] vitest catalog 能扫到这个 test 文件（`pnpm vitest list` 可见）

## 关键规则

1. **前端合并两后端数据**：`Promise.all([Python, Node])` → `mergeSuites()` 去重拼接
2. **vitest 有数据时**：跳过 Python 的 `backend=vitest` 套件，以 Node 实时扫描为准
3. **vitest 无数据时**：回落 Python 硬编码的 vitest 模块列表
4. **运行时按 backend 分发**：
   - Python 套件 → Python 流式 `/api/unit-tests/run/stream`
   - vitest-only 套件 → Python `iter_unit_test_run_events` 内部分发到 `vitest_runner.subprocess`
5. **共享 SQLite**：`tests/fixtures/caa/test-catalog.db` — Python 写 unittest 模块，Node 写 vitest 模块
6. **Node 启动时扫描**：`refreshVitestCatalog()` 扫描一次写 DB，后续请求直接读 DB

## 数据流

### 获取套件列表
```
loadSuites()
  │
  ├─ Promise.all([
  │     fetchUnitTestSuites(),     → Python /api/unit-tests/suites
  │     fetchVitestTestList(),     → Node   /api/caa/unit-tests/suites
  │   ])
  │
  └─ mergeSuites(pySuites, vitestModules)
       ├─ vitest 有数据 → 过滤 pySuites 中 backend=vitest 的套件
       │                  追加 Node 实时数据合成的 caa 套件
       └─ vitest 无数据 → 保留 pySuites 中所有套件（含 Python 硬编码 caa）
```

### 展开计划
```
plan_unit_test_run(suite_ids)
  │
  ├─ Python 套件 → _load_modules_plan() → unittest 导入 + 用例枚举
  │
  ├─ vitest 套件 → _is_vitest_module() 跳过 Python 导入
  │               → _fetch_vitest_details() → 调 Node /suites 获取 case_count
  │               → 补充到 plan.modules[]
  │
  └─ modules_for_suite("caa") → 优先读 SQLite DB，回落 VITEST_MODULES 硬编码
```

### 运行测试
```
run/stream 端点
  │
  ├─ is_vitest_only? → run_vitest_suite(subprocess)
  │   └─ npx vitest run --reporter json（无流式进度，一次性返回）
  │
  └─ Python 套件 → unittest.TestResult 逐用例流式 yield
```

## 关键实现细节

### 前后端分离

| 函数 | 位置 | 职责 |
|------|------|------|
| `mergeSuites` | `web-ui/src/utils/unitTestBackendSplit.ts` | 合并 Python + Node 套件，去重 |
| `partitionSuiteIds` | 同上 | 按 backend 拆分 suite ID 列表 |
| `collectVitestModules` | 同上 | 收集 vitest 套件的模块名 |

### Python 端 vitest 判断

| 函数 | 职责 |
|------|------|
| `_is_vitest_module(name)` | 检测 `/` + `.test.ts` → 前端 TypeScript 模块 |
| `_get_vitest_suite_ids()` | 从 VITEST_MODULES key 获取 vitest 套件 ID |
| `_fetch_vitest_details(modules)` | 调 Node `/suites` 获取 case_count |
| `modules_for_suite("caa")` | 优先读 SQLite DB（12 真实模块），回落硬编码 |

### Node 端

| 端点 | 方式 | 说明 |
|------|------|------|
| `GET /suites` | `readModulesByBackend("vitest")` | 只返回 vitest 模块（不返回 python） |
| `POST /refresh` | `refreshVitestCatalog()` | 手动刷新 vitest 目录扫描 |
| `POST /run` | `pnpm vitest run --reporter verbose` | 运行指定模块 |

## 测试

| 文件 | 内容 |
|------|------|
| `web-ui/src/utils/unitTestBackendSplit.test.ts` | mergeSuites (4) + partitionSuiteIds (5) + collectVitestModules (3) — 12 测试 |
| `server/caa/src/routes/unit-tests.test.ts` | parseVitestList + parseVitestResult 纯函数测试 |
| `packages/catdlg-core/src/emitCatDlg*.test.ts` | CAA 对话框 emit 测试 |
| `web-ui/src/utils/caaDialogTree.test.ts` | 跨容器拖放数据测试 |

## 文件位置

| 层 | 文件 | 职责 |
|----|------|------|
| Python 注册 | `phoenix/testing/suite_registry.py` | 套件元数据、SQLite 同步、模块分类 |
| Python 运行 | `phoenix/testing/runner.py` | run/plan/stream、vitest-only 分发 |
| Python 子进程 | `phoenix/testing/vitest_runner.py` | subprocess vitest JSON→结构化结果 |
| 共享 DB | `server/src/testCatalog.ts` | node-sqlite3-wasm → phoenix-wing PnwDbAdapter |
| Node 端点 | `server/caa/src/routes/unit-tests.ts` | vitest list 扫描 + run + 纯函数 parse |
| 前端合并 | `web-ui/src/utils/unitTestBackendSplit.ts` | mergeSuites 等纯函数 |
| 前端页面 | `web-ui/src/pages/UnitTestsPage.vue` | loadSuites 合并 + 按 backend 展示 |
| 前端 API | `web-ui/src/api.ts` | fetchVitestTestList, runUnitTestsStream |
| 前端测试 | `web-ui/src/utils/unitTestBackendSplit.test.ts` | 合并/拆分 纯函数测试 |
