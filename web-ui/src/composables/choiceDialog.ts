import { ref } from "vue";

export type ChoiceDialogOption = {
  id: string;
  label: string;
  variant?: "primary" | "danger" | "default";
};

export type ChoiceDialogRequest = {
  title: string;
  message: string;
  choices: ChoiceDialogOption[];
};

export const choiceDialogOpen = ref(false);
export const choiceDialogRequest = ref<ChoiceDialogRequest | null>(null);

let pendingResolve: ((value: string | null) => void) | null = null;

/** 单次弹出，多按钮选择；返回所选 id，取消或关闭为 null */
export function promptChoice(req: ChoiceDialogRequest): Promise<string | null> {
  if (pendingResolve) {
    pendingResolve(null);
  }
  choiceDialogRequest.value = req;
  choiceDialogOpen.value = true;
  return new Promise((resolve) => {
    pendingResolve = resolve;
  });
}

export function resolveChoice(id: string | null) {
  choiceDialogOpen.value = false;
  choiceDialogRequest.value = null;
  pendingResolve?.(id);
  pendingResolve = null;
}
