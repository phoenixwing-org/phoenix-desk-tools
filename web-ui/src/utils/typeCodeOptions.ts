/**
 * 类型码 TypeCode：常用 H/S/R，也允许手输其它值。
 * 约定见仓库 doc/cad/Phoenix嵌入式BOM属性约定.md §2.1
 */

export type ComboOption = { value: string; label: string };

export const TYPE_CODE_OPTIONS: ComboOption[] = [
  { value: "H", label: "一般件" },
  { value: "S", label: "标准件" },
  { value: "R", label: "虚拟零件" },
];
