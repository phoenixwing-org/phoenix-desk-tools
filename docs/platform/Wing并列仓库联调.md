# Wing 并列仓库联调

状态：current

Owner：Desk Tools maintainers

适用版本：Desk Tools 0.5.x / Wing 0.8.0

最后核验：2026-10-11

## 目标

Desk Tools 开发时应能立即消费本地 Wing，又不能让本地路径污染正式依赖。标准目录只有一个约定：

```text
phoenix/
├── phoenix-desk-tools/
└── phoenix-wing/
```

根目录 `pnpm dev` 固定使用 Registry Wing。`pnpm wing` 是本地联调入口：先严格验证并构建 `../phoenix-wing`，再同时启动 Node Server 与 Vite Web；同级仓库不存在或结构不完整时直接停止。不会自动退回 npm 包，因为静默回退会让开发者误以为刚修改的 Wing 已经生效。

`pnpm wing` 消费本地仓库当前检出的代码，不负责 Git fetch、切换分支或 pull。更新 Wing 后应停止旧服务再执行此命令。如果发现已有 API 正在运行，本地入口会提示先停止它，不会静默复用可能仍加载旧代码的进程，也不会自动关闭现有服务。

## 命令

| 目的 | 命令 | Wing 真源 |
|---|---|---|
| Registry 启动 Server + Web | `pnpm dev` | `package.json` + `pnpm-lock.yaml` |
| 本地启动 Server + Web | `pnpm wing` | 并列或 `PHOENIX_WING_ROOT` |
| 只检查目录 | `pnpm wing:check-local` | 不构建、不启动 |
| 消费端测试 | `pnpm test:local-wing` | 本地 Wing |
| 正式包对照测试 | `pnpm test:registry` | Registry Wing |
| Web + Server bundle | `pnpm build:local-wing` | 本地 Wing |
| 正式包对照构建 | `pnpm build:registry` | Registry Wing |

若仓库不并列，使用根目录而不是 `src`：

```bash
PHOENIX_WING_ROOT=/absolute/path/to/phoenix-wing pnpm wing
```

若标准开发端口已被另一实例占用，可临时执行 `WEB_UI_PORT=49374 CAA_SERVER_PORT=48376 pnpm wing`；这不会改变 Wing 真源或提交配置。

旧的 `PHOENIX_WING_SRC=/path/to/phoenix-wing/src` 仅在 `pnpm wing` 包装器中会被识别并归一为根目录。未标记 `PHOENIX_WING_MODE=local` 的普通 build/test 子命令一律忽略残留路径并使用 Registry；`pnpm dev` 会明确清除两个本地路径变量，保证正式包不受当前 shell 污染。

## 实现边界

本地模式不是安装模式，不修改依赖图：

1. 启动包装器验证根 aggregate 与保留的七个 TypeScript 包（含传递依赖），然后构建其 `dist`。
2. Web 通过 Vite alias 直接消费 aggregate 与包源码，包含 `.vue` 子路径，并把 Wing 根加入 Vite 文件系统白名单；Vue、Pinia 保持 Desk singleton。
3. Server 的 `tsx` 子进程通过仅在 `PHOENIX_WING_MODE=local` 注册的 ESM resolver，按每个包的 `exports` 指向本地 `dist`；fixture 子路径同样遵循包导出。
4. Server Vitest 和 esbuild sidecar 使用同一 exports resolver，避免开发、测试、bundle 三套解析规则漂移。
5. Registry 模式不安装、不 alias，严格使用现有清单与锁文件；日志以 `[Wing][LOCAL]` 或 `[Wing][REGISTRY]` 醒目标明真源。

覆盖范围为 `phoenix-wing` aggregate，以及 `code-core`、`cad-contracts`、`cad-core`、`db-node`、`git-core`、`git-node`、`workspace-schema`。Desk 当前不再消费 `kt-codegen`、`cad-rust-source`；下面的旧 Codegen 联调回执只作历史证据。Tauri 壳与发布制品仍属于独立构建/发布门禁，不由普通 `pnpm dev` 改写。

## 禁止事项与点检

- 不运行 `pnpm link`，不执行临时 `pnpm add file:...`。
- 不在三个 `package.json`、`pnpm-lock.yaml` 或 `pnpm.overrides` 写入本地路径。
- 不替换 Desk `node_modules` 中的发布包。
- 修改 Wing 后重新运行 `pnpm wing`、`pnpm test:local-wing` 或 `pnpm build:local-wing`；包装器会先重建本地消费包。
- 提交前运行 `pnpm verify:wing-dependencies`，确认 Registry 精确版本与锁文件没有漂移。
- 发布验收仍必须再运行 Registry 对照命令；本地模式通过不代表 npm tarball 可消费。

## 2026-07-18 消费端验收

- `WEB_UI_PORT=49374 CAA_SERVER_PORT=48376 pnpm wing`：Server 与 Web 均启动，分别输出 `[Wing][LOCAL][server]`、`[Wing][LOCAL][web]`，路径均为并列 `phoenix-wing`。
- 带无效 `PHOENIX_WING_ROOT` 运行同端口的 `pnpm dev`：两个服务均启动并输出 `[Wing][REGISTRY]`，证明 Registry 命令清除了残留本地路径。
- `pnpm build:local-wing`：六个包、aggregate、Desk Web 与 Server bundle 在同一命令中构建通过；bundle resolver 命中本地 0.4.3 控制符边界逻辑。
- 模式解析单元测试 2 个文件 / 11 项通过；Web 本地 aggregate + kt-codegen 定向测试 2 个文件 / 4 项通过；Server 本地 codegen/fixture 定向测试 3 个文件 / 22 项通过。
- `pnpm -C server typecheck`、`pnpm docs:check`、`pnpm verify:wing-dependencies` 通过；后者确认 9 个清单引用仍为 Registry 0.4.2 且无本地 override。

本轮未执行 Windows 验证，也未把本地联调结果当作 npm tarball 发布验收。

## 2026-07-22 Registry 0.5.0 消费升级

- Server 的 `code-core`、`cad-core`、`db-node`、`kt-codegen`、`workspace-schema` 与 Web 的 `kt-codegen`、aggregate 共 7 处 manifest 引用统一精确升级到 Registry 0.5.0。
- `verify:wing-dependencies` 同时冻结期望版本与 lockfile Registry 解析，继续拒绝 `link:`、`file:`、`workspace:` 和本地 override。
- 本地并列 Wing 仍只通过现有 alias、loader 和 bundle resolver 消费；正式 Registry 构建不写入兄弟仓库路径。
- Node 22.14.0 验收通过：Registry 与本地 Wing 两套 Server 65 文件/251 项、CAA Core 11/67、Web 70/399 测试；两套 Web/Server bundle、双端 typecheck、345 源文件架构门禁，以及 Registry Tauri runtime health/shutdown smoke 均通过。

## 2026-10-07 Registry 0.8.0 消费升级

Desk 已适配 Wing 0.8.0 正式 Registry 包。依赖清单、锁文件与版本门禁保持精确锁定；本次不发布 Desk，也不执行 Auto CAD 退役。

| 发布包 | Desk 精确版本 | 消费端 |
|---|---|---|
| `phoenix-wing` | `0.8.0` | Web |
| `@phoenix-wing/cad-core` | `0.7.0` | Server |
| `@phoenix-wing/cad-contracts` | `0.7.0` | Server |
| `@phoenix-wing/code-core` | `0.6.7` | Server |

四个包的 lockfile integrity 已与 Wing `docs/releases/0.8.0发布候选.md` 中的正式发布回执核对一致。发布输入为 `e97157e2dc1b222ef12dcc3768cda29ba23cc06d`；发布后回执提交为 `717ed543fc30692b8d5ab7180eb20d336e663498`。未升级其他依赖，未引入本地链接或 override。

Node 22.23.1、pnpm 9.15.9 下完成以下点检：

- Registry 完整测试、双端 typecheck 通过；补充 11 项标签操作回归后再次运行 Web 全量测试，最终 Server 79 文件 / 488 项、CAA Core 11 / 67、Web 110 / 761，共 1,316 项通过。
- 新回归覆盖指定标签目标与顺序、未保存刷新取消、等待确认后的忙碌状态复核、批量关闭中止、新开标签不进入已有批次，以及异常后的操作锁释放。
- `pnpm build:registry` 的 Web 与 Server bundle、`pnpm verify:architecture`（410 个源文件）、`pnpm verify:wing-dependencies` 通过。
- 隔离临时配置、服务注册目录和空工作空间，带无效 `PHOENIX_WING_ROOT` 启动根目录 `pnpm dev`：Server 与 Web 均输出 `[Wing][REGISTRY]`，页面显示 Wing 0.8.0，CAD 索引诊断与零件目录正常加载。
- 浏览器验证非当前标签的「关闭右侧」目标、Esc 焦点返回及最后标签关闭；控制台未发现警告或错误。仅使用临时空工作空间，不含个人工程材料。
- `pnpm wing:check-local` 与模式解析回归通过。本轮未重建或改写并列 Wing；本地完整构建与 Windows、Tauri 发行制品、真实 FreeCAD 写入验收不在本次 Registry 适配范围内。

保留的非阻断警告：发布包部分 sourcemap 源文件缺失、既有 Vitest UI peer 版本提示，以及构建时 VueUse PURE 注释和大 chunk 提示。未通过修改 `node_modules` 或扩大依赖升级范围掩盖这些提示。

## 2026-10-11 本地 fix 消费适配

并列 Wing 检出 `fix`，对应远端 `gitee/fix` 的 `933dfab800ce58c89b7cdc3ed63d3674941e2d2b`。该提交的 manifest 仍为 0.8.0，候选说明标记为 0.8.1；它不是一次 Registry 发布。Desk 的依赖清单、锁文件和安装目录均未切换成本地依赖。

- Workspace 适配器区分准备阶段与实际变更阶段：准备失败不重新载入当前工作空间，避免干扰草稿；后台已经切换但响应失败时仍恢复原空间。取消后使用有效恢复信号，并核对恢复身份。
- API 仍由 Desk 单例适配器负责关闭与恢复，不把 Wing 的 `host.close(previous)` 直接映射为关闭当前后台空间。
- `pnpm test:local-wing`：双端 typecheck 通过，Server 80 文件 / 495 项、CAA Core 11 / 67、Web 111 / 770，共 1,332 项通过。工作空间适配器 8 项在 Registry 0.8.0 对照下亦通过，Registry Web typecheck 通过。
- `pnpm build:local-wing` 的 Web 与 Server bundle 通过；`pnpm verify:wing-dependencies` 确认 7 处依赖仍为精确 Registry 版本。
- 隔离临时配置和服务登记启动 `pnpm wing`，确认 Server、Web 分别输出 `[Wing][LOCAL][server]`、`[Wing][LOCAL][web]`。启动发现逻辑新增已运行 API 拒绝复用回归；不自动停止任何已有后台。
- 使用独立构造的临时样本，浏览器验证详情缩略图与控制项、改名弹窗尺寸、Esc 关闭与焦点返回，以及工作空间取消关闭/确认关闭；控制台未发现警告或错误。未执行改名或属性写入。

本轮不发布、不升级正式版本、不推进 Auto CAD 退役实施，也不写入个人 CAD 工程。
