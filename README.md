# phoenix-desk-tools

[Gitee](https://gitee.com/PhoenixWing321/phoenix-desk-tools.git) · MIT

围绕 FreeCAD 工作空间的 **Web 桌面辅助工具**：CAD 索引与检索、BOM、Code 工具等。

## 快速启动

```bash
pnpm install                   # 需 Node.js
pnpm dev                       # 全栈：Vite (:5173) + Node (:5180)
# → 浏览器打开 http://localhost:5173
```

### 构建 Rust 模块

```bash
cargo build --manifest-path server/fcstd-query/Cargo.toml --release
cargo build --manifest-path server/cli/Cargo.toml
```

## 架构

```
前端 Vue 3 → Vite :5173
     │
     ▼ proxy /api/*
Node.js Hono :5180
     ├── /api/cad/*  cad-rust (Rust SQLite + 代理)
     ├── /api/caa/*  CAA 对话
     └── /api/*      待迁移（Python 可选）
```

## 测试

```bash
pnpm test                       # 全量：Rust + TS + CAA (161 pass)

# 分类运行
pnpm test:rust                  # Rust 单元测试（fcstd-reader + fcstd-xlink）
pnpm test:ts                    # TypeScript 测试（server/src/lib/）
pnpm test:caa                   # CAA 测试（catdlg-core + web-ui vitest）
```

### 测试报告

`pnpm test:ts` 自动生成 HTML 报告 `test-report/index.html`。
由于 HTML 需加载 JS 资源，用 HTTP 查看：

```bash
python3 -m http.server 4173 --directory test-report
# → 浏览器打开 http://localhost:4173
```

## 目录

| 路径 | 说明 |
|------|------|
| `server/` | Node.js + Rust 后端 |
| `web-ui/` | Vue 3 前端 |
| `phoenix/` | Python 包（逐步退役） |
| `scripts/` | 命令行工具 |
| `doc/` | 文档 |
