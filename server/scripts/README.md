# Server engine adapters

This directory contains platform engine adapters launched and supervised by Node services. They do
not implement HTTP routes or workspace preference logic.

## `sw-step-export.ps1`

`server/src/lib/pnwSwStepExportService.ts` writes a JSON job and launches this PowerShell adapter on
Windows. The adapter attaches to or starts `SldWorks.Application`, exports `.sldprt` and `.sldasm`
models to STEP, and returns a JSON result. Documents that were already open before the job are left
open; documents opened by the adapter are closed after export.

STEP Batch uses `scripts/freecad_batch_step_runner.py` and `scripts/freecad_batch_step_fc.py` at the
repository root. Those files execute inside FreeCADCmd because FreeCAD exposes STEP import and FCStd
creation through its Python API. Node still owns the corresponding HTTP, preferences, validation,
preview, launch, and result parsing behavior. Node resolves the internal command by real path, rejects
the macOS GUI launcher, starts it with a system/adapter environment allowlist, redacts child output,
and caps retained logs. Run `pnpm verify:freecad-security` at the repository root after changing this
boundary.

## `workspace-recovery.ts`（开发验证命令）

在 Desk 根目录运行 `pnpm -C server exec tsx scripts/workspace-recovery.ts --help` 查看参数。
三种命令分别为 `backup --workspace ABS --destination ABS --confirmed`、
`inspect --backup ABS` 和 `restore --backup ABS --destination ABS --confirmed`。
`ABS` 必须替换为本机规范化的 canonical 绝对路径；写入目标完整目录必须不存在，父目录必须已存在。

只备份当前 `.phoenix/phoenix-workspace.sqlite` 的原始整库，以及 `.phoenix/outbox`
的 opaque 文件与空目录。未知表、人工字段、索引和触发器不重新解释；不收录工作空间模型/缩略图目录、
其他偏好文件或 legacy-only 数据库，outbox 内的文件仍按 opaque 数据原样保留，不是完整工程归档。
包内清单只有相对路径、大小、哈希与数据库版本，
没有源工作空间绝对路径；数据库/outbox 的原有私人内容仍然原样保留，恢复包必须只放本地受保护目录，
不得提交或进入发布包。清单与 SHA-256 证明包自洽，不是来源签名。Windows 设备名、ADS、尾点/空格等
不安全名称会整次拒绝，不静默漏备份；“所有 opaque 文件”限于能安全处理的路径。

检查执行 SQLite integrity_check 和精确文件/目录清单及 SHA-256 验证。恢复只建立新隔离目录，
不覆盖、不切换、不激活、不重建索引。错误可能保留未完成目录并返回 `incompleteDirectory`，
不要把目录存在视为成功，也不要自动删除；先检查输出和文件归属。成功输出中的 `warnings` 也需要核对。

复制期间持有数据库读事务与混合驱动 lease；outbox/绕过协议的文件写者没有共同事务，检测到变化时拒绝。
不承诺跨资源原子快照、抵抗持续恶意祖先目录替换或断电耐久性。只读操作会创建临时数据库 lease sidecar，
不能宣称文件系统零写。本命令不是 Tauri 安装版恢复 UI，也不授予原位删除/重建权限；
`POST /api/phoenix/database/recreate` 始终拒绝（409）。

## 备份与恢复页面及真实 HTTP 点检

CAD 索引分组的“备份与恢复”页面是上述引擎的受控入口：选择新目标，明确确认备份；
恢复先选新隔离目标并手动检查已有包，再确认恢复。选择目录按钮只选择父目录并拼接新目录名，
不会把已有目录直接作为写入目标。路径与折叠状态按当前工作空间保存；检查句柄、确认和回执不持久化，
刷新、失活、切空间或服务重启后不能直接使用旧检查恢复。页面与 API 不执行原位重建或自动切换。

`/api/workspace-recovery/{inspect,backup,restore,release}` 使用 plain JSON DTO；服务端只接受 Host
当前工作空间的请求。检查返回有界摘要与十分钟句柄（最多四个），恢复使用服务端保存的清单哈希，
不接受客户端 proof。实际恢复尝试后需重新检查；已有目标仍拒绝。取消/失联时可能已有未完成或已发布
内容，页面会提示核对目标、打开 Bottom 日志，不自动重试。错误的 `incompleteDirectory` 不代表成功。

冻结并构建后可运行 `node server/scripts/smoke-workspace-recovery.mjs bundle`；准备 Tauri runtime 后
运行同命令的 `runtime` 模式。脚本启动独立端口的真实子进程，独立构造 Schema v13、人工字段/BLOB
与 opaque outbox，验证原始字节、有效包替换、当前空间、重启、原位重建拒绝及已有目标保留。
运行时数据与 legacy 导入入口均显式隔离，不替换用户 HOME，不访问个人旧偏好；仅临时合成数据写入。
`PHOENIX_KEEP_RECOVERY_SMOKE=1` 可将本次自有证据留在仓外。该旅程证明真实 bundle/runtime API，
不等于 Tauri GUI 安装、旧 VSIX 恢复、跨 OS 或断电恢复通过。
脚本分别报告实际 Server/Node SHA 与两次启动耗时。开发 bundle 会先同步完整源测试目录，启动宽限
为 30 秒；packaged runtime 为 15 秒，HTTP 请求仍为 10 秒，不修改引擎或 Vitest 的期限。
