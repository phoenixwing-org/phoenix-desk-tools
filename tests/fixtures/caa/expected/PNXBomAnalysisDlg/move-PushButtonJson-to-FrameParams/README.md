# move-PushButtonJson-to-FrameParams

## 操作
将 `PushButtonJson` 从 `FrameBom > FrameOutput` 移动到 `FrameParams`。

## 期望

### CATDlg
- `PushButtonJson` 的 `FATHER` 变为 `FrameParams`
- `PushButtonJson` 不再出现在 `FrameOutput` 的子树中
- `PushButtonJson` 位置变为 `FrameParams` 的子节点 grid (0,2)

### CATNls
- `FrameBom.FrameOutput.PushButtonJson.*` 变为 `FrameParams.PushButtonJson.*`（key 前缀跟随 father 变化）
- WIZARD zone 内 key 按新的 model 树 DFS grid 排序
