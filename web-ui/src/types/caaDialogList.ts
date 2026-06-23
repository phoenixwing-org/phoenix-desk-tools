export type CaaDialogListItem = {
  catDlgRel: string;
  dialogName: string;
  fileName: string;
  groupKey: string;
  groupLabel: string;
  /** 样例路径落在工具仓库而非当前工作空间时 */
  isDemo?: boolean;
};

export type CaaDialogListGroup = {
  groupKey: string;
  label: string;
  items: CaaDialogListItem[];
};

export type CaaDialogListResponse = {
  workspaceRoot: string;
  count: number;
  groups: CaaDialogListGroup[];
};
