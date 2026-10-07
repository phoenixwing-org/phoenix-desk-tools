# KT Auto CAD 下线计划

状态：待安排（只记录计划，不启动迁移或下线）

Owner：Desk Tools / KT Auto CAD maintainers

最后核验：2026-10-06

目标是把 CAD 能力收敛到 Phoenix Desk Tools，不再长期维护两个产品入口。当前仅完成本地代码对比；KT Auto CAD 保持原状，正式停用时间和迁移范围等待用户安排。任务状态统一从 [当前 TODO](../TODO.md) 跟踪，本文件保存范围、取舍和验收条件。

## 能力差异与待决定范围

| 能力 | Desk 当前情况 | 待办与取舍 |
| --- | --- | --- |
| 文件名解析、工作空间索引、轻量读取、BOM 与引用查询 | 已有对应服务和页面 | 用同一份独立样本比较字段、数量、引用、错误与取消行为，通过后判定替代 |
| Phoenix BOM 交付包导出 | 未找到相应业务实现 | 候选迁移：Schema v13 一致快照、质量校验、文件新鲜度、确定性 hash/scanId 与 envelope v1 |
| BOM 推送、审核跳转、离线重试、回执 | 未找到相应业务实现 | 建议整组迁移 prepare/status/commit、Web 审核、outbox、幂等与不可覆盖回执 |
| 登录与安全凭据保存 | 需要 Desk Host 适配 | 决定安全凭据存储与登录流程；不把 VS Code SecretStorage 密码复制到普通配置 |
| 旧 native 深度对象读取 | 未确认等价；Desk 已退役旧 Rust provider | 用户决定舍弃还是保留；若保留，先列实际需要的对象/属性并用样本比较，再决定实现方式 |
| VS Code 侧栏与编辑器联动 | 属于旧插件 Host 的便利功能 | 候选随插件退役，不迁入第二套界面；必要时只保留打开 Desk 的轻量入口 |

## 待安排清单

- [ ] 用户决定是否保留 Phoenix BOM 整组交付能力，以及深度读取是否仍有实际用途。
- [ ] 固定旧插件最后可用版本、源码与 VSIX 校验值，保存恢复说明；确认需要停止维护的范围包含发布与联合开发脚本。
- [ ] 对齐现有能力：同样本核对文件名解析、索引扫描、基础 BOM 和入向/出向引用，覆盖不完整扫描、损坏文件、取消、Schema 不兼容与旧数据保留。
- [ ] 若保留 BOM，先把交付纯规则与 Host I/O 分开；按仓库约定评估进入 Wing，Desk 负责文件、凭据、HTTP 与产品界面。
- [ ] 协调 Phoenix BOM 接收契约：当前 TypeScript 校验和 JSON Schema 都将 `producer.id` 固定为 `kt-auto-cad`。增加 Desk 身份须同步消费端，兼容旧 outbox 与回执，不伪装来源。
- [ ] 迁移交付包导出、新鲜度校验和质量门禁，再迁移登录、预检、提交、审核跳转、断网重试、过期计划和幂等回执。
- [ ] 设计工作空间数据库、outbox/receipt 与旧配置的接管方式；先备份，再验证共享 Schema、扫描批次、文件元数据和历史包兼容，不自动搬运账号秘密。
- [ ] 清理 KT Auto Code 的 CAD 模块安装入口、联合开发启动/打包和 Extension Host smoke 依赖；基础 Code 功能应在不安装 CAD 时正常运行。
- [ ] 用户确认迁移验收结果后，安排停止旧插件发布/维护及本机停用；保留恢复包，待稳定观察期结束后再决定仓库归档。

## 下线验收条件

- [ ] 每项旧能力都有结论：Desk 已验收替代、用户明确舍弃，或明确延期并暂不下线。
- [ ] 若保留 BOM：导出和推送成功、需 Web 审核、更新/恢复/发布冲突、断网重试、重复提交、凭据失效、索引过期均有独立测试与联调记录。
- [ ] 若保留深度读取：实际所需字段和样本输出通过对比，不以“能打开 FCStd”作为等价证明。
- [ ] 旧数据库和未完成 outbox 可读取或恢复，原文件与回执不丢失；停用插件不触发工程数据清理。
- [ ] Desk 使用目标 Registry 依赖通过发行构建与实际安装验证；本地 Wing 联调通过不替代发布验收。
- [ ] 明确失败后的恢复方式、责任人和停用时间，再执行下线。

## 本地代码依据

- KT Auto CAD：`src/extension.ts`、`src/detailTools.ts`、`src/bomTransfer.ts`、`src/bomDelivery.ts`、`src/phoenixBomClient.ts`。
- Desk：`server/src/lib/cadIndexScanService.ts`、`server/src/lib/fcstdDocumentXmlService.ts`、`server/src/routes/cad.ts`、CAD 索引与文件详情页面。
- Phoenix BOM：`packages/admin-plugin/midway/phoenix-bom/domain/bom-transfer.ts` 及 `contracts/transfer-envelope-v1.schema.json`。
- KT Auto Code：`scripts/cad-sibling-resolution.mjs`、联合开发启动脚本及 CAD Extension Host 测试。
