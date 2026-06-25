import type { ComputedRef, Ref } from "vue";

/** 属性字段值类型（与 kind 对应） */
export type PagePropertyScalar = boolean | string | number | null;

export type PagePropertySelectOption = {
  value: string;
  label: string;
  description?: string;
};

type ReactiveValue<T extends PagePropertyScalar> = Ref<T> | ComputedRef<T>;
type MaybeDisabled = Ref<boolean> | ComputedRef<boolean> | undefined;
type MaybeHint = string | ComputedRef<string> | undefined;
export type PagePropertySelectOptionsSource =
  | PagePropertySelectOption[]
  | ComputedRef<PagePropertySelectOption[]>;

/** 各字段共有元数据 */
export type PagePropertyFieldBase = {
  id: string;
  label: string;
  /** 悬停提示；select 也可作当前选项说明的补充 */
  hint?: MaybeHint;
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

/** 枚举 / 互斥选项（统一用下拉，不用 radio） */
export type PagePropertySelectField = PagePropertyFieldBase & {
  kind: "select";
  value: ReactiveValue<string>;
  options: PagePropertySelectOptionsSource;
  onChange?: (value: string) => void;
};

/** 只读展示（路径、统计、说明文字） */
export type PagePropertyInfoField = PagePropertyFieldBase & {
  kind: "info";
  value: ReactiveValue<string | number | boolean | null>;
  mono?: boolean;
  /** 多行说明（如启动步骤） */
  multiline?: boolean;
};

/** 相对工作空间路径（可编辑 + 浏览） */
export type PagePropertyPathField = PagePropertyFieldBase & {
  kind: "path";
  value: ReactiveValue<string>;
  placeholder?: string;
  mono?: boolean;
  /** 是否显示浏览按钮，默认 true */
  browse?: boolean;
  onChange?: (value: string) => void;
};

export type PagePropertyField =
  | PagePropertyBooleanField
  | PagePropertyStringField
  | PagePropertyNumberField
  | PagePropertySelectField
  | PagePropertyInfoField
  | PagePropertyPathField;

/** 分组（类似 FreeCAD 属性面板折叠段） */
export type PagePropertyGroup = {
  id: string;
  label: string;
  /** 分组下说明，渲染在标题下方 */
  description?: string;
  defaultCollapsed?: boolean;
  /** 为 true 时不渲染整组（用于条件子分组） */
  hidden?: MaybeDisabled;
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
