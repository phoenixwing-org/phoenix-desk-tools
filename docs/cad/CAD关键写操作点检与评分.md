# CAD 关键写操作点检与评分

状态：current

Owner：Desk Tools CAD maintainers

适用版本：Desk Tools v0.5.0 / KT Auto CAD v0.2.0 / Workspace Schema v13

最后核验：2026-09-05（来源分支历史记录）

2026-10-03 拣选说明：本文保存 `3f00a028` 发布线的点检方法与原始结论。下文“当前”及分数均指该历史基线，不表示本次 develop 或新安装版已通过同等实机验收。本次分支拣选结果见 [分支拣选审计](../platform/2026-10-03-分支拣选审计.md)。

## 目标与范围

本门禁评价用户真正依赖的本地 CAD 操作：FCStd 属性写回、文件改名、XLink 路径修复、引用节点 Label 修复、BOM/XRef/装配树更新、冲突拒绝、原子恢复以及 FreeCAD 往返。它不以页面数量、删除代码量或旧 Python 功能覆盖率代替业务可用性。

本轮只验收 macOS + FreeCAD。Windows 和 SolidWorks COM 不进入分母；以后若恢复对应发布承诺，应另建平台矩阵。屏幕锁定不会阻塞本门禁：优先使用 Auto CAD TypeScript 索引、Desk Service、SQLite/哈希回读和 FreeCADCmd。安装版 UI 旅程仍单列为最高等级证据。

所有权固定如下：

| 能力 | 真源/Owner |
| --- | --- |
| 工作区扫描、Schema v13 索引、轻量 FCStd 读取、本地交付 | KT Auto CAD |
| 文件系统写事务、原子替换、改名、XLink/Label 修复 | Desk Tools |
| XML 字段、路径、标签和装配树纯规则 | Phoenix Wing |
| 正式 Part/BOM 审核、权限、审计和发布 | Phoenix BOM Web |

Desk 不恢复第二套扫描器或 BOM 列表；Python 只在现行 TypeScript/Wing 行为无法解释具体回归时定点参考。FreeCADCmd 中执行的最小 Python 片段只是 FreeCAD 外部引擎 adapter，不是业务实现真源。

## 三个独立分数

分数不得求平均：

1. CAD 关键操作点检：当前 **91.5 / 100**。
2. BOM 联合链路：当前 **100 / 100**。
3. 发布就绪度：当前 **85 / 100**。

证据等级：

| 等级 | 系数 | 证据要求 |
| --- | ---: | --- |
| E0 | 0% | 无可复现证据 |
| E1 | 40% | 纯函数、单元测试或合成 XML/ZIP |
| E2 | 70% | 当前 Service/API 对受控真实 FCStd 副本写入，Desk 精确复读 |
| E3 | 90% | E2 + Auto CAD 当前索引 + SQLite/XRef/哈希对照 + 故障/冲突门禁 + FreeCADCmd 保存、重开 + Desk 二次复读；全程可无界面运行 |
| E4 | 100% | 当前安装版在 macOS 完成同一流程，覆盖 UI/Host 权限、进程生命周期和失败恢复 |

按 `权重 × 等级系数` 逐项计算。真实文件、目标分支、Wing/Schema 或关键契约变化后，旧回执自动过期。P0/P1 数据破坏、回滚、权限、当前构建或 migration 门禁失败时禁止发布。

| CAD 点检项 | 权重 | 当前等级 | 得分 |
| --- | ---: | ---: | ---: |
| 文件改名、rename log 与索引路径同步 | 15 | E3 | 13.5 |
| XLink 影响分析与精确路径修复 | 15 | E3 | 13.5 |
| 引用节点 Label 修复 | 10 | E3 | 9 |
| PartNumber/Revision/类型/系列/名称/Label 写回 | 15 | E3 | 13.5 |
| BOM/XRef/装配树与索引一致性 | 15 | E3 | 13.5 |
| 原子替换、冲突拒绝与失败恢复 | 10 | E3 | 9 |
| 单元、契约、路由与回归测试 | 15 | E4 | 15 |
| macOS/FreeCAD 与当前安装版 | 5 | E3 | 4.5 |
| **合计** | **100** |  | **91.5** |

剩余 8.5 分只由当前 v0.5.0 安装版 UI/Host 重走同一写事务并完成生命周期回执获得，不能用更多单元测试补分。

## 样本与安全边界

样本仓库：`/Users/kathy/phoenix/phoenix-freecad-study`。

固定使用 `01-零件装配` 中五个稳定文件：

- `8002.001-H-PX-滑动装置.ASSY.FCStd`
- `8003.001-H-PX-滑轨.FCStd`
- `8003.001-H-PX-滑轨.Drawing.FCStd`
- `8004.001-H-PX-滑块.FCStd`
- `8005.001-H-PX-螺栓.FCStd`

该仓库中用户正在处理的 `8001.001-H-PX-滑轨变形*.FCStd` 不属于样本，不得复制、恢复、暂存或修改。脚本先记录源文件 SHA-256，再用 `mkdtemp` 建隔离工作区和排他复制；全部写操作只发生在副本。默认完成或失败都清理工作区，只有显式 `--keep` 才保留诊断副本。

## 执行方法

标准命令：

```bash
pnpm verify:cad-pointcheck
```

可显式指定依赖和回执：

```bash
pnpm verify:cad-pointcheck -- \
  --source-root /Users/kathy/phoenix/phoenix-freecad-study \
  --auto-cad-root /Users/kathy/phoenix/kt-auto-cad \
  --freecadcmd /Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd \
  --receipt /tmp/phoenix-cad-pointcheck.json
```

成功必须输出 `CAD_POINTCHECK_STATUS=passed` 和回执路径。脚本按 realpath 拒绝 FreeCAD GUI launcher，只调用内部 `freecadcmd`；子进程仅继承系统运行白名单和点检任务变量，日志、异常与 JSON 回执在写出前统一脱敏并限制外部输出长度。修改这条边界后先运行 `pnpm verify:freecad-security`，再运行真实点检。

门禁顺序：

1. 校验并复制五个源文件，记录源 SHA-256。
2. FreeCADCmd 逐个打开、重算、关闭、重开，冻结样本基线。
3. 将 KT Auto CAD 当前源码打成临时 ESM 索引 runner，由它创建真实 Schema v13 SQLite；Desk 不复制扫描实现。
4. 在零件和装配副本写入 PartNumber、PartVersion、TypeCode、ModelSeries、PartName、Label，核对 Document.xml、Desk 复读、file_asset 与入向 XRef 快照。
5. 预置同名目标制造改名冲突；源/目标哈希和 rename log 必须完全不变。
6. 把滑轨零件改为 `8103.002-H-PX-滑轨点检.FCStd`，确认磁盘、rename log 和索引路径一致。
7. 分析并修复装配与 Drawing 中两处 XLink，再修复对应引用节点 Label；旧目标入向引用为 0，新目标为 2，装配树只含新路径。
8. FreeCADCmd 保存并重开全部修改文件；核对自定义属性和引用派生属性仍在，再由 Desk 二次复读并刷新 XRef。
9. 确认源样本 SHA 不变、只产生一条成功改名日志、无 `.phoenix-*.tmp`/`.backup` 残留，清理临时工作区。

## 2026-09-04 回执

当前通过环境：Desk `v0.5.0`、KT Auto CAD `v0.2.0@1701676`、FreeCADCmd `1.1.0 Revision 20260325`、macOS arm64。正式回执由命令记录实际 Desk commit 和 dirty paths，文档不写会随提交自引用失效的固定 Desk SHA。

通过结果：5/5 FCStd 解析，4 条 XLink、4 条 BOM line；零件和装配各完成一次属性写回；冲突改名保持两个文件哈希和 0 条日志不变；成功改名产生 1 条日志；装配和 Drawing 各修复 1 条 XLink 和 1 个 Label；新目标 direct incoming 为 2；FreeCAD 保存/重开后五个文档均可读，Desk 二次复读六项字段完全一致；源样本不变且无原子写临时残留。

实跑发现并修复了三个此前被合成测试掩盖的问题：

- KT Auto CAD v0.2.0 的生产相对路径无 `./` 前缀，而 Desk 旧查询只接受带前缀路径；当前读写兼容两种存量键。
- Wing 0.6.3 的紧凑属性替换会丢掉 FreeCAD 动态属性 `group/doc/status` 元数据；Desk ZIP adapter 现保留既有元数据，并为新字段补齐 FreeCAD 可持久化元数据。该兼容层后续应在 Wing 修复并发布后移除。
- BOM 字段写回后 file_asset 和入向 XRef 字段快照会陈旧；当前只更新现存索引行和 XRef 快照，不建库、不全量扫描、不改 `bom_json`/mtime 新鲜度，也不覆写人工 PartKey。

FreeCAD 控制台仍报告三个环境/样本基线警告：未安装可选 3Dconnexion framework、Assembly console 模式的 `QtCore` NameError，以及样本中既有 Slider Joint 的无效 `Reference2`。这些警告未阻止 5/5 打开、保存和重开；只有警告集合或行为相对基线恶化时才判为回归。

## 剩余 TODO

- [ ] 用当前 v0.5.0 macOS `.app` 通过 UI/Host 执行同一副本流程，记录应用哈希、API 版本、权限、退出和 sidecar 回收，将 CAD 点检升到 E4。
- [ ] 完成插件升级、停用、卸载保留数据和重装恢复的同轮生命周期矩阵，将发布就绪度从 85 提升到 100。
- [ ] 在 Phoenix Wing 修复动态属性元数据保留并发布新版本；Desk 升级后删除临时兼容层，并重跑本门禁。
- [ ] 把 `missing/ambiguous/self/non-FCStd` 的真实样本组合纳入固定 fixture；当前这些分支由单元/路由契约覆盖。
