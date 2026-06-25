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
  spinner?: { min?: number; max?: number; step?: number; prec?: number };
  nls?: ControlNls;
  children: CaaDialogNode[];
};

export type CaaDialogSources = {
  catDlg: string;
  catNls?: string;
  catRsc?: string;
  header?: string;
  cpp?: string;
  nlsLocales?: Record<string, string>;
};

export type CaaDialogParseLocale = {
  id: string;
  catNlsRel: string;
  keyCount: number;
  sourceText?: string;
};

export type CaaDialogBitmapFile = {
  repoRelPath: string;
  filename: string;
  sizeBytes?: number;
};

export type CaaDialogBinding = {
  nodeId?: string;
  controlId?: string;
  target: string;
  source: "updateDialog" | "kevinWizard" | "heuristic";
  line?: number;
  text?: string;
};

export type CaaDialogParseMeta = {
  locales: CaaDialogParseLocale[];
  primaryLocale: string;
  catRscRel?: string;
  rscKeyCount: number;
  bitmapDirs: string[];
  bitmapFileCount: number;
  bitmapFiles?: CaaDialogBitmapFile[];
  imageRefs: string[];
  warnings: string[];
  logs?: string[];
  bindings?: CaaDialogBinding[];
  catNlsSourceText?: string;
  localeNlsSourceTexts?: Record<string, string>;
  resolvedAbs?: {
    workspaceRoot?: string;
    catDlg?: string;
    catNls?: string;
    catRsc?: string;
    header?: string;
    cpp?: string;
    msgCatalogDir?: string;
  };
};

export type CaaDialogIr = {
  schemaVersion: 1;
  dialogName: string;
  title?: string;
  root: CaaDialogNode;
  sources: CaaDialogSources;
  localeNls?: Record<string, Record<string, string>>;
  rsc?: Record<string, string>;
  parseMeta?: CaaDialogParseMeta;
};
