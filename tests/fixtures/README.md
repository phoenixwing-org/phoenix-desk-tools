# 测试样例数据

本目录存放 pytest 与回归用的样例文件。

## 外链工程

`KtAlarmClock` 和 `PNXCaaStudy` 是两个独立 C++ 工程，**不再使用 symlink**。
测试代码直接查找 `phoenix-desk-tools` 同级目录：

```
Kt/
├── phoenix-desk-tools/    # 本仓库
├── KtAlarmClock/          # git clone https://...
└── PNXCaaStudy/           # git clone https://...
```

检出后测试自动定位，缺失时 `@unittest.skipUnless` 自动跳过相关用例。

## 布局

| 路径 | 用途 |
| --- | --- |
| `reorder_members/` | 最小 `.h` 片段（锁定段用例） |
| `uuid/` | UUID / GUID / CAA IID 形态小样本 |
| `caa/` | CAA 对话框样例（CATDlg / expected） |
| `workspaces/` | 最小工作空间 DB 和 Document.xml 片段 |
