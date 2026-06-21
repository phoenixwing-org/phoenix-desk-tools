import type { Component, ComputedRef, Ref } from "vue";

/** 属性字段值类型（与 kind 对应） */
export type PagePropertyScalar = boolean | string | number | null;

export type PagePropertySelectOption = {
  value: string;
  label: string;
  description?: string;
};

type ReactiveValue<T extends PagePropertyScalar> = Ref<T> | ComputedRef<T>;
type MaybeDisabled = Ref<boolean> | ComputedRef<boolean> | undefined;

/** 各字段共有元数据 */
export type PagePropertyFieldBase = {
  id: string;
  label: string;
  /** 悬停提示；select/radio 也可作当前选项说明的补充 */
  hint?: string;
  disabled?: MaybeDisabled;
  /** 为 true 时不渲染（条件显示） */
  hidden?: MaybeDisabled;
  /** 名称列强调色（类似 FreeCAD Custom / Link 属性绿字） */
  labelTone?: "default" | "emphasis";
};

export type PagePropertyBooleanField = PagePropertyFieldBase & {
  kind: "boolean";
  value: ReactiveValue<boolean>;
  onChange?: (value: boolean) => void;
};

export type PagePropertyStringField = PagePropertyFieldBase & {
  kind: "string";
  value: ReactiveValue<string>;
  placeholder?: string;
  mono?: boolean;
  onChange?: (value: string) => void;
};

export type PagePropertyNumberField = PagePropertyFieldBase & {
  kind: "number";
  value: ReactiveValue<number>;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
};

export type PagePropertySelectField = PagePropertyFieldBase & {
  kind: "select";
  value: ReactiveValue<string>;
  options: PagePropertySelectOption[];
  onChange?: (value: string) => void;
};

/** 少量互斥选项时用 radio 比下拉更直观 */
export type PagePropertyRadioField = PagePropertyFieldBase & {
  kind: "radio";
  value: ReactiveValue<string>;
  options: PagePropertySelectOption[];
  onChange?: (value: string) => void;
};

/** 只读展示（路径、统计、说明文字） */
export type PagePropertyInfoField = PagePropertyFieldBase & {
  kind: "info";
  value: ReactiveValue<string | number | boolean | null>;
  mono?: boolean;
};

/** 单行操作（如「从工作集填充」）；不持久化值 */
export type PagePropertyActionField = PagePropertyFieldBase & {
  kind: "action";
  buttonLabel: string;
  variant?: "default" | "primary" | "danger";
  loading?: ReactiveValue<boolean>;
  onClick: () => void | Promise<void>;
};

/**
 * 预留：嵌入已有 Vue 片段（如 WorksetScopePicker）。
 * 业务页传入 component + props，壳层只负责占位。
 */
export type PagePropertySlotField = PagePropertyFieldBase & {
  kind: "slot";
  component: Component;
  props?: Record<string, unknown>;
};

export type PagePropertyField =
  | PagePropertyBooleanField
  | PagePropertyStringField
  | PagePropertyNumberField
  | PagePropertySelectField
  | PagePropertyRadioField
  | PagePropertyInfoField
  | PagePropertyActionField
  | PagePropertySlotField;

/** 分组（类似 FreeCAD 属性面板折叠段） */
export type PagePropertyGroup = {
  id: string;
  label: string;
  /** 分组下说明，渲染在标题下方 */
  description?: string;
  defaultCollapsed?: boolean;
  fields: PagePropertyField[];
};

/**
 * 业务页向壳层注册的一页属性表。
 * pageId 须与 navigation.page / Tab pageId 一致。
 */
export type PagePropertiesSheet = {
  pageId: string;
  /** 面板标题；省略则用 navigation.label */
  title?: string;
  /** 版本号：递增时强制重置分组折叠态（可选） */
  schemaVersion?: number;
  groups: PagePropertyGroup[];
};
