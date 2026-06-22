import type { InjectionKey } from "vue";
import type { CodeIgnoreForm } from "./useCodeIgnoreForm";

export const codeIgnoreFormKey: InjectionKey<CodeIgnoreForm> = Symbol("codeIgnoreForm");
