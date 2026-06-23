/** 与 packages/catdlg-core schema 对齐（Web 侧类型） */

export type GridPlacement = {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  anchor?: string;
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
  gridLayout?: { rowResizable?: number[]; colResizable?: number[] };
  size?: { textHeight?: number; textWidth?: number; columnCount?: number; visibleColumnCount?: number };
  nls?: ControlNls;
  children: CaaDialogNode[];
};

export type CaaDialogIr = {
  schemaVersion: 1;
  dialogName: string;
  title?: string;
  root: CaaDialogNode;
  sources: { catDlg: string; catNls?: string; catRsc?: string };
};
