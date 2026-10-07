# Desk Code 功能退役与保留边界

状态：current · 适用：develop · 决策日期：2026-10-04；独立改名任务补充：2026-10-06

## 产品决定

Desk 的 Code 区只保留 **忽略设定** 与 **CAA 对话框**（列表、编辑器、NLS、草稿、VS Code 交接）。代码索引、成员排序、批量改名、UUID 替换以 KT Auto Code 为主；自动代码从 Desk 移除。不再以“同样好用”为目标维护第二套编辑器工具。

这不改变 CAD 批量工具、FreeCAD 属性写回、CAD 索引诊断与查询，也不移除通用 Git、工作集、测试、文件编码和工作空间安全能力。不修改 KT Auto Code 或 Wing。

2026-10-06 增加领域无关的「批量改名」任务入口，见下文；它不恢复本表中的旧页面/API、Code 索引、自动重扫或单旧名/新名流程。

| 退役 page id | 原功能 | 当前处理 |
| --- | --- | --- |
| `code_index` | Code 索引与扫描 | 删除独立 View、扫描/清理/查询流程 |
| `reorder_members` | C++ 成员排序 | 删除 View、排序服务及专属 Git 路由 |
| `code_rename` | Code 批量改名 | 删除 View、预览/写入服务和改名后重扫依赖 |
| `code_uuid` | UUID 替换 | 删除 View、扫描/替换服务 |
| `kt_codegen` | 自动代码 | 删除参数表、预检、Apply、报告与 Host 接线 |

## 兼容与数据保护

- Ribbon、主页、帮助、页面注册和 Tab 配置不再展示五项退役能力。
- 旧 URL / 持久化 Tab 映射至 CAA 首页；不把旧 Codegen 草稿、上下文、dirty 状态冒充为 CAA 会话。保留的 CAA 编辑器状态不受影响。
- 原 30 个 HTTP 方法/路由均不再注册，返回 **404**；不能仅隐藏按钮后仍允许外部调用扫描或写入。
- 不执行 `DROP TABLE`、删除工作空间库、删源文件或批量清理偏好；旧 Code 索引表和设置留在原库，可供用户后续单独决定迁移/清理。退役实现可从 Git 历史找回。
- 忽略设定仍支持 `code.ignore`、工作空间自定义规则及旧来源兼容。当前不再有已接线的 Code 消费工具，不能声称 CAA 已消费这些规则；保留设置不等于启动全量源码扫描。
- CAA 自己的对话框发现/索引保留，不依赖退役的 `phoenix_code_*` 扫描器。

## 独立改名任务（2026-10-06）

新增 `rename_tasks` View 与 `/api/rename-tasks`，位于「工具 → 批量改名」，CAD、Code 或无领域工作空间均可进入。旧 `code_rename` URL/会话回退和旧 API 404 继续有效。不是从 Git 整页恢复旧实现：保留 Wing Code 替换规则，扩展为任务化配置和多目录安全预览。

任务保存于工作空间 SQLite 的 `batch_rename_tasks_v1` 偏好区，一个空间最多 100 个任务；每个任务有稳定 ID、配置版本、名称、最多 2000 条可启停 A→B 规则、最多 12 个目录及文件名/文本/不含扩展名选项。可复制任务尝试另一组规则，副本不复制可执行计划或历史。保存不改目标文件；搜索前保存当前配置，改动使上次预览失效。

规则为区分大小写、最长匹配、一次字面替换，不是正则，不根据 CAD 属性推导名称。重复旧名不同新名、连续链/循环/交换须先人工整理为最终映射；新名作为保护项，重复预览不再扩大已生成的新名。目录名不改，保持 UTF-8/BOM/GBK 编码；FCStd 与 CATPart、CATProduct 等关联模型不可通过普通改名执行器绕开关联修正；CATDrawing 勾选后可仅修改文件名，保留后缀，内部内容及引用不变。STP/STEP 同样仅改文件名，其内部内容不参与文字替换。STEP 头部路径隐私清理另列 TODO，不自动启用，也不宣称完整脱敏。

后缀筛选与关联文档同步共用按工作空间/目录的本机缓存；同后缀大小写合并，新后缀提示但不自动勾选文件，隐藏项取消应用勾选。新预览默认零勾选。

每次预览或应用单独记录，任务中保留最近 30 次摘要。执行计划仍仅在服务内存中，绑定工作空间、任务 ID、配置版本、文件指纹及选中项，30 分钟有效，应用一次即失效；任务和计划不能跨入口复用。原件与逐项回执放在各目录 `.phoenix/rename-task-backups`。失败继续其他独立项，Bottom 展示错误；完成通知框架刷新树，不自动提交 Git 或扫描 Code/CAD 索引。没有跨文件原子事务或自动回滚承诺。

分离顺序：先验证本独立 View，再把 CAD 关联文档页面改为记录到最终映射的适配入口。当前两个入口界面保持独立，仅底层通用安全执行器复用；交接按钮尚未接入。任务删除/归档、未保存草稿恢复、完整历史运行回执浏览见 [总 TODO](../TODO.md)。

## 去重复与发行边界

- 删除专属页面、store、composable、模型和 API client；保留通用 Host/Workbench 能力。
- 删除后端 `pdtCodeService`、`ktCodegenService`、`reorder*` 引擎与专属测试，新增退役/数据保全契约测试。
- Server / Web 移除 `@phoenix-wing/kt-codegen` 直接依赖；Web 不再直接消费 `code-core`。Server 仍消费 `code-core` 的忽略、路径及 CAA 交接契约。
- 本地 Wing resolver 不再要求或构建 Codegen；manifest/lock 仍是精确 Registry 版本，无 link/file/workspace override。
- Tauri release smoke 不再运行 Codegen 示例写入，改为实测 30 条退役 API 404，继续验证健康、隔离工作空间、runtime 资源、真实 FCStd 读取和退出回收。回执 `schemaVersion=2`；Windows 检查实际结果，不能用固定 `true` 冒充通过。
- 删除过时的 `.tmp/accept-packaged-pages.mjs` 手动验收入口。Python 历史源码及仍有历史测试消费者的 fixture 不在本轮清理范围；它们不属于当前 Node/Web/Tauri 启动链，不作为功能仍可用的证据。

## 文档关系

本文是当前退役决定真源；[产品功能归属矩阵](../产品功能归属矩阵.md)、[总 TODO](../TODO.md)、README 和用户说明同步本边界。

旧 Code 索引/排序/Codegen 专题、跨产品执行计划和 Codegen MVC 试点标为 `superseded`，保留历史方案，不继续作为实施清单。已发布版本日志和历史打包回执不改写成当前通过结论。

## 导航显示合并与兼容

一级功能区收敛为「系统」与「工具」。「系统」保留主页、配置、Git 与测试入口；「工具」合并现有 CAD、保留的忽略设定和 CAA，并纳入原系统区的音频提取。

这是展示层聚合：工具区继续使用内部 Ribbon ID `cad`，不把工作空间的 `code` / `cad` 领域标识、module scope/type 或已有模块偏好改成新的 `tools` 值。导航先按页面原始 `module` 过滤再合并，Code-only 工作空间仍有工具入口和忽略设定/CAA，不因没有启用 CAD 而丢失入口；原 CAD-only 过滤也保持。音频提取仍不绑定工作空间领域，保持原本的可访问性。

保留页面的 page id、旧深链接、文档 Tab 与工作空间范围选择语义不变；五个退役页面仍按上文映射到 CAA 首页，不因一级导航合并而恢复。以下历史验收回执中的独立「Code Ribbon」描述记录当时界面，不代表当前仍有第三个一级功能区。

## 验收

人工复查步骤：

1. 刷新主库 Web，确认一级功能区只有「系统」「工具」；工具区包含启用领域的 CAD、忽略设定/CAA 及音频提取，Code-only 工作空间仍有入口。
2. 分别打开上述五个旧 `?page=` URL，应落入 CAA 首页，无空白页、旧草稿或旧操作按钮。
3. 刷新带旧 Tab 的会话；无重复幽灵 Tab，已有 CAA/CAD Tab 不丢失。
4. 忽略页读取正常，设置写入只用临时样本验证；CAA 列表与编辑器可打开。
5. 对退役扫描/写入 API 按旧方法请求，必须 404；临时样本及 SQLite 数据不变。

浏览器验证不等于 Tauri 安装态验收；未跑的平台和真机制品不得记为通过。

### 2026-10-04 本轮回执

- 三个子任务分别完成前端、后端、发行脚本；主任务整合导航/依赖/文档，后端子任务再交叉审查前端数据保全。
- `pnpm typecheck` 通过；Registry 全量测试与最终 Web 复验通过，最终为 Server **61 文件 / 219 项**、CAA Core **11 / 67**、Web **66 / 373**，合计 **659 项**。退役五页 URL/会话迁移、30 个路由 404、SQLite/旧偏好不变、独立 CAA 索引均有契约测试。
- 交叉审查额外修复两项数据保全问题：普通工作集更新不丢失 retired scope/legacy `codeUuid`；未挂载的 CAA 多 Tab 草稿在迁移后再次保存时不丢失。三组契约独立复验 **19/19**；显式清空和已消费快照不会被恢复。
- `pnpm test:local-wing`、`pnpm build:local-wing` 通过。本地基线为并列 Wing `1610d69ea868561cdccf272ad0684fe9f5767de3`（0.7.7），只运行标准构建/解析器，Wing tracked 工作树保持 clean；Registry 仍锁 `phoenix-wing@0.7.5`，未升级版本或切换正式依赖。
- `pnpm build:registry`（最终制品）、`pnpm build:tauri-runtime` 通过：bundle 和 packaged Node 后台均在隔离临时目录完成 health/shutdown，服务登记正常回收。首次 sandbox 不允许回环 listen，获准在沙箱外重跑后通过，不算产品故障。
- `pnpm docs:check`：155 篇分类及 current 链接通过；`pnpm verify:architecture`：325 源文件、5 个 pure graph 通过；`pnpm verify:wing-dependencies`：6 个精确 Registry 包通过；`git diff HEAD --check` 通过。
- 主库 `localhost:49373` 浏览器实测：Code Ribbon 只有忽略设定/CAA；`?page=code_rename`、`?page=kt_codegen&rel=retired.json` 最终归一至无旧参数的 CAA 首页；忽略页可读取规则且明确“当前无消费工具”；已有 CAD Tabs 保留。没有在用户工作空间点击扫描或写入；关闭本轮新增浏览器标签，保留原页面。
- 主库只读 HTTP 实测：health/app config/ignore prefs/CAA health 均 200；Code 索引与 Codegen 文档查询均 404；导航 Code 项恰为 `code_ignore` / `caa_dialog_home`。
- Tauri release 脚本语法、30 条旧路由方法对照及失败关闭 harness 通过；**未重新构建/启动 macOS `.app`，未运行 Windows NSIS 或 PowerShell 真机验收，未抓取浏览器 console**，不沿用历史发布通过声明。
- 已有依赖 sourcemap、SQLite experimental、Vite 大 chunk、Vitest UI peer 版本警告保留记录；本轮不借退役升级依赖或扩展性能重构。未 push/tag/publish。
