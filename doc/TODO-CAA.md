# CAA 模块 — 待办（TODO-CAA）

> **总索引**：[TODO.md](TODO.md)  
> **概览**：[caa/CAA模块-概览.md](caa/CAA模块-概览.md)  
> **规划**：[caa/CAA对话框-Web编辑器-规划.md](caa/CAA对话框-Web编辑器-规划.md)  
> **P0 归档**：[caa/CAA对话框-P0快速原型-归档.md](caa/CAA对话框-P0快速原型-归档.md)  
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
| C0b · 脚手架 | `server/caa` + `catdlg-core` + Vite 代理 | [x] |
| C1 · 解析 | core + API（Vitest 待补） | [x] |
| C2 · 预览 | `web-ui` CAA 页 + 壳层侧栏 | [x] |
| C2b · 索引 | `phoenix_caa_*` + 检索侧栏 | [ ] |
| C2c · 多 Tab | 每对话框 Tab + 树联动 | [ ] |
| C3 · 写回 | emit + `/api/caa/write` | [ ] |
| C4 · P2 | Wizard + 控件补全 | [ ] |
| C5 · 后期 | VS Code 扩展 POC | [ ] |

---

## C0b · 脚手架

- [x] `packages/catdlg-core/package.json` + `schema.ts`
- [x] `server/caa/` Hono `/api/caa/health`
- [x] `web-ui/vite.config.ts` 增加 `/api/caa` 代理
- [x] 根 `pnpm dev:caa` 脚本
- [x] `server/caa/README.md`

---

## C1 · 解析

- [x] `parseCatDlg` / `parseCatNls` / `mergeIr`
- [ ] `control_catalog.json` + Vitest（`PNXBomAnalysisDlg`）
- [x] `POST /api/caa/dialog/parse`

---

## C2 · Web 预览（P0 已归档）

- [x] `CaaDialogEditorPage` + Canvas + Grid 预览
- [x] 左栏 `CaaDialogTreePanel` + `useCaaDialogPropertySheet`
- [x] Ribbon Code · **CAA** 独立分组
- [x] 对话框固定宽 500px、内部铺满；属性单行省略
- [x] 编辑页画布下方「关联文件」表（文件名 + 相对路径）
- [x] 预览控件：TabContainer / TabPage / Radio / Check / Combo / Spinner / Separator / Container
- [ ] 工作空间任意 `.CATDlg` 打开（非 demo）
- [ ] 画布点击选中控件高亮
- [x] 关联文件表 · 点击行弹窗预览（文本 / 位图）

## C2b · 对话框索引（`phoenix_caa_*`）

- [ ] `phoenix/caa/schema.py` + migrate（`phoenix_caa_scan` / `phoenix_caa_dialog` / group）
- [ ] `POST /api/caa/index/scan` · `GET …/groups` · FTS 检索
- [ ] 左栏可折叠 **对话框索引** 块（按 `*UI.m` 分组）

## C2c · 多 Tab 打开

- [ ] `caa_dialog.max_tabs` → 8；`openCaaDialogTab(catDlgRel)`
- [ ] 工作空间树点 `.CATDlg`；Tab 级 store（每 Tab 独立 IR）
- [ ] 见 [CAA对话框索引与多Tab-规划.md](caa/CAA对话框索引与多Tab-规划.md)

---

## C3–C5

见 [规划 §8–11](caa/CAA对话框-Web编辑器-规划.md)。

---

## 永久不做

- [x] Python 实现 CAA 业务
- [x] 回调 / Agent 图形化

---

*与 Code 模块共用 `PNXCaaStudy` fixture，进程独立。*
