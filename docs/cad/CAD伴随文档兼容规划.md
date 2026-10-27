# CAD 伴随文档兼容规划

状态：D0 核心与 D0c 消费端已受控接入主目录；MD 只读页面尚未交付。日期：2026-10-20。

Tool 负责名称解析、伴随文档发现、有界读取及新稿输出的一致性；工程侧负责既有 Markdown 的迁移映射、活动链接修正和历史桥接。先兼容读取，再切换新输出名，不在打开详情或生成新稿时偷偷迁移旧文档。

## 当前实现

本轮前，`drawing-research/output-name.ts` 检查 Drawing、PDF、`.Drawing.ai.md` 三件输出，Python runner 独立推导说明名；PDF 排除依赖旧 AI 说明存在或生成标记，身份只比数字编号和版次。本轮以同一冻结路径组驱动消费端，切换新出图说明名，兼容旧名占位、完整 variant 及来源分类。`drawing-research/service.ts` 仍通过真实 XLink 识别模型与图纸关联，详情 DTO 没有 MD 阅读入口。

只读 CLI 已复用核心服务，不启动 CAD、不写文档；网页 MD 阅读器和通用批量脚本尚未交付。

## 名称和身份

拟采用三个独立用途：`模型说明`、`出图说明`、`开发文档`。标准显示文件名为 `图号.版本variant-名称-用途.md`，其中 variant 为空时不加字符。只有明确的分类/项目码字段可省略；名称正文、原料标记及 variant 不按字母或连字符位置猜删。无法可靠拆分的名称保留原文并提示人工确认。

版次、variant 和初稿序号不能互相代替。例如原版次段 `007P1` 保存为 `revisionRaw="007P1"`、`revision="007"`、`variantRaw="P1"`；前导零和显示文件名无损保留。`P`、`P1`、`P2` 分别独立，未知后缀原样保存并标 manual，不归并到数字版次。文件名身份与已保存业务属性不一致时报告冲突，不自动改 CAD 属性或旧数据库分组键。

v1 可判别语法为三位 ASCII 数字 revision，加可选的首位字母、随后字母数字 variant；四位纯数字不能拆成三位版次加数字 variant。未知语法保留原串并人工处理，不从中截出数字版次。字段名可翻译，但内部字符串与显示名称必须无损。

用途不同的文档可正常并存。模型说明不是出图要求，开发文档不是每次生成都能覆盖的机器回执；裸同名 MD 的用途未明确时不得自动升级为指令或工程审批。

## 发现契约

拟定纯身份 helper 与有界文件发现服务分离，前端不实现第二套命名正则：

```ts
type CompanionPurpose = 'model_notes' | 'drawing_notes' | 'development_doc' | 'unknown';
type CadNameIdentity = {
  number: string | null;
  revisionRaw: string | null;
  revision: string | null;
  variantRaw: string | null;
  variantStatus: 'known' | 'unknown' | 'none';
  name: string;
  rawStem: string;
  displayFilename: string;
};
type CompanionRequest = {
  source_rel: string;
  source_node?: string;
  drawing_rel?: string;
  identity: CadNameIdentity;
  purpose: CompanionPurpose;
  draft_sequence?: number;
  explicit_aliases?: Array<{ rel: string; purpose: CompanionPurpose }>;
};
type CompanionResolution = {
  version: 1;
  status: 'unique' | 'aliases_equal' | 'missing' | 'conflict' | 'manual';
  candidates: Array<{
    rel: string;
    purpose: CompanionPurpose;
    naming: 'purpose_v1' | 'drawing_ai' | 'bare' | 'explicit_alias';
    read_status: 'readable' | 'unreadable' | 'invalid_encoding' | 'unsafe';
    sha256: string | null;
  }>;
  selected_rel?: string;
  proposed_rel?: string;
  diagnostics: Array<{ code: string; message: string }>;
};
```

`source_rel + source_node + drawing_rel + revisionRaw/variantRaw + purpose + draft_sequence` 明确绑定身份，Label 或 basename 仅辅助显示。既有 Drawing 优先复用唯一真实源 XLink；多源、缺失、越界或同名跨目录不能靠路径距离猜接。明确映射是候选来源，不是自动写入授权，必须校验目录、身份和指纹。

发现范围先限明确模型/图纸的相邻目录及显式授权的说明目录，不为找 MD 全盘递归。每次最多列举 2,000 个直接条目、100 个候选；超限返回 manual，不用截断结果证明唯一。有界只读入口默认 UTF-8、单文件 2 MiB，拒绝符号链接、越界、控制字符及不安全编码；读取前后校验身份和 SHA。缺失文件与空内容分开，目录或特殊文件不能当作空 MD。

候选包含新用途后缀、旧 `.Drawing.ai.md`、裸同名 `.md` 和明确迁移别名。同一 binding/purpose 的候选全部显示：不同内容必须 conflict；字节及 SHA 相同才可标 aliases_equal，保留所有路径，不自动删除副本。不可读或非法编码候选也保留并显示 read_status，其 SHA 为 null，不用空串或丢弃候选证明唯一。不同用途不因内容相似而合并。新名存在不构成隐藏旧内容的优先级。

页面先展示用途、候选、状态及来源，再提供只读入口。当前没有现成 MD reader；D0 首版采用纯转义文本，禁 HTML、远程图片、外部资源和危险链接协议，不执行脚本、宏或把正文当 Tool 指令。后续富文本需独立安全评审。读取本身不启动 Native、不写 CAD、不写正文。

## 新输出与已有输出保护

新生成仍只有 Drawing、PDF、`-出图说明.md` 三件输出。TS helper 生成完整冻结路径组，Python 从 spec 接收路径，不再另算说明名。出图说明记录版本化来源元数据：`generated_draft`、source/drawing 的相对路径和 SHA、source_node、revisionRaw/variantRaw、初稿序号，以及参考 PDF 的相对路径和 SHA；无原 PDF 明确为空，不能只写 basename。

`name_override` 或实际节点保存的有效 PartName 只影响说明名；Drawing/PDF 保留源 CAD 完整基名，不根据连字符猜删分类和项目码。显式单字母 PartName 按用户的推荐保护规则转人工，不静默回退。无编号模型保留明确的 legacy_manual 研究出图能力，精确保留原始基名，不捏造编号/版次或生成可自动认证的来源标记；未知或畸形版次不能绕到该兼容模式。

drawing SHA 必须取最终 ZIP 字节。顺序固定为图框/缩略图/资源名等全部后处理完成，再 hash Drawing/PDF、生成说明、记录三件组 hash、验证并排他发布；不使用 Python 早期暂存 ZIP 的 SHA，也不把说明自身 hash 循环写回正文。说明生成后 CAD/PDF 再变化即停止。

分配输出时，写入集合为三件，防覆盖占位集合则包含新名、旧 `.Drawing.ai.md` 及已明确属于同一 binding 的 legacy 裸 MD。任一文件、目录、特殊文件、NFC 或大小写别名占位都拒绝，不覆盖、不附加写旧说明。预览冻结后出现新占位或输入变化必须重新预览，不自动换成下一个初稿号继续。

现有新稿序号分配、255 字节文件名、排他发布、部分发布回执及暂存清理需同步覆盖新旧说明名。机器说明已有人工编辑也受同样保护，不能因用途后缀而视为可覆盖。

PDF 候选发现与命名切换同批修改：新/旧说明及 FCStd 内生成标记都纳入来源识别，避免自己的生成 PDF 被重新当作原参考。用途文件名本身既不是 generated_draft 证据，也不是批准证明；只有说明来源/路径/最终 hash 或已有生成标记可核对时才判已生成。仅有后缀、来源未知、variant 不匹配或多个参考均可见并保留人工状态，不静默隐藏原始 PDF。真实来源关联优于同号同版；不靠元数据标记绕过输出占位。

当前自动排除仅接受 canonical v1 说明与完整绑定、当前最终 SHA 均吻合的 generated_verified。旧正文、空 Meta、仅有生成线索或过期源 SHA 都为可见 manual，不能自动复作原参考，也不从多个 SHA 字串中猜当前值。执行前重核冻结的同身份 PDF 集合和实际选中参考的来源分类；变化要求重新预览，不替换冻结选择。原生验证之后才追加机器说明，正式发布和最后来源验证之后再检查三件输出，失败仍保留实际已发布清单。

## 初稿序号与独立目录

`-初稿02` 表示 draft_sequence，不改变 revision 或 variant，也不授权独立输出目录。独立目录属于另一种授权根/关联关系，不由序号推导；须另经显式映射、相对 XLink、发布范围和最终重开验收。当前同目录门禁保持。

## 分期与验收

1. D0a：纯无损 identity helper 和测试；不迁文件、不改输出。工程侧明确 variant、用途和迁移映射后冻结 v1。
2. D0b：有界发现与只读 DTO/UI，兼容三种新用途和两类旧名。先核对候选/冲突，再允许工程侧小规模迁移。
3. D0c：新输出名、Python spec、占位集合、generated PDF 排除和部分发布回执同时切换。不得只改后缀字符串。
4. D1：工程侧逐批改名和活动链接修正；Tool 只消费明确别名/关联。历史验收及旧指纹保留，迁移收据桥接，不重写历史为新验收。

最低回归包括 P/P1/P2 与未知 variant、不完整数字版次、名称连字符、同号异目录、三种用途并存、新旧同内容/冲突、编码与路径安全、任一输出别名占位、预览后竞争、生成 PDF 反选、初稿序号与独立目录、三件组部分发布及安全阅读。公开测试从零构造，不复制工程文档、编号清单或目录结构。

任一身份会丢失、候选被隐藏、读侧触发写入、旧历史被重写、PDF 反选或存在覆盖窗口时，停止进入下一阶段。

## 代码落点

当前主目录待协调的入口：`server/src/features/drawing-research/output-name.ts`、`jobs.ts`、`runner.ts`、`service.ts`，`server/src/features/drawing-batch/generation.ts`，`server/src/lib/fcstdDrawing.ts`，以及 `web-ui/src/components/file-detail/FileDrawingPanel.vue`。通用 helper 放纯 Model 层，HTTP/文件系统与渲染分离；不把 `pnwPartKeyService` 的旧编号/版次分组当作 variant 真源。

整体推进见 [CAD 后续能力实施规划](CAD后续能力实施规划.md)，任务平台基础见 [统一批量任务管理任务书](../platform/统一批量任务管理任务书与实施规划.md)。
