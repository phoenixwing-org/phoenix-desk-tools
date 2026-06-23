# CAA 模块 — 待办（TODO-CAA）

> **总索引**：[TODO.md](TODO.md)  
> **概览**：[caa/CAA模块-概览.md](caa/CAA模块-概览.md)  
> **规划**：[caa/CAA对话框-Web编辑器-规划.md](caa/CAA对话框-Web编辑器-规划.md)  
> 状态：`[ ]` 未做 · `[~]` 进行中 · `[x]` 已完成

最后更新：2026-06-23

---

## 架构（已拍板）

| 层 | 路径 | 技术 |
| --- | --- | --- |
| **前端** | `web-ui/` | Vue（一个前端） |
| **后端 A** | `phoenix/web/` | Python（CAD/Code/Git…） |
| **后端 B** | `server/caa/` | Node + `packages/catdlg-core` |
| **后期** | VS Code 扩展 | 复用 `catdlg-core`，封装另立项 |

Vite：`/api/caa` → Node；`/api` → Python（**caa 规则在上**）。

---

## 里程碑

| 阶段 | 目标 | 状态 |
| --- | --- | --- |
| C0 · 文档 | 规划、双后端决策 | [x] |
| C0b · 脚手架 | `server/caa` + `catdlg-core` + Vite 代理 | [ ] |
| C1 · 解析 | core + Vitest | [ ] |
| C2 · 预览 | `web-ui` CAA 页 + `/api/caa/parse` | [ ] |
| C3 · 写回 | emit + `/api/caa/write` | [ ] |
| C4 · P2 | Wizard + 控件补全 | [ ] |
| C5 · 后期 | VS Code 扩展 POC | [ ] |

---

## C0b · 脚手架

- [ ] `packages/catdlg-core/package.json` + `schema.ts`
- [ ] `server/caa/` Hono `/api/caa/health`
- [ ] `web-ui/vite.config.ts` 增加 `/api/caa` 代理
- [ ] 根或 `server/caa` 的 `pnpm dev` 脚本
- [ ] README：开发须起 Python `--dev` **与** Node CAA 服务

---

## C1 · 解析

- [ ] `parseCatDlg` / `parseCatNls` / `mergeIr`
- [ ] `control_catalog.json` + Vitest（`PNXBomAnalysisDlg`）
- [ ] `POST /api/caa/dialog/parse`

---

## C2 · Web 预览

- [ ] `web-ui`：`CaaDialogEditorPage` + Canvas + 树
- [ ] Ribbon / 导航注册
- [ ] 复用 Phoenix 工作空间根（body 传 workspace 或由 Node 读 env）

---

## C3–C5

见 [规划 §8–11](caa/CAA对话框-Web编辑器-规划.md)。

---

## 永久不做

- [x] Python 实现 CAA 业务
- [x] 回调 / Agent 图形化

---

*与 Code 模块共用 `PNXCaaStudy` fixture，进程独立。*
