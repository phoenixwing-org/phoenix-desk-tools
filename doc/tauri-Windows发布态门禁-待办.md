# Tauri Windows 0.2.0 发布态门禁（待执行）

状态：draft

Owner：Desk Tools release maintainers

适用版本：0.2.0 / Windows x64

最后核验：2026-07-18

## 目的

本门禁用于关闭 Q2 的当前 Windows 0.2.0 NSIS 证据缺口。它已经进入仓库，但在真实 Windows runner 产生成功回执前仍是用户手工待办，不能用 workflow 文件存在、PowerShell 静态检查或历史 0.1.0 安装包提前计分。用户已于 2026-07-18 接受联合成熟度 92.00 作为本轮停止线，因此本待办不再阻塞本轮收口或另立大型 UI 拆分目标。

## 入口

Windows 本机：

```powershell
pnpm verify:tauri-release:windows
```

GitHub mirror：手工运行 `Desk Tools Windows 0.2.0 release gate`，或推送 `desk-v*` 标签。当前 Git 远端是 Gitee；仅提交 `.github/workflows/windows-release.yml` 不会自动产生 GitHub Actions 回执。

## 执行责任与回传

- 本轮不由 Codex 连接远程 Windows、不创建 GitHub 镜像，也不代替用户操作真实 Windows；由用户在自有 Windows 机器手工运行上述唯一命令。
- 成功后回传脚本生成的 `phoenix-desk-tools-0.2.0-windows-release-receipt.json`，并保留控制台末尾的 `[q2] Windows NSIS 0.2.0 build/install/app/uninstall gate passed`。
- 回执已经包含 setup/安装态 EXE SHA-256、ProductVersion、签名检查状态、注册/快捷方式、真实 app smoke 和卸载清理结果；无需为了计分传输大型 setup，除非回执或哈希需要进一步排查。
- 若命令失败，只回传第一处错误和相关日志，不手改 JSON、不用历史 0.1.0 产物替代。成功回执产生前联合评分保持 92.00；该回执作为后续平台证据单独归档，不追溯修改本轮分数，也不阻塞大型 UI 拆分新目标。

## 成功条件

脚本必须在同一次 Windows 运行中完成：

1. `package.json`、Tauri config、Cargo package 三处版本均为 0.2.0。
2. 从当前源码构建唯一的 0.2.0 NSIS；明确拒绝历史 0.1.0 setup。
3. 静默安装到一次性目录，验证 EXE ProductVersion、卸载登记和开始菜单快捷方式。
4. 从安装树启动真实 Tauri EXE；用户数据通过 Tauri 专用绝对路径覆盖隔离。
5. 包内 Node sidecar 跑通健康、KT Codegen preflight/Apply/复读，并由打包后的 TypeScript reader 读取有效 FCStd。
6. 通过窗口关闭完成正常退出，确认主进程与 sidecar 退出、5180 释放。
7. 静默卸载，确认安装目录、卸载登记和开始菜单快捷方式全部清理。
8. 输出 `phoenix-desk-tools-0.2.0-windows-release-receipt.json`；用户回传该回执和最终成功日志后再关闭本项。

## 尚未覆盖

- 代码签名、SmartScreen 声誉和企业杀毒软件矩阵属于 95 分供应链范围。
- FreeCAD、SolidWorks 与 CAA 编译仍要求相应软件、许可和真实工程，不能由 NSIS 门禁代替。
- GitHub workflow 需要仓库存在于 GitHub 或其它可运行 `windows-latest` 的兼容 runner；本任务不擅自创建远端或推送代码。
