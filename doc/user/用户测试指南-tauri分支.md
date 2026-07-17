# 用户测试指南 — tauri 分支

> Python 后端已关闭。全部功能通过 Node.js + Rust 提供。

## 启动

```bash
pnpm build:native
pnpm dev
# → http://localhost:5173
```

## 可测页面

### CAD 模块 ✅

| 页面 | 功能 | 后端 |
|------|------|------|
| CAD 索引 | 扫描文件列表 + 搜索 | TS + Rust SQLite |
| BOM 列表 | 装配清单 + xref 统计 | Rust 原生 |
| 零件目录 | 零件号搜索 | Rust 原生 |
| 零件详情 | 属性 + 装配树 | Rust 代理 |
| 文件详情 | BOM 属性 + 引用关系 | Rust 代理 |
| 改名分析 | 改名日志 + 分析 | Python 代理 |
| 链接修正 | XLink 修正 | Rust fcstd-xlink |
| 编号查重 | 文件名/编号查重 | Python 代理 |
| STEP批量 | 批量转换 | Python 代理 |
| SW→STEP | SolidWorks 导出 | Python 代理 |

### Code 模块 🟡

| 页面 | 状态 | 说明 |
|------|------|------|
| Code 索引 | 可打开 | stub 返回空数据 |
| Code 改名 | 可打开 | stub 返回空数据 |
| Code UUID | 可打开 | stub 返回空数据 |
| C++ 成员排序 | 可打开 | stub 返回空数据 |

### CAA 模块 ✅

CAA 对话框编辑完整可用。

## 单元测试

```bash
pnpm test                    # Desk 应用层测试
pnpm test:ts                 # TS 43 pass

# 测试报告
python3 -m http.server 4173 --directory test-report
# → http://localhost:4173
```

## 已知限制

- **CAD 扫描**：文件列表可刷新，但 BOM 属性提取较慢（逐文件调 Rust CLI）
- **改名/链接修正**：需 Python 后端（freecadcmd 相关）
- **STEP 批量**：需 Python 后端 + freecadcmd
- **Code 模块**：页面可打开，功能 stub 返回空数据

## 启动 Python（需要时）

```bash
python -m phoenix.web --dev   # 已有功能通过降级代理自动切换到 Python
```
