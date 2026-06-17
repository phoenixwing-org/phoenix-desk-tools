# 图纸档 BOM 属性规划

> [文档索引](文档索引.md) · 相关：[Fcdesk嵌入式BOM属性约定.md](Fcdesk嵌入式BOM属性约定.md) · [BOM工具说明.md](BOM工具说明.md)

## 1. 问题

纯图纸 FCStd（`*.Drawing.FCStd`，Document 内主要为 `TechDraw::*` + `App::Link`）往往**没有** `PartDesign::Body` / `App::Part` / 装配类型对象。  
按旧挂载链读取/写入会报错：

> 未发现可挂载 BOM 的对象（依次尝试 PartDesign::Body → type 中含 assembly → App::Part）

## 2. 原则

| 层级 | 角色 | BOM 属性 |
| --- | --- | --- |
| **PartKey** | 产品身份 | 索引 / 零件目录聚合键 |
| **模型 FCStd**（`.FCStd` / `.ASSY.FCStd`） | 几何与结构 | **唯一可写来源** |
| **图纸 FCStd**（`.Drawing.FCStd`） | 工程图交付 | **只读**；展示来自 Link 指向的模型 |

- **含图纸的零件**：以**模型 + PartKey** 为主；图纸为 `file_role=drawing` 关联文件。  
- **纯图纸文件**：不在 UI 中单独维护 BOM；从 **App::Link → 模型 FCStd** 读取；Document 上若存在镜像 Property，挂在 **首个 `App::Link`** 且 **`ro=1`（只读）**。  
- **同文件内 Part + TechDraw**：仍按 Body / Part 挂载（现有逻辑）。

## 3. FreeCAD 建模方式（Phoenix 不强制）

| 方式 | 说明 | Phoenix |
| --- | --- | --- |
| A. 模型文件 + Link 到新图纸文件 | 常见 | 模型可写；图纸只读跟 Link |
| B. 同一 FCStd 内 Part 下建 TechDraw | 单文件 | 仍挂 Body/Part，可写 |

## 4. 实现策略（已落地 Phase 1）

### 4.1 挂载扩展

在 **无** Body / assembly / App::Part 且 **含 TechDraw** 时，BOM 挂载对象改为文档内**首个 `App::Link`**（按 `Objects` 顺序）。

### 4.2 读取

1. 若 Link 上已有 BOM Property → 读出（应为 `ro=1` 镜像）。  
2. 若为空 → **优先**读挂载 `App::Link` 的 `LinkedObject` PropertyXLink（见样例 [`samples/图纸-通过link来创建-Document.xml`](samples/图纸-通过link来创建-Document.xml)），再扫 Document 内其它外部 XLink，用 `bom_xref.resolve` 解析到工作空间内模型路径，**从模型 Document 读取** canonical 值。  
3. 仍失败 → 按文件名去掉 `.Drawing` 后缀在同目录找模型 FCStd（兜底）。

API 返回 `bom_readonly=true`、`bom_source_rel=模型相对路径`。

### 4.3 写入

- 用户在前端 **保存 / 推荐写盘** 时：图纸-primary（挂载于 Link 且无 Body 等）→ **拒绝**，提示编辑 Link 指向的模型。  
- 可选 Phase 2：`sync_drawing_link_bom_mirror` 将模型 BOM **只读镜像** 写入图纸内 App::Link（`ro=1`），不在表单保存路径自动改图纸包。

### 4.4 前端

文件详情 · 属性 / 概览：只读时禁用输入与「写入 Document.xml」；展示来源模型路径与「打开模型」说明。

## 5. 后续（Phase 2+）

- 从 Document 解析 `PropertyXLink` / TechDraw 源对象，增强 Link 目标识别。  
- 模型保存后可选「同步到关联图纸 Link 镜像」。  
- 零件目录：图纸 Tab 只读聚合同一 PartKey 下模型与图纸。

## 6. 改代码时请同步

`phoenix/freecad/fcstd_drawing_bom.py`、`fcstd_document_bom_props.py`、`fcstd_embedded_attrs.py`、`bom_apply_service.py`（`BomPreview.bom_readonly`）、`web-ui` 文件详情、`tests/test_fcstd_drawing_bom.py`。
