import type { InjectionKey } from "vue";
import type { NlsStringProp } from "@desk-tools/catdlg-core";

export type CaaNlsEditTarget = {
  nodeId: string;
  prop: NlsStringProp;
  columnIndex?: number;
};

export type CaaNlsEditContext = {
  enabled: boolean | import("vue").ComputedRef<boolean>;
  commit: (key: string, value: string, target: CaaNlsEditTarget) => void;
};

export const CAA_NLS_EDIT_KEY: InjectionKey<CaaNlsEditContext> = Symbol("caaNlsEdit");

export type CaaNlsSessionContext = {
  canEdit: boolean | import("vue").ComputedRef<boolean>;
  primaryCatNlsRel: string | import("vue").ComputedRef<string>;
  isDirty: boolean | import("vue").ComputedRef<boolean>;
  openCatNlsEditor: (repoRelPath?: string) => void;
  hasChineseLocale: boolean | import("vue").ComputedRef<boolean>;
  createChineseLocale: () => Promise<void>;
};

export const CAA_NLS_SESSION_KEY: InjectionKey<CaaNlsSessionContext> = Symbol("caaNlsSession");
