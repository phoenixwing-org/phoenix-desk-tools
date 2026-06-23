# CAA 模块 · 概览

> [文档索引](../文档索引.md) · 待办：**[TODO-CAA.md](../TODO-CAA.md)** · P0 归档：**[CAA对话框-P0快速原型-归档.md](CAA对话框-P0快速原型-归档.md)**  
> 架构：**一个前端 `web-ui` + 双后端**（Python `phoenix/web` + Node `server/caa`）

---

## 定位

Phoenix 壳内的 **CAA 对话框布局编辑器**：`.CATDlg` / `.CATNls` → **IR** → 预览与写回。

| 项 | 说明 |
| --- | --- |
| **前端** | **`web-ui/`** 内 CAA 页（与 CAD/Code 同壳） |
| **后端 · CAA** | **`server/caa/`**（Node · 全 TS · `catdlg-core`） |
| **后端 · 其它** | **`phoenix/web/`**（Python · 不变） |
| **不替代** | 回调、DialogAgent（[规划 §1.1](CAA对话框-Web编辑器-规划.md#11-范围拍板2026-06-23)） |
| **后期** | `catdlg-core` 封装给 **VS Code 扩展**（[规划 §11](CAA对话框-Web编辑器-规划.md#11-后期web-与-vs-code-封装)） |

```
web-ui :5173
  /api/caa/*  →  server/caa :5180
  /api/*      →  phoenix/web :8765
```

---

## 目录（预期）

```text
web-ui/src/…/caa/          # 编辑器 UI
server/caa/                # Node API
packages/catdlg-core/      # parse · emit · IR（无 Vue）
phoenix/web/               # Python（无 CAA 业务）
```

---

## 文档与 fixture

| 文档 | 说明 |
| --- | --- |
| [CAA对话框-Web编辑器-规划.md](CAA对话框-Web编辑器-规划.md) | 主规划 |
| [CAA对话框-P0快速原型-归档.md](CAA对话框-P0快速原型-归档.md) | **P0 已落地**（解析 + 预览 + 壳层侧栏） |
| [CAA对话框索引与多Tab-规划.md](CAA对话框索引与多Tab-规划.md) | 索引库 `phoenix_caa_*`、检索侧栏、多 Tab |
| [../code/测试工程外链-fixture.md](../code/测试工程外链-fixture.md) | `PNXCaaStudy` |

---

*待办：[TODO-CAA.md](../TODO-CAA.md)*
