# add-PushButton-to-FrameBom

## 操作
在 `FrameBom` 容器中新增 `PushButtonNew`（grid 0,1）。

## 期望

### CATDlg
- `FrameBom` 子树新增 `PushButtonNew` 声明
- 属性：`FATHER = FrameBom; GRID = { 0, 1, 1, 1, CATGRID_4SIDES };`

### CATNls
- 新增 `FrameBom.PushButtonNew.Title = "New Button";`
- 插入位置在 `FrameBom` 子树中按 grid 排序（row 0, col 1 排在 MultiListPartBom 之后）
- 其他条目不变
