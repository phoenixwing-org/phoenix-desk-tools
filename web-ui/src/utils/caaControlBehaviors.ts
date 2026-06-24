/**
 * 各 CAA 控件类型的 NLS 行为配置。
 * 与设计文档 §6.3 同步。
 */

export interface CaaControlBehavior {
  /** 是否有可编辑 Title */
  hasTitle: boolean;
  /** 是否有 Help / ShortHelp / LongHelp */
  hasHelp: boolean;
}

const BEHAVIORS: Record<string, CaaControlBehavior> = {
  CATDlgDialog:       { hasTitle: true,  hasHelp: false },
  CATDlgFrame:         { hasTitle: false, hasHelp: true  },
  CATDlgLabel:         { hasTitle: true,  hasHelp: true  },
  CATDlgEditor:        { hasTitle: false, hasHelp: true  },
  CATDlgSelectorList:  { hasTitle: false, hasHelp: true  },
  CATDlgCombo:         { hasTitle: false, hasHelp: true  },
  CATDlgMultiList:     { hasTitle: false, hasHelp: true  },
  CATDlgPushButton:    { hasTitle: true,  hasHelp: true  },
  CATDlgCheckButton:   { hasTitle: true,  hasHelp: true  },
  CATDlgRadioButton:   { hasTitle: true,  hasHelp: true  },
  CATDlgSpinner:       { hasTitle: false, hasHelp: true  },
  CATDlgTabPage:       { hasTitle: true,  hasHelp: false },
  CATDlgTabContainer:  { hasTitle: false, hasHelp: false },
  CATDlgContainer:     { hasTitle: false, hasHelp: false },
  CATDlgSeparator:     { hasTitle: false, hasHelp: false },
};

const DEFAULT: CaaControlBehavior = { hasTitle: false, hasHelp: false };

export function getControlBehavior(type: string): CaaControlBehavior {
  return BEHAVIORS[type] ?? DEFAULT;
}

export function hasTitle(type: string): boolean {
  return getControlBehavior(type).hasTitle;
}

export function hasHelp(type: string): boolean {
  return getControlBehavior(type).hasHelp;
}
