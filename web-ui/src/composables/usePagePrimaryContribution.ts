import {
  computed,
  onUnmounted,
  shallowReactive,
  toValue,
  type Component,
  type MaybeRefOrGetter,
} from "vue";

export type PagePrimaryResolvable<T> = MaybeRefOrGetter<T>;

export type PagePrimaryOption = {
  value: string;
  label: string;
  description?: string;
};

type PagePrimaryControlBase = {
  id: string;
  label: string;
  description?: string;
  disabled?: PagePrimaryResolvable<boolean>;
};

export type PagePrimaryTextControl = PagePrimaryControlBase & {
  kind: "text";
  modelValue: PagePrimaryResolvable<string>;
  placeholder?: string;
  mono?: boolean;
  onUpdate: (value: string) => void;
};

export type PagePrimaryTextareaControl = PagePrimaryControlBase & {
  kind: "textarea";
  modelValue: PagePrimaryResolvable<string>;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  onUpdate: (value: string) => void;
};

export type PagePrimaryNumberControl = PagePrimaryControlBase & {
  kind: "number";
  modelValue: PagePrimaryResolvable<number>;
  min?: number;
  max?: number;
  step?: number;
  onUpdate: (value: number) => void;
};

export type PagePrimarySelectControl = PagePrimaryControlBase & {
  kind: "select";
  modelValue: PagePrimaryResolvable<string>;
  options: PagePrimaryResolvable<readonly PagePrimaryOption[]>;
  placeholder?: string;
  clearable?: boolean;
  onUpdate: (value: string) => void;
};

export type PagePrimaryDirectoryControl = PagePrimaryControlBase & {
  kind: "directory";
  modelValue: PagePrimaryResolvable<string>;
  options: PagePrimaryResolvable<readonly PagePrimaryOption[]>;
  placeholder?: string;
  loading?: PagePrimaryResolvable<boolean>;
  onUpdate: (value: string) => void;
  onPick: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
};

export type PagePrimaryBooleanControl = PagePrimaryControlBase & {
  kind: "boolean";
  modelValue: PagePrimaryResolvable<boolean>;
  tone?: "default" | "warning";
  onUpdate: (value: boolean) => void;
};

export type PagePrimaryChoiceControl = PagePrimaryControlBase & {
  kind: "choice";
  modelValue: PagePrimaryResolvable<string>;
  options: PagePrimaryResolvable<readonly PagePrimaryOption[]>;
  onUpdate: (value: string) => void;
};

export type PagePrimaryReadonlyControl = PagePrimaryControlBase & {
  kind: "readonly";
  value: PagePrimaryResolvable<string | number>;
  mono?: boolean;
};

export type PagePrimaryControl =
  | PagePrimaryTextControl
  | PagePrimaryTextareaControl
  | PagePrimaryNumberControl
  | PagePrimarySelectControl
  | PagePrimaryDirectoryControl
  | PagePrimaryBooleanControl
  | PagePrimaryChoiceControl
  | PagePrimaryReadonlyControl;

export type PagePrimaryAction = {
  id: string;
  label: PagePrimaryResolvable<string>;
  title?: string;
  tone?: "default" | "primary" | "danger";
  plain?: boolean;
  disabled?: PagePrimaryResolvable<boolean>;
  loading?: PagePrimaryResolvable<boolean>;
  run: () => void | Promise<void>;
};

export type PagePrimarySection = {
  id: string;
  title: string;
  /** Navigation can precede the document context; other sections keep their current order. */
  placement?: "before-context";
  actionLayout?: "flow" | "grid";
  /** Readonly metadata can use one label/value row per property instead of metric tiles. */
  readonlyLayout?: "properties";
  description?: PagePrimaryResolvable<string>;
  progress?: PagePrimaryResolvable<PagePrimaryProgress>;
  controls?: readonly PagePrimaryControl[];
  actions?: readonly PagePrimaryAction[];
};

export type PagePrimaryProgress = {
  label: string;
  state: "idle" | "running" | "done" | "warning" | "failed" | "cancelled";
  completed?: number;
  total?: number;
  detail?: string;
  stages?: readonly string[];
  activeStage?: number;
};

/**
 * 复杂工具也通过同一 Primary contribution 接口接入。
 *
 * 普通页面优先使用 sections；需要树、表格或多段列表的工具可提供 content，
 * 由统一 Primary Host 注入 pageId / workbenchTabId 并负责生命周期。
 */
export type PagePrimaryContent = {
  component: Component;
  props?: PagePrimaryResolvable<Record<string, unknown>>;
};

export type PagePrimaryContribution = {
  title?: PagePrimaryResolvable<string>;
  /** Omit the generic document introduction when the Main already explains the tool. */
  showContext?: boolean;
  summary?: PagePrimaryResolvable<string>;
  thumbnail?: PagePrimaryResolvable<{ src: string; alt: string } | null>;
  thumbnailGeneration?: PagePrimaryResolvable<import("../types/thumbnail").ThumbnailGeneration | null>;
  sections?: PagePrimaryResolvable<readonly PagePrimarySection[]>;
  content?: PagePrimaryContent;
};

const contributions = shallowReactive(new Map<string, PagePrimaryContribution>());

export function pagePrimaryContributionKey(pageId: string, workbenchTabId?: string): string {
  return workbenchTabId?.trim() || pageId.trim();
}

export function setPagePrimaryContribution(
  pageId: string,
  workbenchTabId: string | undefined,
  contribution: PagePrimaryContribution | null,
): void {
  const key = pagePrimaryContributionKey(pageId, workbenchTabId);
  if (!key) return;
  if (contribution) contributions.set(key, contribution);
  else contributions.delete(key);
}

export function getPagePrimaryContribution(
  pageId: string,
  workbenchTabId?: string,
): PagePrimaryContribution | undefined {
  const tabKey = pagePrimaryContributionKey(pageId, workbenchTabId);
  return contributions.get(tabKey) ?? contributions.get(pageId.trim());
}

/**
 * 页面把范围、筛选和运行命令登记给左侧 Primary。
 * contribution 内可直接使用 ref/computed，因而不需要把业务状态复制到壳层。
 */
export function usePagePrimaryContribution(
  pageId: string,
  workbenchTabId: string | undefined,
  contribution: PagePrimaryContribution,
): void {
  const key = pagePrimaryContributionKey(pageId, workbenchTabId);
  setPagePrimaryContribution(pageId, workbenchTabId, contribution);
  onUnmounted(() => {
    if (contributions.get(key) === contribution) contributions.delete(key);
  });
}

export function useRegisteredPagePrimaryContribution(
  pageId: MaybeRefOrGetter<string>,
  workbenchTabId: MaybeRefOrGetter<string>,
) {
  return computed(() => getPagePrimaryContribution(toValue(pageId), toValue(workbenchTabId)));
}
