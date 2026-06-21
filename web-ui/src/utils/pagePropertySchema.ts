import type { ComputedRef, Ref } from "vue";
import type {
  PagePropertyActionField,
  PagePropertyBooleanField,
  PagePropertyField,
  PagePropertyGroup,
  PagePropertyInfoField,
  PagePropertyNumberField,
  PagePropertyRadioField,
  PagePropertySelectField,
  PagePropertySelectOption,
  PagePropertySlotField,
  PagePropertyStringField,
  PagePropertiesSheet,
} from "../types/pageProperties";

type ReactiveBool = Ref<boolean> | ComputedRef<boolean>;
type ReactiveStr = Ref<string> | ComputedRef<string>;
type ReactiveNum = Ref<number> | ComputedRef<number>;
type MaybeHidden = Ref<boolean> | ComputedRef<boolean> | undefined;

/** 折叠分组（FreeCAD 属性段） */
export function propGroup(
  id: string,
  label: string,
  fields: PagePropertyField[],
  opts?: { defaultCollapsed?: boolean; description?: string },
): PagePropertyGroup {
  return {
    id,
    label,
    fields,
    defaultCollapsed: opts?.defaultCollapsed,
    description: opts?.description,
  };
}

/** AppPropertyBool — 布尔 */
export function propBool(
  id: string,
  label: string,
  opts: {
    value: ReactiveBool;
    onChange?: (value: boolean) => void;
    hint?: string;
    disabled?: MaybeHidden;
    hidden?: MaybeHidden;
    labelTone?: "default" | "emphasis";
  },
): PagePropertyBooleanField {
  return { id, label, kind: "boolean", ...opts };
}

/** AppPropertyEnum — 枚举下拉 */
export function propEnum(
  id: string,
  label: string,
  opts: {
    value: ReactiveStr;
    options: PagePropertySelectOption[];
    onChange?: (value: string) => void;
    hint?: string;
    disabled?: MaybeHidden;
    hidden?: MaybeHidden;
    labelTone?: "default" | "emphasis";
  },
): PagePropertySelectField {
  return { id, label, kind: "select", ...opts };
}

/** AppPropertyEnum — 少量选项时用 radio */
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
): PagePropertyRadioField {
  return { id, label, kind: "radio", ...opts };
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

/** AppPropertyString 只读 */
export function propReadonly(
  id: string,
  label: string,
  opts: {
    value: Ref<string | number | boolean | null> | ComputedRef<string | number | boolean | null>;
    mono?: boolean;
    hint?: string;
    hidden?: MaybeHidden;
  },
): PagePropertyInfoField {
  return { id, label, kind: "info", ...opts };
}

/** 单行按钮 */
export function propAction(
  id: string,
  label: string,
  opts: {
    buttonLabel: string;
    onClick: () => void | Promise<void>;
    variant?: "default" | "primary" | "danger";
    loading?: ReactiveBool;
    hint?: string;
    disabled?: MaybeHidden;
    hidden?: MaybeHidden;
  },
): PagePropertyActionField {
  return { id, label, kind: "action", ...opts };
}

/** 嵌入已有组件（复杂块预留） */
export function propSlot(
  id: string,
  label: string,
  opts: Omit<PagePropertySlotField, "id" | "label" | "kind">,
): PagePropertySlotField {
  return { id, label, kind: "slot", ...opts };
}

/** 组装一页属性表（不含 pageId，供 usePagePropertySheet 使用） */
export function propSheet(
  groups: PagePropertyGroup[],
  opts?: Pick<PagePropertiesSheet, "title" | "schemaVersion">,
): Omit<PagePropertiesSheet, "pageId"> {
  return { groups, ...opts };
}
