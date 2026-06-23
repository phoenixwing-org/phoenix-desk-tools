import type { ComputedRef, Ref } from "vue";
import type {
  PagePropertyBooleanField,
  PagePropertyField,
  PagePropertyGroup,
  PagePropertyInfoField,
  PagePropertyNumberField,
  PagePropertyPathField,
  PagePropertySelectField,
  PagePropertySelectOption,
  PagePropertySelectOptionsSource,
  PagePropertyStringField,
  PagePropertiesSheet,
} from "../types/pageProperties";

type ReactiveBool = Ref<boolean> | ComputedRef<boolean>;
type ReactiveStr = Ref<string> | ComputedRef<string>;
type ReactiveNum = Ref<number> | ComputedRef<number>;
type MaybeHidden = Ref<boolean> | ComputedRef<boolean> | undefined;
type MaybeHint = string | ComputedRef<string> | undefined;

/** 折叠分组（FreeCAD 属性段） */
export function propGroup(
  id: string,
  label: string,
  fields: PagePropertyField[],
  opts?: { defaultCollapsed?: boolean; description?: string; hidden?: MaybeHidden },
): PagePropertyGroup {
  return {
    id,
    label,
    fields,
    defaultCollapsed: opts?.defaultCollapsed,
    description: opts?.description,
    hidden: opts?.hidden,
  };
}

/** AppPropertyBool — 布尔 */
export function propBool(
  id: string,
  label: string,
  opts: {
    value: ReactiveBool;
    onChange?: (value: boolean) => void;
    hint?: MaybeHint;
    disabled?: MaybeHidden;
    hidden?: MaybeHidden;
    labelTone?: "default" | "emphasis";
  },
): PagePropertyBooleanField {
  return { id, label, kind: "boolean", ...opts };
}

/** AppPropertyEnum — 枚举下拉（含原 radio 场景，统一 combo） */
export function propEnum(
  id: string,
  label: string,
  opts: {
    value: ReactiveStr;
    options: PagePropertySelectOptionsSource;
    onChange?: (value: string) => void;
    hint?: MaybeHint;
    disabled?: MaybeHidden;
    hidden?: MaybeHidden;
    labelTone?: "default" | "emphasis";
  },
): PagePropertySelectField {
  return { id, label, kind: "select", ...opts };
}

/** @deprecated 请用 propEnum；属性面板不支持 radio，等效为下拉 */
export function propRadio(
  id: string,
  label: string,
  opts: {
    value: ReactiveStr;
    options: PagePropertySelectOption[];
    onChange?: (value: string) => void;
    hint?: string;
    disabled?: MaybeHidden;
    hidden?: MaybeHidden;
  },
): PagePropertySelectField {
  return propEnum(id, label, opts);
}

/** AppPropertyString */
export function propString(
  id: string,
  label: string,
  opts: {
    value: ReactiveStr;
    onChange?: (value: string) => void;
    placeholder?: string;
    mono?: boolean;
    hint?: string;
    disabled?: MaybeHidden;
    hidden?: MaybeHidden;
  },
): PagePropertyStringField {
  return { id, label, kind: "string", ...opts };
}

/** AppPropertyInt / Float */
export function propNumber(
  id: string,
  label: string,
  opts: {
    value: ReactiveNum;
    onChange?: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    hint?: string;
    disabled?: MaybeHidden;
    hidden?: MaybeHidden;
  },
): PagePropertyNumberField {
  return { id, label, kind: "number", ...opts };
}

/** 相对工作空间路径（mono + 可选浏览） */
export function propPath(
  id: string,
  label: string,
  opts: {
    value: ReactiveStr;
    onChange?: (value: string) => void;
    placeholder?: string;
    browse?: boolean;
    hint?: string;
    disabled?: MaybeHidden;
    hidden?: MaybeHidden;
  },
): PagePropertyPathField {
  return { id, label, kind: "path", browse: opts.browse ?? true, ...opts };
}

/** AppPropertyString 只读 */
export function propReadonly(
  id: string,
  label: string,
  opts: {
    value: Ref<string | number | boolean | null> | ComputedRef<string | number | boolean | null>;
    mono?: boolean;
    multiline?: boolean;
    hint?: string;
    hidden?: MaybeHidden;
  },
): PagePropertyInfoField {
  return { id, label, kind: "info", ...opts };
}

/** 组装一页属性表（不含 pageId，供 usePagePropertySheet 使用） */
export function propSheet(
  groups: PagePropertyGroup[],
  opts?: Pick<PagePropertiesSheet, "title" | "schemaVersion">,
): Omit<PagePropertiesSheet, "pageId"> {
  return { groups, ...opts };
}
