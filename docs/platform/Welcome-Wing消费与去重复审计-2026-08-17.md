# Welcome · Wing 消费与去重复审计

状态：current

Owner：Desk Tools maintainers

适用版本：Desk Tools 0.4.x / Phoenix Wing 0.7.0 候选

最后核验：2026-08-17

## 结论

Desk Welcome 已是 Phoenix Wing 公共壳层的真实消费者，不再维护第二套 Welcome 布局、最近工作空间卡片、折叠状态机、主题根、生命周期动作、工作空间类型选择器或信息 Block 外壳。Desk 只保留品牌、帮助链接、项目文案、Host controller、dirty 确认、工作空间类型持久化、界面巡游和 CAA 草稿等产品语义。

本轮最终按 Wing 0.7.0 单提交基线 `52bbb38dad8065cecd4d2ebb80f13c14921f8a79`（tree `65d3534a8dc116bc990242978637a573183da025`）完成消费审计。该提交位于标准并列仓库 `../phoenix-wing` 的 clean `develop`；没有发现需要继续扩张 Wing API 的最小公共缺口。

## 能力归属

| 能力 | Wing 真源 | Desk 保留边界 |
| --- | --- | --- |
| 无工作空间门禁、Welcome 与 Workbench 互斥 | `PnwWorkspaceGate`、`pnwResolveWorkspaceGate` | 传入 controller snapshot，处理 Gate 事件 |
| 两栏 Welcome、Rail、页眉、窄屏和主题根 | `PnwWorkspaceWelcome`、`PnwWelcomeShell` | 品牌文字、链接与产品动作 slot |
| 返回/关闭工作空间的位置、顺序和视觉 | Gate `actionPlacement="auto"` | `requestCloseWorkspace()` 的 dirty/Host 流程 |
| 最近工作空间 Block、条目、当前/缺失状态、ARIA | `PnwRecentWorkspaceList`、Welcome `recentCollapsible` | controller recent snapshot，打开/移除动作 |
| 最近区域折叠状态 | Wing 非受控状态，`recentDefaultOpen` 初始化 | 本轮只声明初始展开，不复制 `ref` |
| JSON 信息 Block 的外壳、主题、折叠、字段表与 ARIA | `PnwInformationBlock` | `welcomeInformation.json` 中的 Block DTO 与初始展开语义 |
| Block 内多卡片 auto-fit、inset、组内间距与循环 | `PnwInformationCardGroup` | 贡献说明和贡献者卡片 DTO；后续新增卡片无需改模板 |
| 工作空间类型枚举、顺序与选择器 | `pnwNormalizeWorkspaceTypes`、`PnwWorkspaceTypeSelect` | 持久化类型，并映射 Desk 模块范围 |
| 明暗/跟随系统切换控件和 Welcome 主题 | `PnwColorSchemeToggle`、Gate `colorScheme` | Shell 持有并持久化受控主题值 |
| Phoenix Wing 矢量标志和 favicon 源资产 | `PnwPhoenixWingMark`、`assets/phoenix-wing-mark.svg` | 同步检查及站点静态引用 |
| 通用选择确认框 | `pnwPromptChoice`、`PnwChoiceDialogHost` | “移除最近记录”文案和 controller 调用 |
| 工作台主页壳层 | `PnwWorkbenchHome` | Phoenix 功能卡片、巡游与业务命令 |

## 本轮删除的重复实现

- 删除 `recentOpen`、`informationExpanded` 和对应 `v-model`；三个 Block 由 Wing 的非受控折叠状态管理，初始值来自 `recentDefaultOpen` / DTO `defaultExpanded`。
- 删除最近记录的二次 `launcher` 查询，直接读取 Wing/controller snapshot 已提供的 `entry.workspaceTypeId`。
- 删除 `window.confirm`，改用已挂载的 Wing Choice Dialog；业务确认结果仍交给 Desk controller。
- 删除 Welcome 根节点重复的 `height: 100%`、品牌标志的包装层和 `:deep` 覆盖。
- 删除工作空间类型选择器的本地宽度/边距；动作区 padding、分隔线和 `PnwSelect` 尺寸均采用 Wing。
- 没有复制 Wing 的 recent row、信息 Block、主题、hover/focus、圆角或响应式 CSS。
- 删除产品侧卡片 `v-for` 和 `display:grid/gap/padding`；贡献 Block 内的 `PnwInformationCardGroup` 统一卡片循环、auto-fit、8px gap、`8px 12px` inset 和响应式排列。

从首轮公共 Welcome 接入前的 `WelcomePage.vue` 579 行，收敛到本轮 288 行，减少 291 行（约 50.3%）。期间新增了 Gate、关闭工作空间、主题、类型和信息 DTO 等能力，因此该数字只用于说明本地结构/CSS 收缩，不作为功能量对比。

## Desk 必须保留的产品代码

- Phoenix 品牌文字、Gitee/安装/快速开始链接及项目说明；界面不展示机构级早期来源，完整历史归属只放在根目录 `CONTRIBUTING.md`。
- `useAppShell`、工作空间目录选择、切换前业务 Tab/dirty 处理、最近记录增删及类型/模块范围持久化。
- “界面巡游”“设置”、`CaaUnsavedDraftsPanel` 和无最近工程的 Desk 提示。
- `#after-recent` 内消费者自有 JSON/DTO、两个同级信息 Block 的折叠语义，以及三个同级 Block 之间 8px 的产品编排间距。贡献 Block 内卡片循环、inset、组内间距和响应式排列归 Wing，不覆盖 Wing 卡片内部样式。

## 自动门禁

在上述精确 SHA 的标准并列仓库上执行：

```bash
pnpm wing:check-local
pnpm test:local-wing
pnpm build:local-wing
pnpm verify:wing-dependencies
pnpm verify:architecture
pnpm docs:check
git diff --check
```

结果：

- Local Wing 真源和 8 个消费包检查通过，Registry manifest/lock 未被改写。
- Server：68 files / 259 tests；CAA Core：11 / 67；Web：81 / 434，全部通过。
- Welcome consumer contract：11 / 11；候选声明定向 `vue-tsc` 通过。
- Wing/Desk Web production build 与 Server sidecar bundle 通过；favicon 同步检查通过。
- 依赖边界、架构、文档清单/链接和 `git diff --check` 通过。

标准 resolver 全程只指向 clean `../phoenix-wing`；未设置临时 Wing 根，未修改仓库 resolver、package、lock 或 `node_modules`，也没有使用 link/file/workspace/override。

## 浏览器点检

使用精确 Wing 0.7.0 SHA 在产品默认开发端口 `http://localhost:49373/?view=welcome` 核验：

- “最近使用”“项目与运行方式”“贡献与维护”是三个同宽、纵向并列的 Wing Block，折叠按钮初始 `aria-expanded="true"`。
- “贡献与维护”内部保留“开放协作”卡片并新增“张三”占位卡；两张卡片由带 `aria-label` 的 `PnwInformationCardGroup` region 包含，后续只追加 JSON DTO。
- 手动折叠“贡献与维护”后为 `false`，刷新后按 DTO 恢复为 `true`；折叠按钮和 ARIA 保留。
- 三个同级 Block 之间为 8px；贡献卡片组由 Wing 提供 `8px 12px` 默认 inset、`border-box`、8px gap 和 auto-fit，宽屏双列、窄屏单列且无横向溢出，产品无 grid/media/:deep/padding 补丁。
- 480×800 窄屏下两张贡献卡片同列、卡片组和页面横向溢出均为 0；恢复默认 viewport 后继续使用正常窗口尺寸。
- 白天主题卡片背景/边框为 `rgb(255, 255, 255)` / `rgb(219, 227, 237)`，黑天为 `rgb(17, 24, 39)` / `rgb(42, 58, 80)`；“跟随系统”受控按钮为 `aria-pressed="true"`，当前系统解析为 light 后复用同一组 Wing token。
- 最终最小回归连续切换 light/dark 后恢复 dark，全新刷新后的 console error/warn 为空。
- 最近记录展开后条目不出现第二层卡片外框；工作空间类型选择器沿用 Wing 动作区尺寸。
- Welcome 正文不包含“上海锟钛”或“早期来源”；贡献 Block 只显示开放协作和 `CONTRIBUTING.md` 归属入口。
- Gitee 主页指向当前 Desk Tools 仓库，用户文档链接统一使用仓库顶层 `docs/`。
- `/favicon.svg` 返回 200、`Content-Type: image/svg+xml`；Desk 静态资产与 Wing `assets/phoenix-wing-mark.svg` 的 SHA-256 同为 `b5db25c3b4da407bd314b60878067152439942935720f7b3a3c419e66f105d7c`。

## 后续边界

Wing 0.7.0 发布后，Desk 已用独立依赖升级提交准备 manifest/lock，并完成 Registry 测试、生产构建和 macOS Tauri 发布冒烟；根包锁定 0.7.0，稳定 scoped 包锁定 0.6.3。除真实出现第二消费者共同需求外，不在 Desk 为 Welcome 增加 `:deep`、主题覆盖、折叠状态机或同构 DTO；也不把 Desk 的 controller、dirty 规则、CAA 草稿和产品文案下沉到 Wing。
