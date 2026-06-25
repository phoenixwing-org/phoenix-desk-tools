# delete-LabelFirstProduct

## 操作
删除 `FrameParams` 容器中的 `LabelFirstProduct` 控件。

## 期望

### CATDlg
- `LabelFirstProduct` 声明块消失
- `FrameParams` 的 `children` 不再包含 `LabelFirstProduct`
- 其他控件不变

### CATNls
- `FrameParams.LabelFirstProduct.Title` 消失（残留清除）
- 其他 NLS 条目保留
- WIZARD zone 完整重写，排序按 model 树 DFS grid 顺序
