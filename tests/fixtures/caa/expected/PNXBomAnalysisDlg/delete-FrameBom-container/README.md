# delete-FrameBom-container

## 操作
删除整个 `FrameBom` 容器（含子树 `FrameOutput > PushButtonJson, PushButtonPrintMarkdown` 和 `MultiListPartBom`）。

## 期望

### CATDlg
- `FrameBom` 及所有子树声明消失
- Root 的 `children` 不再包含 `FrameBom`
- 其他控件不变（`FrameParams` 子树、`EditorOutInfo`）

### CATNls
- `FrameBom.*` 所有 key 消失（级联删除）
- `FrameBom.FrameOutput.*` 所有 key 消失
- `FrameBom.MultiListPartBom.*` 所有 key 消失
- WIZARD zone 只保留 `FrameParams` 子树的 NLS 条目
