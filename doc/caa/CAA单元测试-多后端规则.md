# CAA 单元测试 — 多后端规则

> 状态：已定案 · 2026-06-25

## 架构规则

```
前端 (Vue) 并行调两个后端，自行合并
  │
  ├─ Python /api/unit-tests/suites  → code/cad/platform 套件
  ├─ Node   /api/caa/unit-tests/suites → CAA vitest 套件
  │
  └─ 前端合并 → 统一展示
```

## 关键规则

1. **前端合并两后端数据**：`Promise.all([Python, Node])` → 拼接 suites 列表
2. **运行时按 backend 分发**：Python 套件 → `/api/unit-tests/run`，vitest 套件 → `/api/caa/unit-tests/run`
3. **Node 只负责 vitest**：`vitest list` 文本解析 + `vitest run` 子进程
4. **Python 不感知 vitest**：suite_registry 中 `backend` 字段仅用于前端路由，Python 不调 Node
5. **`backend` 字段**：前端用 `suite.backend` 决定调哪个 run 端点

## 数据流

### 获取套件列表
```
前端 Promise.all([
  fetchUnitTestSuites(),       → Python → code/cad/platform
  fetchVitestTestList(),       → Node   → caa (vitest list → modules[])
])
前端合并 suites.value = [...pySuites, vitestSuite]
```

### 展开计划
- Python 套件：`fetchUnitTestPlan(ids)` → Python POST /plan
- vitest 套件：前端直接用 vitest suites 数据构建 plan（已有 modules + cases）

### 运行测试
- Python 套件：`runUnitTests(ids)` → Python POST /run
- vitest 套件：`fetch("/api/caa/unit-tests/run", {modules})` → Node POST /run

## 文件位置

| 层 | 文件 | 职责 |
|----|------|------|
| Python 注册 | `phoenix/testing/suite_registry.py` | 套件元数据（含 backend 字段） |
| Node 端点 | `server/caa/src/routes/unit-tests.ts` | vitest list 解析 + run |
| 前端 | `web-ui/src/pages/UnitTestsPage.vue` | 双后端合并 + 按 backend 分发 |
| 前端 API | `web-ui/src/api.ts` | fetchVitestTestList
