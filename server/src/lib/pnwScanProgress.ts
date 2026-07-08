/** pnwScanProgress — 扫描进度跟踪，对应 Python cad_index/scan_progress.py */

export type ScanPhase = "walk" | "bom" | "xref" | "done" | "error";

export interface ScanProgress {
  scanId: string;
  phase: ScanPhase;
  message: string;
  current: number;
  total: number;
  startedAt: number;
  cancelled: boolean;
  error?: string;
}

const scans = new Map<string, ScanProgress>();

export function registerScan(scanId: string, total: number): ScanProgress {
  const p: ScanProgress = { scanId, phase: "walk", message: "扫描中…", current: 0, total, startedAt: Date.now(), cancelled: false };
  scans.set(scanId, p);
  return p;
}

export function getProgress(scanId: string): ScanProgress | undefined {
  return scans.get(scanId);
}

export function updateProgress(scanId: string, update: Partial<ScanProgress>) {
  const p = scans.get(scanId);
  if (p) Object.assign(p, update);
}

export function cancelScan(scanId: string) {
  const p = scans.get(scanId);
  if (p) p.cancelled = true;
}

export function cleanupScan(scanId: string) {
  scans.delete(scanId);
}

export function listRecentScans(): ScanProgress[] {
  return [...scans.values()].sort((a, b) => b.startedAt - a.startedAt);
}
