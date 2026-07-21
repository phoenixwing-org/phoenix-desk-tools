# Desk Web / Tauri / CAD 手动点检表（2026-07-20）

状态：current

Owner：Desk Tools maintainers

适用版本：Desk Tools 0.2.x / Phoenix Wing 0.4.3 起

最后核验：2026-07-20

本文汇总 2026-07-20 累积的启动、端口、异步 View、VS Code 四区布局、Primary、KT Codegen、TypeScript FCStd 和 Tauri 点检步骤。每次大改、打包或 CAD 能力恢复后复制本文记录结果；不要在真实生产工作区直接执行写盘项。

## 1. 记录环境

- [ ] 日期、操作系统、CPU 架构：`________________`
- [ ] Desk / Wing commit：`git rev-parse --short HEAD`、`git -C ../phoenix-wing rev-parse --short HEAD`
- [ ] Node / pnpm：`node -v && pnpm -v`
- [ ] 使用可丢弃工作区副本；至少含一个真实 FreeCAD 保存过的 `.FCStd`。
- [ ] Desk 与 Wing 并列；本轮不修改 `kt-auto-code`。

## 2. 启动前端口和后台进程

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:48375 -sTCP:LISTEN
```

- [ ] 两条命令无输出，或输出 PID 已确认属于本轮要复用的同一实例。
- [ ] 若终端窗口丢失，对查到的明确 PID 执行 `kill <PID>`，再确认端口释放；不要按模糊进程名批量结束。
- [ ] 正常关闭优先回到启动终端按 `Ctrl-C`；Tauri 优先从“配置 → 退出 Phoenix”退出。
- [ ] 不同时运行 `pnpm dev` 与 `pnpm tauri:dev`。

## 3. 本地 Wing 与 Web 启动

```bash
pnpm wing:check-local
pnpm dev
```

- [ ] 日志明确显示 `[Wing][LOCAL]`，路径指向并列 `../phoenix-wing`。
- [ ] Server 监听首选 `127.0.0.1:48375`；占用时在约定范围内选择后续端口并登记真实端口。
- [ ] Vite 监听 `http://localhost:5173/`，没有 `Port 5173 is already in use`。
- [ ] 浏览器能打开主页，API 请求不报连接失败。
- [ ] 对照正式包时使用 `pnpm dev:registry`，日志必须是 `[Wing][REGISTRY]`；不要使用 `pnpm link`。

## 4. 壳层与首次打开 View

刷新页面，保证下列 View 本轮都没有打开过，再依次首开：Code Index、CAD Index、KT Codegen、Unit Tests、CAA Dialog、成员排序。

- [ ] 首次点击后旧 View 保持显示，直到目标 View 可绘制；中央区域不先白屏再显示。
- [ ] Ribbon、Primary、Properties 和下方 Panel 不随新 View 创建而整体闪白。
- [ ] 快速连续点击两个未打开 View，最终只显示最后一次点击的目标，慢请求不能覆盖新选择。
- [ ] 切回已经打开的 View 无闪烁，表单、滚动位置和 Tab 状态按页面约定保留。
- [ ] 刷新后再测一次；Web 与 Tauri 行为一致。

## 5. VS Code 四区布局

- [ ] 左侧是当前 View 的 Primary，中央是主 View，右侧是 Properties/辅助面板，下方是 Problems、Output、Preflight 或日志。
- [ ] 拖动左、右和下方面板分隔条，中央 View 不被完全挤没，最小窗口仍可滚动。
- [ ] 下方面板只有一个全局实例，页面不会在中央区再造第二个日志面板。
- [ ] 关闭/重开各面板后布局恢复，Tab 和活动 View 不丢失。
- [ ] 右侧 Properties 不混入运行日志；错误与日志留在下方面板。

## 6. Primary 通用面板

在 Code Index、CAD Index、成员排序、Unit Tests、KT Codegen、CAA 等页面逐页检查：

- [ ] 顶部紧凑显示 View 名、模块、工作空间和一句说明，没有大块空白。
- [ ] 页面摘要/运行状态紧邻上下文，并在状态变化后更新。
- [ ] 分组标题使用 Wing 统一折叠头，右尾显示“项目数 / 操作数”。
- [ ] 折叠箭头、标题点击和 `aria-expanded` 一致；不同 Tab 的同名分组互不串状态。
- [ ] 纯只读指标和纯布尔选项使用紧凑双列；混合表单保持单列顺序。
- [ ] 按钮自动换行，窄 Primary 不溢出；长路径可截断/换行并能查看完整值。
- [ ] 无页面贡献时只显示简短空态；已有专用 Wing/Web Component 时不重复一套控件。

## 7. KT Codegen 与 Code 工具

- [ ] 打开 `.codegen.json`，Primary 能选择文档、Block/preset、候选源码和 Region。
- [ ] 中央 Wing Table 为 page/collapsible 布局；折叠、编辑、保存、还原正常。
- [ ] 预检后 Problems 展示 Marker/路径/行列；Preflight 展示 Artifact、源码片段和扫描完整性。
- [ ] 完整 Marker 计划可 Apply，并在磁盘回读到结果。
- [ ] 缺失 END 或孤立 END 与另一完整 Region 并存时，只允许完整 Region Apply，损坏区不写入。
- [ ] 修改预检后的源码制造指纹冲突；Apply 必须 fail-closed，原文件不变。
- [ ] Code Index 的 TS 文件发现、忽略规则、扩展名和分页筛选生效。
- [ ] UUID/Rename 可预览并回读；GBK/UTF-8 示例写回后编码和换行不损坏。
- [ ] 成员排序先 dry-run，再在副本写入；锁定段、头文件与 `.cpp` 顺序符合预览。

## 8. CAD TypeScript 与数据库

在进入 CAD 前补验 Unit Tests 的结果面板：

- [ ] 运行含通过、失败/错误、跳过的测试；摘要、通过率和绿/红比例与用例数一致。
- [ ] 按套件、状态、“仅失败”“仅关注项”“仅复测项”切换，显示数量、模块汇总和空态同步。
- [ ] 展开失败用例显示 message/traceback，再运行一次后旧展开项关闭；模块表在窄窗口内横向滚动，不撑破中央 View。
- [ ] Result / 失败关注 Tab 往返不丢筛选；运行、取消和日志仍由同一 AsyncProgress 任务提供。
- [ ] 失败关注未勾选时“复测勾选”保持禁用；勾选 N 项后只发送这 N 个 case ID，不把按钮文案误解为“复测全部”。
- [ ] 制造模块加载错误：摘要可以显示错误但“仅失败”用例为空；下方运行日志必须保留具体 load error，不能把加载错误伪造成某条 case。

### 索引与读取

- [ ] CAD Index 扫描限制在工作空间内；重复点击不能启动第二个任务，进度浮层持续更新。
- [ ] 扫描中刷新页面，能恢复同一个任务、继续轮询并仍可取消；完成后列表只刷新一次并回到第一页。
- [ ] 保留一个已完成但未确认的任务再启动：可“查看上次结果”或“新搜索”；保留 orphaned 任务时可取消、继续或重新开始。
- [ ] 完成、异常和取消分别显示正确状态/日志，终态后取消入口不可再调用旧任务。
- [ ] `.FCStd` 通过 ZIP 中的 `Document.xml` 读取，无需 `fcstd-read`/`fcstd-query`。
- [ ] SQLite 搜索、missing 清理和导出正常，大列表不一次性灌入前端。
- [ ] XRef rebuild 后，文件详情的入向/出向数量与引用列表一致。

### BOM 写回

- [ ] 打开真实 `.FCStd`，BOM 来源提示包含 `TypeScript FCStd reader`。
- [ ] 新旧 FreeCAD schema 都能读取 PartNumber、PartVersion、TypeCode、ModelSeries、PartName、Label。
- [ ] 在副本写入 BOM 后重新打开，六项值一致；中文和 `& < > "` 不破坏 XML。
- [ ] ZIP 内 `GuiDocument.xml` 等非目标条目仍存在。
- [ ] 写入失败可恢复原件，目录内无 `.phoenix-*.tmp` 或 `.backup`。
- [ ] 用 FreeCAD 打开、保存写回后的真实文件，再由 Desk 读取；此项不能用合成 ZIP 自动测试替代。

### XLink 与改名

- [ ] 分析能区分 resolved、missing、ambiguous、self 和 non-FCStd。
- [ ] XLink 修改只改 `<XLink file="...">`，不改其它元素的 `file` 属性。
- [ ] Reference Label 只更新对应对象，中文/XML 转义正确。
- [ ] 磁盘改名、FCStd map、XRef 缓存和文件详情同步刷新。
- [ ] 故意制造写入后宿主失败，确认精确回滚且无临时文件。

### 装配树展开

- [ ] 首次展开未缓存的子装配只发起一次加载；快速重复点击不出现重复子行、错误“无下级”或永久 loading。
- [ ] “全部展开”在 first depth 时先请求切换全部层级；full depth 时递归展示所有已索引子装配和多实例标签。
- [ ] 加载失败提示原始错误且仍可重试；切换到另一文件后，旧请求晚返回不能污染同 ID 的新树。
- [ ] “全部折叠”只折叠视觉层级，不丢已加载缓存；XLink 替换、Label 预览/应用和文件详情跳转仍正常。

## 9. 配置页与 Rust 收缩

- [ ] 配置页不再显示三个 CAD Rust 工具的状态区。
- [ ] 工作空间、FreeCAD 目录、面板布局、最近列表和服务退出仍正常。
- [ ] 不安装 CAD Rust 工具时，CAD Index、BOM 读写、XLink 修复和数据库查询仍正常。
- [ ] FreeCADCmd 与 SolidWorks COM 明确是外部引擎；缺少软件时给出可理解错误，不假装成功。

## 10. Tauri 开发态

先停止 Web 服务并确认端口释放：

```bash
pnpm tauri:dev
```

- [ ] Tauri 自动启动 Vite 和 Node 服务，不需要第二个 `pnpm dev`。
- [ ] 启动日志明确显示 `[Wing][LOCAL]`；只有显式执行 `pnpm tauri:dev:registry` 才允许显示 `[Wing][REGISTRY]`。
- [ ] 完成第 4–9 节代表项，尤其是多个未打开 View 连续首开。
- [ ] 新建 View 不出现“先白屏、再显示”的闪烁。
- [ ] “退出 Phoenix”后 Tauri、Vite 和 Node 子进程都退出。
- [ ] 再次执行 `lsof`，5173/48375 无遗留监听并可立即重启。

## 11. Tauri runtime 与 release

```bash
pnpm build:tauri-runtime
pnpm verify:tauri-release:macos
# pnpm verify:tauri-release:windows  # Windows runner
```

- [ ] runtime manifest 只要求 Node sidecar、Server bundle、Schema 和必要脚本，不含 CAD Rust `bin/`/provider。
- [ ] packaged runtime health/shutdown smoke 通过。
- [ ] release 使用隔离用户数据启动，Codegen Apply 与真实 FCStd TypeScript 读取通过。
- [ ] 退出后 Node sidecar 和端口释放。
- [ ] macOS 记录 `.app` 版本/哈希；Windows 记录 NSIS 安装、启动、退出、卸载和回执。

## 12. 自动门禁补充

```bash
pnpm verify:real-fcstd
pnpm test:local-wing
pnpm build:local-wing
pnpm verify:architecture
pnpm verify:wing-dependencies
pnpm docs:check
```

- [ ] TypeScript ZIP/XML 读写测试通过，Local Wing 日志为 `[Wing][LOCAL]`。
- [ ] Registry 依赖仍为精确版本，无 link/file/workspace/override。
- [ ] 使用尚未发布的 Wing API 时，先要求 Wing typecheck 与 Desk `build:local-wing` 通过；发布后再恢复 Registry 普通 typecheck。
- [ ] 若全量测试仅因当前 Node 不提供 `node:sqlite` 失败，记录 Node 版本和失败项；其它测试不得被掩盖。

## 13. 点检结论

2026-07-20 自动基线（人工复验不得直接照抄为“通过”）：Web `70 files / 399 tests`；Local Wing CAD `6 files / 18 tests`；架构、依赖、文档、Web/Server bundle、Tauri runtime smoke 均通过；macOS release smoke 的 `cadRuntime=typescript`，launch/Codegen/FCStd/退出/sidecar 回收全通过。主程序 SHA-256 为 `8e707ac592e1f1ac9d22656facdb9519f52eeba6c0853d4f714f80443f0d69a5`，runtime manifest SHA-256 为 `4c1c6d307cc8faa913835e6c0d5b33a712c5aa0885acdbc2938a318eb26f1c2e`。

| 范围 | 结果 | 证据/备注 |
| --- | --- | --- |
| 端口与后台退出 | ☐ 通过 ☐ 失败 ☐ 阻塞 | |
| Web 首开 View | ☐ 通过 ☐ 失败 ☐ 阻塞 | |
| 四区布局 / Primary | ☐ 通过 ☐ 失败 ☐ 阻塞 | |
| KT Codegen / Code | ☐ 通过 ☐ 失败 ☐ 阻塞 | |
| CAD TypeScript / SQLite | ☐ 通过 ☐ 失败 ☐ 阻塞 | |
| Tauri dev / release | ☐ 通过 ☐ 失败 ☐ 阻塞 | |

最终结论：`________________`
