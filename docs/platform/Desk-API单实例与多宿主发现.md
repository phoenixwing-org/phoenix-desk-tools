# Desk API 单实例与多宿主发现

状态：current

Owner：Desk Tools maintainers

适用版本：0.3.x 历史基础；0.5.0 浏览器宿主源码试点

最后核验：2026-10-25（新增独立服务＋浏览器试点，不代表 runtime 已发布）

## FreeCAD 工作台接入：服务与浏览器分离试点

第一轮不要求启动 Tauri 桌面客户端。工作台分别提供“检查／确保服务”和“打开浏览器”：前者返回经过身份核验的 JSON，后者只打开其中的明确回环 `web_url`。工作台退出、关闭浏览器和切换工具均不调用后台退出、按 PID 停止或抢占已有服务。

当前源码是 **0.5.0 未发布候选**。2026-10-25 核对官方 Gitee Releases API 尚无资产，tags 只有 0.2.0／0.3.0／0.4.0；旧 0.4.0 `.app` 不能当作新 runtime。第一轮仅为源代码工作区的 Registry 构建入口，需要已安装锁定依赖及 Node 22（本机核验 22.23.1），不是无需 Node 的可下载安装包，不声明 Windows／Linux 已验证发行。

```sh
pnpm build:browser-host
pnpm service:ensure --state-dir /absolute/private/desk-browser-state
pnpm service:status --state-dir /absolute/private/desk-browser-state
```

`--state-dir` 必须显式指定安全的私有目录；`ensure` 只在该命名空间内发现或创建，`status` 不创建目录。演示使用仓库外临时目录，所有用户配置、旧配置来源、服务登记和运行库都指向此目录，不导入旧用户数据。此命名空间不等于用户全局登记目录；插件在正式接入前仍须明确选择共用命名空间并处理旧 API-only 服务，不能借另选目录绕过不兼容提示。

构建固定 `browserServer.ts` 入口，输出 `server/dist-browser/`，不覆盖 Tauri 的 `dist-sidecar/`。进程本身同时托管已构建 Web 和 API，通过操作系统分配的真实端口发布同源 URL，不猜测 Vite 的开发端口。浏览器宿主严格验证实际 Host 与精确同源 Origin；资源只从显式 Web 构建目录读取，不服务源码、隐藏文件、数据库、目录列表或符号链接，未知 API 仍为 JSON 404。首轮不初始化 Native 执行门禁，受控原生任务保持关闭；不能用私有 state-dir 的门禁绕过普通 Desk 或其他实例的宿主互斥域，共用 Native 调度须单独验收。

旧 `health_path=/api/caa/health` 保持 CAA 存活语义，不用它确认完整服务身份。浏览器宿主在旧 schema 1 登记中追加 `browser_host_protocol=1`、`identity_path=/api/desk-service`、`web_url`、`runtime_id`；身份响应须与登记的 `instance_id`、PID、应用／协议版本、runtime ID、API origin 和 Web URL 完全相符，首页还须实际返回 HTML。重定向、实例不符、API-only、坏登记和归属不明均不自动替换或删锁。

`ensure` 返回 `state/code/reason/api_origin/web_url/instance_id/reused/created` 等字段。只有验证通过的 `ready` 才可打开浏览器；重复调用复用同一兼容实例。发现只读，不获得停止权限；首次启动只创建自己的 Node 后台，不启动 FreeCAD、Tauri 或迁移工程数据。当前源码候选 manifest 记录版本、平台、Node、入口及 Web 文件 SHA256，标记 `not-published` 且发布资产列表为空；它不是签名发布资产，也没有宣称覆盖所有 Node 依赖和 CAD 引擎文件。

后续发行按同一契约封装固定平台 runtime：附带 Node、完整依赖／资源、制品校验和及正式下载地址，完成安装／升级／隐私门禁后再给工作台固定版本下载。不能把本地构建完成或标签存在当作 Release 发布完成。

本轮本地回执：Registry 构建、双端类型、39 项服务相关回归、26 项新旧发现／CLI 回归及 11 项欢迎页契约通过。独立临时状态下实际验证首次创建、同实例复用、身份／首页／资源 SHA、HEAD、精确 Host／Origin、API JSON 404、旧 API-only 自有假服务保持及无旧数据导入；未打开生产 CAD，未启动 Tauri 或受控 Native。FreeCAD 工作台按钮的联合验收尚未完成。

## 已确定边界

- Desk API 是进程级单实例资源。Web 开发界面与 Tauri 不得各自启动一份 API。
- API 启动前必须取得 `instance.v1.lock` 原子锁；端口自动跃迁不能绕过此边界。
- API 启动成功后继续以 `service.v1.json` 作为本机发现真源。Auto Code、Web 和 Tauri 均读取登记并校验 `/api/health`。
- 已登记 API 健康且 `protocol_version` 兼容时，Web 或 Tauri 复用它；没有可用登记时才启动后台 API。
- 已登记 API 存活但协议不兼容时应明确报错，禁止另起一份 API。
- Tauri 只在自己创建了后台 API 时负责关闭它；复用的 API 不随 Tauri 退出而关闭。

`/api/health` 同时返回 `app_version` 与 `protocol_version`。界面状态栏显示 API 版本和“本机 API / 复用 API”，便于判断实际连接对象。

## 与 UI 开发端口的区别

Vite 端口只是开发界面的资源服务端口，可以在推荐端口被占用时自动跃迁。它不是 Desk API，也不是 Auto Code 的发现入口。API 唯一性不能用“再找一个空闲 API 端口”解决。

## TODO：两个 UI 宿主的最终策略

当前实现允许 Web 与 Tauri 同时连接唯一 API。该行为仍有产品层面的未决问题：

- Auto Code 等外部指令应由哪个 UI 呈现；
- 两个 UI 的工作台、当前 View 与通知状态如何同步；
- 拥有 API 的 Web 进程退出时，正在复用它的 Tauri 如何接管或提示；
- 是否应改为更简单的产品规则：发现另一个 Desk 宿主已启动时，提示用户并拒绝第二个 UI 启动。

候选方案只有以下两种，后续需要择一形成正式契约：

1. **单 UI 宿主**：发现另一个 Desk UI 已启动就提示并拒绝启动。行为最明确，不需要跨窗口同步。
2. **多 UI、单后台会话**：Web 与 Tauri 都只是同一个后台的视图。当前工作空间归后台所有，任一 UI 切换工作空间后，其他 UI 必须立即同步；不能允许两个 UI 针对同一 API 各自认为自己处于不同工作空间。该方案需要服务端事件广播、客户端会话版本校验和切换冲突提示。

在上述行为确定前，不增加 UI 抢占、自动接管或跨宿主状态同步。当前复用只保证请求指向同一个 API，不宣称两个 UI 的本地状态已经同步。API 原子锁与服务登记保持为稳定基础。

## 近期可执行计划与建议方案

近期已经有定论、可以直接完成的范围：

1. 完成 API 原子锁、失效锁恢复和所有退出路径的 owner-safe 清理。
2. Web 与 Tauri 统一读取 `service.v1.json`，探测健康、应用版本与协议版本；兼容才复用，不兼容时明确报错。
3. 区分 `managed` 与 `reused`：只有 `managed` 宿主关闭其子进程，任何界面都不得关闭自己没有创建的后台。
4. 在界面状态栏显示 API 应用版本、协议版本和来源，补齐自动测试与人工点检步骤。

以上近期范围已于 2026-07-22 完成。隔离注册目录运行态点检确认：首个 API 在 `service.v1.json` 与 `instance.v1.lock` 写入同一 `instance_id`；第二进程被锁明确拒绝；Web 发现返回登记的实际端口、`app_version=0.3.0` 与 `protocol_version=1`；正常 shutdown 后登记、锁和监听端口均被回收。人工复验步骤已并入 [Web / Tauri / CAD 手动点检表](2026-07-20-Desk-Web-Tauri-CAD手动点检表.md)。

近期产品策略建议采用 **单 UI 宿主**：另一个 UI 已存在时给出地址、版本和关闭提示，然后拒绝第二个 UI 启动。这能避免当前工作空间、外部打开指令和通知归属不一致。该限制应使用独立的 UI 宿主登记实现，不能复用或扩大 API 锁的职责。

若未来选择多 UI，则另立阶段实现：后台工作空间 `revision`、SSE/WebSocket 状态广播、切换前版本校验、其他窗口自动刷新和后台所有权转移。完成这些能力前，不建议把多 UI 并存作为正式支持行为。
