# CAA 测试数据

## 目录

```
golden/                          ← 原始正确文件（git revert 后的基准）
  PNXBomAnalysisDlg.CATDlg       ← .CATDlg 源文件
  PNXBomAnalysisDlg.CATNls       ← .CATNls 源文件
  PNXBomAnalysisDlg.ir.json      ← 解析后的 IR（内存数据）
  PNXBomAnalysisDlg.nls-ordered.json ← collectNlsOrdered 输出
  PNXBomAnalysisParamDlg.*

expected/PNXBomAnalysisDlg/      ← 操作后的预期输出
  delete-LabelFirstProduct/       ← 删除叶子控件
    ir-after.json                 ← 修改后 IR
    nls-ordered.json              ← 修改后 NLS 有序条目
    CATDlg / CATNls               ← emit 文本输出
    README.md                     ← 操作说明
  move-PushButtonJson-to-FrameParams/ ← 跨容器移动
  add-PushButton-to-FrameBom/     ← 新增控件
  delete-FrameBom-container/      ← 删除容器（级联）

caa2-wizard/                      ← CAA2 Wizard 头文件样例
uuid/                             ← UUID 相关样例
```

## 更新预期文件

```
cd packages/catdlg-core
CAA_WRITE_EXPECTED=1 npx vitest run src/emitCatDlg.expected.test.ts
```

## 相关测试

| 测试文件 | 内容 |
|---------|------|
| `emitCatDlg.expected.test.ts` | golden vs expected 对比（CATDlg + CATNls + JSON） |
| `emitCatDlg.golden.test.ts` | parse→emit round-trip + NLS 排序验证 |
| `emitCatDlg.test.ts` | emitCatDlg + collectNlsFlat 单元测试 |
| `patchCatNls.test.ts` | WIZARD zone 完整重写测试 |
