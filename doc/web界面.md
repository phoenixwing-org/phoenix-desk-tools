# Web 前端 — 可行性分析

> 状态：**W0 壳层完成 · 各页已接入 Web API · 新手指引已落地**  
> 存储目标与 [Phoenix工作空间存储-规划讨论.md](Phoenix工作空间存储-规划讨论.md) 一致：**默认 SQLite（`.phoenix/`），按需导出 JSON**。

---

## 1. 目标

用 **Web 前端**（Vue 3 + Vite + pnpm + TypeScript）+ **Python 服务端**，逐步替代 CustomTkinter 桌面壳；**后台复用现有 `fcdesk/`、`scripts/` 逻辑**，不重写 BOM / XLink / 扫描算法。

---

## 2. 架构草图

```
浏览器 (Vue3)
    │  HTTP / WebSocket（可选：长任务进度）
    ▼
Python 服务（FastAPI / 现有模块封装）
    │  phoenix_store（SQLite）
    ▼
<工作空间根>/.phoenix/phoenix.sqlite
    │  按需导出
    ▼
exports/*.json  （含 fcstd_map、偏好快照等）
    │
    ▼
*.FCStd、Document.xml（CAD 真源，不变）
```

- **不默认**在工作空间根写 `.phoenix-freecad-desktop.json`；Web 与桌面共用同一 SQLite。
- 需要与 **xlink 脚本** 或外部工具对接时，提供 **「导出 JSON」**（如 `fcstd_map.json`）到用户指定路径。

---

## 3. 可行性

| 维度 | 评估 |
| --- | --- |
| **业务逻辑** | 已集中在 Python（`fcstd_mapping`、`fcstd_document_bom_props`、`fix_fcstd_xlink_paths` 等），适合作为 API 层调用 |
| **状态持久化** | 规划改为 `.phoenix` SQLite 后，Web/桌面共享同一数据源，避免双写 JSON |
| **文件系统** | 工作空间树、改名、ZIP 写回仍需服务端能访问本地路径（部署形态：本机服务或内网 NAS） |
| **FreeCAD / COM** | STEP 批量、SW 导出仍依赖本机 FreeCAD / Windows COM，Web 只能触发任务 + 轮询报告 |
| **认证** | 若仅本机 `127.0.0.1`，可暂不做；多用户需后续补 |

**结论**：**可行**，建议 **本机 Python 服务 + 浏览器 UI** 为第一版；与桌面壳并行一段时间，Store 层统一后再弱化 Tk 壳。

---

## 3.1 样例已实现（W0 子集）

| 组件 | 路径 |
| --- | --- |
| 服务层 | `fcdesk/services/` — workspace、bom_apply、launcher、fcstd_map、xlink_fix、part_dedup、step_batch、sw_step_export |
| API | `fcdesk/web/app.py` — `python -m fcdesk.web` |
| 前端 | `web-ui/` — Vue3 + Vite + TS（壳层 + 配置 + 属性回写 + FCStd 索引 + XLink + 查重 + STEP + SW→STEP） |
| 启动器配置 | 本机 `…/phoenix-wing/fcdesk/launcher.json`（见 [启动器配置路径-规划讨论.md](启动器配置路径-规划讨论.md)） |
| CAD 索引库 | `<工作空间>/.phoenix/cad-database.sqlite`（扫描后按需导出 `fcstd_map.json`） |
| 运行说明 | [web-ui/README.md](../web-ui/README.md) |
| 新手指引 | [新手指引.md](新手指引.md)、[Web壳层-使用说明.md](Web壳层-使用说明.md) |

```bash
pip install -e ".[web]"
cd web-ui && pnpm install
python -m fcdesk.web --build -w /path/to/workspace
# 浏览器 http://127.0.0.1:5173 （单端口：API + 前端）
```

~~双终端 Vite 5173 + API 8765~~ 已改为 **单服务默认 5173**，见 [web-ui/README.md](../web-ui/README.md)。

---

## 4. 建议分期

| 期 | 内容 |
| --- | --- |
| **W0** | `phoenix_store` + 偏好读写 API；Vue 壳 + 工作空间选择 |
| **W1** | 工作空间树扫描、属性回写只读/写入 API |
| **W2** | 改名、推荐文件名、导出 JSON |
| **W3** | XLink 预览/执行、FCStd 索引、长任务进度 |
| **W4** | 壳层 Tab（**主内容区顶**）+ session 持久化；每页 `max_tabs` 见 `app_config.workbench`（[讨论稿](Web壳层-Tab与状态持久化-规划讨论.md) §8） |

---

## 5. 与现有文档

- **首次使用**：[新手指引.md](新手指引.md)、[快速开始.md](快速开始.md)
- **Web 壳操作**：[Web壳层-使用说明.md](Web壳层-使用说明.md)
- 路径与偏好：[路径与目录显示约定.md](路径与目录显示约定.md)（**目标态**见 Phoenix 存储讨论）
- 改名 / XLink 审计：[改名与XLink引用修正-规划讨论.md](改名与XLink引用修正-规划讨论.md)
- 桌面启动器：[桌面工具-使用说明.md](桌面工具-使用说明.md)
