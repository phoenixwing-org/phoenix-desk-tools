import { getCaaControlCatalogEntry } from "@phoenix/catdlg-core";

export interface CaaControlBehavior {
  /** 是否有可编辑 Title */
  hasTitle: boolean;
  /** 是否有 Help / ShortHelp / LongHelp */
  hasHelp: boolean;
}

const DEFAULT: CaaControlBehavior = { hasTitle: false, hasHelp: false };

export function getControlBehavior(type: string): CaaControlBehavior {
  return getCaaControlCatalogEntry(type)?.nls ?? DEFAULT;
}

export function hasTitle(type: string): boolean {
  return getControlBehavior(type).hasTitle;
}

export function hasHelp(type: string): boolean {
  return getControlBehavior(type).hasHelp;
}
