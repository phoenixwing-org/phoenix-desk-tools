# CAA CATDlg：VS Code → Desk Tools 人工点检清单

> 适用范围：KT Auto Code VS Code 插件、Phoenix Desk Tools、Desk Tools 可执行程序。
>
> 目标：确认插件能识别 Desk Tools 是否运行，并可靠地把一个 `.CATDlg` 交给 Desk Tools 打开编辑。

## 1. 点检准备

- [ ] 记录 Desk Tools 版本/提交：`________________`
- [ ] 记录 KT Auto Code 版本/提交：`________________`
- [ ] 记录操作系统与 VS Code 版本：`________________`
- [ ] 准备一个包含中文或空格路径的工作区：`________________`
- [ ] 工作区内准备两个有效文件：`A.CATDlg`、`sub/B.CATDlg`
- [ ] 设置 `ktAutoCode.caa.externalEditor.endpoint` 为 `http://127.0.0.1:5180/api/caa/dialog/open`
- [ ] 设置 `ktAutoCode.caa.externalEditor.command` 为空；否则自定义命令优先于接口

每项记录“通过 / 失败 / 跳过”，失败时保留 VS Code 输出、Desk Tools 后台日志和截图。

## 2. 服务未启动与连接探测

1. 完全退出 Desk Tools，确认没有残留 server 进程。
2. 在 VS Code 打开 KT Auto Code → CAA 对话框 Block。

- [ ] Block 自动显示“Desk Tools 未启动或不可连接”，不需要先点击文件
- [ ] 点击“检测 Desk Tools”仍显示离线，VS Code 不冻结、不反复弹窗
- [ ] 扫描 CATDlg 仍可完成；离线只影响外部交接
- [ ] 点击 VS Code 打开按钮，文件能在文本编辑器中打开
- [ ] 点击外部打开按钮，显示明确连接错误，文件不被标成“已交接”

## 3. 服务在线与基础交接

启动 Desk Tools 并打开同一工作区，然后重新进入 CAA Block 或点击“检测 Desk Tools”。

- [ ] 显示“Desk Tools 已连接”
- [ ] 鼠标停留连接状态时可看到实际 endpoint
- [ ] 扫描后连接状态仍正确，文件列表完整
- [ ] 点击 `A.CATDlg` 的外部打开按钮后，插件提示“Desk Tools 已接受 …”
- [ ] Desk Tools 切换到 CAA 编辑器并打开正确文件
- [ ] 插件仅在接口返回接受后把该行标为“已交接”
- [ ] 再次交接同一文件不会产生重复编辑 Tab，应激活已有 Tab

可独立验证接口：

```bash
curl http://127.0.0.1:5180/api/caa/health
curl -X POST http://127.0.0.1:5180/api/caa/dialog/open \
  -H 'Content-Type: application/json' \
  -d '{"workspaceRoot":"/绝对/工作区路径","file":"/绝对/工作区路径/A.CATDlg"}'
```

- [ ] health 返回 `ok: true`、`service: "caa"`、`protocol_version: 1`
- [ ] open 返回 HTTP 202 和 `accepted: true`

## 4. 跨工作区与可靠交付

Desk Tools 当前打开工作区甲，VS Code 打开工作区乙；从 VS Code 交接乙中的 `B.CATDlg`。

- [ ] Desk Tools 自动切换到工作区乙，再打开 `B.CATDlg`
- [ ] 工作区切换或文件打开失败时，请求不会在首次轮询后丢失
- [ ] 修复失败原因后无需重新提交，请求能在后续轮询中成功打开
- [ ] 成功打开后 ACK 请求；刷新/等待后不会重复处理
- [ ] 连续快速交接 A、B，两项均按顺序打开且不漏项

可在开发模式检查队列：

```bash
curl http://127.0.0.1:5180/api/caa/dialog/open-requests
curl -X POST http://127.0.0.1:5180/api/caa/dialog/open-requests/ack \
  -H 'Content-Type: application/json' -d '{"ids":[请求ID]}'
```

- [ ] GET 在 ACK 前重复调用仍保留同一请求
- [ ] ACK 后对应请求消失；未知 ID 不影响其他请求

## 5. EXE / 单实例参数

按实际可执行文件名替换：

```bash
PhoenixDeskTools --workspace "/绝对/工作区路径" --catdlg "/绝对/工作区路径/A.CATDlg"
PhoenixDeskTools "/绝对/工作区路径/A.CATDlg"
```

- [ ] Desk Tools 未运行时：启动完成后打开指定工作区和文件
- [ ] Desk Tools 已运行时：第二次调用交给现有实例，不启动第二套服务
- [ ] 路径含中文、空格时仍能正确打开
- [ ] `--file` 与 `--catdlg` 行为一致

## 6. 协议、配置与异常输入

- [ ] endpoint 指向有 HTTP 响应但不是 Desk Tools 的服务时，插件显示“不兼容”
- [ ] endpoint 写成非法 URL，插件显示“接口地址无效”
- [ ] 配置 `externalEditor.command` 后显示“使用自定义外部编辑器命令”，不探测 Desk Tools
- [ ] 自定义命令能替换 `${file}`、`${workspace}`，且优先于 endpoint
- [ ] 不存在文件、工作区外文件、非 `.CATDlg` 文件均返回 400，不打开 Tab
- [ ] `phoenix-desk-tools.caa-dialog.v1` handoff 可打开文件
- [ ] `selectedFiles` 为空或非 `file:` URI 时有明确拒绝信息
- [ ] 5180 端口被其他程序占用时，插件不误报在线

## 7. 编辑安全与用户反馈

- [ ] 有未保存 CATDlg 修改时，跨工作区不会静默丢弃修改
- [ ] 日志能定位：接收请求、目标工作区、目标相对路径、成功/失败
- [ ] Desk Tools 重启后，检测状态能从离线恢复为在线
- [ ] Desk Tools 退出后，重新检测或下一次交接能更新为离线
- [ ] 文案明确区分：VS Code 内打开、Desk Tools 接受、自定义命令启动、连接失败

## 8. 点检结论

| 项目 | 结果 | 备注/缺陷编号 |
| --- | --- | --- |
| 离线探测 | ☐通过 ☐失败 ☐跳过 | |
| 在线交接 | ☐通过 ☐失败 ☐跳过 | |
| 跨工作区可靠性 | ☐通过 ☐失败 ☐跳过 | |
| EXE / 单实例 | ☐通过 ☐失败 ☐跳过 | |
| 异常与安全 | ☐通过 ☐失败 ☐跳过 | |

点检人：`________________`　日期：`________________`　总体结论：`________________`
