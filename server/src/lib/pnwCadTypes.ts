/** pnwCadTypes — 对应 Python rename_analysis/types.py + cad_index_types.py */

export interface XLinkBasenameHit {
  host_rel: string;
  xlink_attr: string;
  link_label: string;
  target_basename: string;
}

export interface HostRefGroup {
  host_rel: string;
  hits: XLinkBasenameHit[];
}

export class RenameAnalysisError extends Error {
  constructor(msg: string) { super(msg); this.name = "RenameAnalysisError"; }
}

// 对应 Python cad_index_types
export function isFcstdFilename(name: string): boolean {
  return /\.fcstd$/i.test(name);
}

export function cadAssetKind(filename: string): string {
  if (/\.fcstd$/i.test(filename)) return "fcstd";
  if (/\.(step|stp)$/i.test(filename)) return "step";
  if (/\.(dxf|dwg)$/i.test(filename)) return "cad_exchange";
  if (/\.md$/i.test(filename)) return "markdown";
  if (/\.pdf$/i.test(filename)) return "pdf";
  if (/\.(png|jpg|jpeg|gif|svg)$/i.test(filename)) return "image";
  return "other";
}

// 对应 Python default_install.py
export function defaultFreecadInstallDir(): string | null {
  if (process.platform === "darwin") return "/Applications/FreeCAD.app";
  if (process.platform === "win32") return "C:\\Program Files\\FreeCAD 1.1";
  return null;
}
