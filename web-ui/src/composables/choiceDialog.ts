import { ref } from "vue";

export type ChoiceDialogOption = {
  id: string;
  label: string;
  variant?: "primary" | "danger" | "default";
  /** 无勾选时禁用（如「纳入所选」） */
  disabled?: boolean;
};

export type ChoiceDialogCheckboxItem = {
  id: string;
  label: string;
};

export type ChoiceDialogCheckboxes = {
  items: ChoiceDialogCheckboxItem[];
  /** 默认勾选 id；缺省为全部 */
  defaultSelectedIds?: string[];
};

export type ChoiceDialogRequest = {
  title: string;
  message: string;
  choices: ChoiceDialogOption[];
  /** 打开时聚焦的按钮（建议危险操作用 `"cancel"`） */
  defaultChoiceId?: string;
  checkboxes?: ChoiceDialogCheckboxes;
};

export type ChoiceDialogResult = {
  choiceId: string | null;
  checkedIds: string[];
};

export const choiceDialogOpen = ref(false);
export const choiceDialogRequest = ref<ChoiceDialogRequest | null>(null);

let pendingResolve: ((value: ChoiceDialogResult) => void) | null = null;

/** 单次弹出，多按钮选择；有 checkboxes 时 checkedIds 为当前勾选 id */
export function promptChoice(req: ChoiceDialogRequest): Promise<ChoiceDialogResult> {
  if (pendingResolve) {
    pendingResolve({ choiceId: null, checkedIds: [] });
  }
  choiceDialogRequest.value = req;
  choiceDialogOpen.value = true;
  return new Promise((resolve) => {
    pendingResolve = resolve;
  });
}

export function resolveChoice(id: string | null, checkedIds: string[] = []) {
  choiceDialogOpen.value = false;
  choiceDialogRequest.value = null;
  pendingResolve?.({ choiceId: id, checkedIds });
  pendingResolve = null;
}
