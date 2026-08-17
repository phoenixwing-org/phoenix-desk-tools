# 架构迁移计划：渐进式 Node.js + Rust 后端

> **当前阶段**：不改 Python，BOM 新功能走 Node.js Hono + Rust。纯 Web 调用。
> **远期方向**：新架构成熟后，用户决定是否迁移 Python、是否打包 Tauri exe。

## 1. 现状 (AS-IS)

```
┌── CustomTkinter 桌面启动器 ──────────────────────────┐
│  python -m phoenix.web --dev                          │
│                                                       │
│  ┌──────────────────────┐  ┌──────────────────────┐   │
│  │ Python FastAPI :8765  │  │ Node.js Hono :5180    │   │
│  │ • BOM 扫描/计算       │  │ • CAA 对话解析        │   │
│  │ • CAD 文件索引        │  │ • 单元测试运行        │   │
│  │ • 代码工具 (rename…)  │  │                       │   │
│  │ • Git 集成            │  │                       │   │
│  │ • FCStd 属性读写      │  │                       │   │
│  │ • …30+ API 端点       │  │                       │   │
│  └──────────────────────┘  └──────────────────────┘   │
│           ↑                        ↑                  │
│           └────────┬───────────────┘                  │
│                    │ HTTP                              │
│           ┌────────┴────────┐                         │
│           │ Vue 3 Web 前端   │                         │
│           │ (Vite :5173)     │                         │
│           └─────────────────┘                         │
└──────────────────────────────────────────────────────┘
```

**问题**：
- 两个后端（Python + Node.js），开发和部署都重
- Python 打包（PyInstaller）体积大，不能嵌入 Tauri
- Python 不能跑在 VSCode 插件里
- 新功能（BOM 直接读 FCStd）用 Rust 实现，调 Python 是多余的一层

## 2. 目标 (TO-BE)

```
┌── Tauri 桌面壳 / VSCode 插件 / 浏览器 ──────────────┐
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │     Node.js Hono 服务器 (唯一后端) :5180          │ │
│  │                                                  │ │
│  │  /api/caa/*        CAA 对话（已有）              │ │
│  │  /api/bom/*        BOM 读取（新增）              │ │
│  │  /api/cad/*        CAD 索引（迁移自 Python）     │ │
│  │  /api/code/*       代码工具（迁移自 Python）     │ │
│  │  /api/git/*        Git（迁移自 Python）          │ │
│  │                                                  │ │
│  │  核心模块：                                       │ │
│  │  • fcstd-reader (Rust → napi-rs)  FCStd 读取     │ │
│  │  • catdlg-core (TS)              CAA 解析        │ │
│  │  • sqlite3-wasm                  数据存储        │ │
│  └──────────────────────────────────────────────────┘ │
│           │                                           │
│           ├── Rust napi 模块（性能关键路径）           │
│           │   • fcstd-reader: ZIP→XML 解析             │
│           │   • (未来) freecad-sidecar: XYZ 包围盒     │
│           │                                           │
│           └── 前端（不变）                              │
│               Vue 3 + Element Plus + Vite              │
└──────────────────────────────────────────────────────┘
```

### 可部署形态

| 形态 | 说明 |
|------|------|
| **Web 开发** | `pnpm dev` → Hono :5180 + Vite :5173 |
| **Tauri 桌面** | Tauri 壳 → 内嵌 Hono 服务 + WebView 前端 |
| **VSCode 插件** | 插件激活 → 启动 Hono 服务 → WebView 面板 |
| **独立 exe/dmg** | Tauri 打包，零依赖（不含 Python） |

## 3. 可行性分析

### 3.1 Rust → Node.js 调用

| 方式 | 可行性 | 推荐 |
|------|--------|------|
| **子进程 CLI** (`child_process.execFile`) | ✅ 简单，Rust 编译成独立二进制 | 当前阶段 |
| **napi-rs 原生模块** | ✅ 零 IPC 开销，直接 `require()` | 生产阶段 |
| **WASM** | ⚠️ 不能读本地文件系统 | 不适用 |

### 3.2 Python → Node.js 迁移评估

| 模块 | Python 文件 | 复杂度 | 迁移策略 |
|------|-----------|--------|---------|
| BOM 文件读取 | `fcstd_document_bom_props.py` | 中 | Rust 重写（已完成 `fcstd-reader`） |
| BOM 森林计算 | `bom_compute.py` | 中 | TypeScript 重写 |
| CAD 文件索引 | `cad_index/*` | 高 | 逐功能迁移 |
| FCStd XLink 解析 | `bom_xref/extract.py` | 低 | 并入 Rust `fcstd-reader` |
| 文件改名引用修复 | `rename_analysis/*` | 高 | 后阶段 |
| 代码工具 | `code/*` | 高 | 后阶段 |
| Git 集成 | `git_workspace.py` 等 | 低 | 可复用 `simple-git` npm 包 |
| STEP 批量转换 | `batch_step/*` | 中 | 需要 FreeCAD sidecar |

### 3.3 关键风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Python 代码量大（~30 个服务文件） | 迁移周期长 | 分阶段，新功能直接写 Node.js |
| FCStd 几何计算依赖 FreeCAD | XYZ 包围盒绕不开 | 保留 freecadcmd sidecar |
| SQLite 格式兼容 | 旧 Python 数据库 | Node.js 用 `node-sqlite3-wasm`（phoenix-wing PnwDbAdapter） |
| 团队对 Rust 不熟 | 维护成本 | Rust 只用在性能关键路径（FCStd 解析） |

## 4. 路线图

### Phase 1：BOM 新功能走 Node.js + Rust（当前）

**改什么**：
- `server/` 下加 Rust fcstd-reader crate + CLI
- `server/src/routes/bom.ts` — Hono BOM 路由
- `web-ui` 加 BOM 查看页
- **不改 Python 任何代码**，Python FastAPI 继续服务旧功能
- **纯 Web 调用**，不做 Tauri 打包

**完成后**：BOM 读取多了一条路径——Node.js 直接调 Rust 读 FCStd（毫秒级），与 Python BOM 扫描共存。

```
                 ┌── Python FastAPI :8765 ──┐
                 │  (旧 BOM/索引/工具)       │
                 └──────────────────────────┘
                          │
用户 ──→ Vue 前端 ──→ HTTP
                          │
                 ┌────── Node.js Hono :5180 ─┐
                 │  /api/caa/*  CAA（旧）      │
                 │  /api/bom/*  BOM（新）← Rust│
                 └──────────────────────────┘
```

### Phase 2：BOM 模块从 Python 迁到 Node.js（用户决定）

**触发条件**：Phase 1 的 Rust BOM 路径成熟稳定，Node.js Hono 服务运行良好。

**迁什么**：
- `bom_compute.py` → TypeScript
- `bom_xref/` → 并入 Rust fcstd-reader
- `bom_apply_service.py` → TypeScript
- Python `/api/bom/*` 端点 → Node.js `/api/bom/*`

**不迁什么**：CAD 索引、代码工具、Git——这些继续跑在 Python 上。

### Phase 3：其他模块迁移（用户决定）

代码工具、Git、CAD 索引等逐个评估和迁移。

### Phase 4：去 Python + Tauri 打包（用户决定）

**触发条件**：所有 Python 功能已在 Node.js 重建完成且稳定。

- 删除或冻结 Python 后端
- Tauri 壳包装，打 exe/dmg
- 可选：VSCode 插件

## 5. 目录结构（Phase 1 结束时）

```
phoenix-desk-tools/
├── server/                  # Node.js 后端（不重命名，保持现状）
│   ├── fcstd-reader/            # Rust crate: FCStd ZIP→XML 解析
│   ├── cli/                     # Rust CLI: fcstd-read 命令
│   ├── src/
│   │   ├── server.ts            # Hono 入口（修改：注册 bom 路由）
│   │   └── routes/
│   │       ├── dialog.ts        # CAA（原有）
│   │       ├── unit-tests.ts    # 单元测试（原有）
│   │       └── bom.ts           # BOM（新增）
│   └── package.json
├── web-ui/                      # Vue 3 前端
│   └── src/pages/
│       ├── BomExportPage.vue    # 原有
│       └── BomViewerPage.vue    # 新增（调 Node.js BOM API）
├── phoenix/                     # Python 代码（不动）
│   └── web/app.py               # FastAPI（继续运行）
└── ...
```

## 6. 当前 Phase 1 实施清单

- [ ] `server/fcstd-reader/` — Rust crate 编译通过
- [ ] `server/cli/` — `fcstd-read` 命令可用
- [ ] `server/src/routes/bom.ts` — BOM API 路由
- [ ] `server/src/server.ts` — 注册 BOM 路由
- [ ] `web-ui/src/pages/BomViewerPage.vue` — BOM 查看页
- [ ] 端到端：选 FCStd 文件 → 前端调 API → Rust 解析 → 显示表格
- [ ] 不删 Python 任何代码

## 7. 决策记录

| 决定 | 理由 |
|------|------|
| Phase 1 不删 Python | 旧功能继续跑，新功能（BOM 直读）走 Node.js |
| Phase 1 不做 Tauri 打包 | 先以 Web 形态验证，成熟后再封装 |
| 不创建 `server/bom/` 独立服务 | 统一到 CAA Hono 服务，减少进程数 |
| Rust 用 CLI 子进程 | 当前简单，后续可换 napi-rs |
| 迁移节奏由用户决定 | Phase 2/3/4 的触发条件是当前阶段稳定可用 |
| FCStd 几何 XYZ 仍走 freecadcmd | OpenCASCADE 无 Rust/JS 替代品 |
