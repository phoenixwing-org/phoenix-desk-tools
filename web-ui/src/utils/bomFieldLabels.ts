/** BOM / CAD 索引字段在表格与表单中的中文表头（API 字段名仍为英文）。 */

/** 装配树中 XLink 引用实例的 Label（界面列名） */
export const LINK_LABEL_COLUMN = "链接标签";
export const LINK_LABEL_COLUMN_WIDE = "链接标签（子件名）";
export const LINK_LABEL_TITLE =
  "FreeCAD 装配树中该引用的 Label（Link.Label），即树里看到的子件显示名";

export const BOM_FIELD_LABELS = {
  PartNumber: "零件号",
  PartVersion: "版本",
  TypeCode: "类型码",
  ModelSeries: "型号系列",
  PartName: "零件名",
  label: "标签",
  partKey: "零件标识",
  partVersion: "版本",
  typeCode: "类型码",
  modelSeries: "型号系列",
  partName: "零件名",
} as const;

export type BomFieldLabelRow = {
  key: keyof typeof BOM_FIELD_LABELS | "notes" | "status";
  cn: string;
  en: string;
  wide?: boolean;
  /** 占满 meta-grid 整行（用于备注等长文本） */
  full?: boolean;
  kind: "input" | "select" | "typeCode";
};

/** 零件详情 · 属性 Tab 表单字段（中英并列，与文件详情属性页一致） */
export const PART_KEY_META_FIELDS: BomFieldLabelRow[] = [
  { key: "TypeCode", cn: "类型码", en: "TypeCode", kind: "typeCode" },
  { key: "ModelSeries", cn: "型号系列", en: "ModelSeries", kind: "input" },
  { key: "PartName", cn: "零件名", en: "PartName", kind: "input" },
  { key: "label", cn: "标签", en: "Label", kind: "input" },
  { key: "status", cn: "零件状态", en: "Status", kind: "select" },
  { key: "notes", cn: "备注", en: "Notes", full: true, kind: "input" },
];
