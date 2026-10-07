export type BomNameSource = "label" | "filename";
export const bomNameSourceOptions = [{ value: "label", label: "标签名" }, { value: "filename", label: "文件名" }];
export const bomNameSourceHint = "已有 PartName 优先；为空时按所选来源补全。标签为空时回退文件名；空白或仅一个英文字母的名称需人工确认。";
