/** CAA 对话框中间表示（IR） */

export type GridPlacement = {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  anchor?: string;
};

export type GridLayoutRes = {
  rowResizable?: number[];
  colResizable?: number[];
};

export type ControlNls = {
  title?: string;
  help?: string;
  shortHelp?: string;
  longHelp?: string;
  columnTitles?: string[];
};

export type CaaDialogNode = {
  id: string;
  type: string;
  father?: string;
  style?: string[];
  grid?: GridPlacement;
  gridLayout?: GridLayoutRes;
  size?: { textHeight?: number; textWidth?: number; columnCount?: number; visibleColumnCount?: number };
  spinner?: { min?: number; max?: number; step?: number; prec?: number };
  nls?: ControlNls;
  children: CaaDialogNode[];
};

export type CaaDialogSources = {
  catDlg: string;
  catNls?: string;
  catRsc?: string;
};

export type CaaDialogIr = {
  schemaVersion: 1;
  dialogName: string;
  title?: string;
  root: CaaDialogNode;
  sources: CaaDialogSources;
};

export type CatDlgFlatNode = {
  id: string;
  type: string;
  properties: Record<string, string | number | string[] | number[]>;
};
