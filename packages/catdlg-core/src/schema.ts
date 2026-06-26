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
  /** 同名 Wizard 头文件（仅写 CAA2 WIZARD WIDGET DECLARATION SECTION） */
  header?: string;
  /** 同名 Wizard 源文件（当前只发现/展示，构造段写回待 fixture 收口） */
  cpp?: string;
  /** locale id → `.CATNls` 相对路径 */
  nlsLocales?: Record<string, string>;
};

export type CaaDialogParseLocale = {
  id: string;
  catNlsRel: string;
  keyCount: number;
  /** 磁盘上的原始文本（写回时保留结构） */
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
  /** graphic / bitmaps / icons 等目录下的具体图片文件 */
  bitmapFiles?: CaaDialogBitmapFile[];
  imageRefs: string[];
  warnings: string[];
  /** 默认语言 `.CATNls` 原始文本（写回时保留 WIZARD 区与注释） */
  catNlsSourceText?: string;
  /** 其它语言 `.CATNls` 原始文本（locale id → 文件内容） */
  localeNlsSourceTexts?: Record<string, string>;
  /** 解析过程诊断（终端与 Web 壳层日志） */
  logs?: string[];
  /** Read-only field bindings inferred from UpdateDialog / Wizard comments. */
  bindings?: CaaDialogBinding[];
  /** 磁盘上实际探测的绝对路径 */
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
  /** 非主语言 NLS 扁平键（locale → key → value） */
  localeNls?: Record<string, Record<string, string>>;
  rsc?: Record<string, string>;
  parseMeta?: CaaDialogParseMeta;
};

export type CatDlgFlatNode = {
  id: string;
  type: string;
  properties: Record<string, string | number | string[] | number[]>;
};
