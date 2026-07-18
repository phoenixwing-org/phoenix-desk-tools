# CAA 对话框 NLS 会话 ViewModel 验收

状态：current

Owner：Desk Tools CAA maintainers

适用版本：0.2.x

最后核验：2026-07-18

## 本轮边界

`CaaDialogEditorPage.vue` 继续持有六个响应式真值：主语言 baseline/current/source，以及 locale current/baseline/source。新增的 `caaDialogNlsSessionViewModel.ts` 只接收普通值并返回新的普通值，不拥有 Vue ref，也不访问 Shell、浏览器、API、组件或文件系统。

```text
IR / draft / PageSession snapshot
  -> NLS Session ViewModel（纯构建、overlay、dirty、数量差异投影）
  -> Page 六个 refs
  -> Page locale UI / canvas IR apply / History / Host API
```

责任保持如下：

| 责任 | Owner |
| --- | --- |
| 从 IR source text 和 `localeNls` fallback 构建 NLS 值 | NLS Session ViewModel |
| 从草稿构建干净 baseline/current | NLS Session ViewModel |
| PageSession current overlay，保留已解析 baseline 并合并 locale | NLS Session ViewModel |
| 主语言与所有 locale dirty 判定、键数量差异投影 | NLS Session ViewModel |
| 六个 refs、active locale、EN/CN/both UI、canvas 翻译 | Page |
| locale 创建/保存 API、IR sources/parseMeta 更新、Shell 日志 | Page Host adapter |
| Undo/Redo 快照与何时记录 history | History Controller + Page |

## 已冻结的兼容行为

- active locale 改变时，Page 仍逐键调用 `applyNlsKeyToRoot`，并把 `Title` 投影到 IR 后同步 sidebar。
- NLS 树的 `setNlsFlatKey` 继续 `trim()` 输入，且当前不记录 history；画布/属性提交 `commitNlsEdit` 继续保留原输入并记录 history。两条路径不在本轮合并。
- 创建 locale 时，API 返回的磁盘空值是 baseline；editable current 按同 key 从当前英文值初始化，因此创建后会显示 dirty。
- snapshot 只恢复 current/source；解析或草稿 baseline 不随 snapshot 漂移。snapshot locale 与已解析 locale 合并，不删除未出现在 snapshot 的 locale。
- 同一 Page 中由 API 重新加载 found/blank 草稿时，继续只刷新主语言 current/baseline，不清空既有 locale 三项；潜在 stale-state 另立修复，不在纯提炼中改变。
- draft snapshot 当前不序列化 locale source text；同一 Page 重入 hydration 时继续沿用现值，不在本轮把缺字段解释为清空。
- 简体中文与英文 key 数量相等时，即使 key 身份不同，当前仍不显示 mismatch；只有数量不同时才投影缺失 key。这是 characterization，不代表后续规则不应增强。

## 点检结果

- 定向纯模型、Page contract、architecture：3 files / 13 tests。
- Web 全量 Vitest、Vue typecheck、仓库 architecture/docs/Wing 依赖与 Registry build 作为提交门禁执行。
- 本轮没有改变 template、CSS、组件 props/events、HTTP 请求或真实写盘协议，因此无需新增浏览器视觉点检。

后续 canvas/page shell 拆分必须继续以 Page 为 Host adapter，不把 locale UI、API 或 History 状态放入纯 ViewModel。
