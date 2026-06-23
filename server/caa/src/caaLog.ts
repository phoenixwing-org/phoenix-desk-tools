/** CAA Node 服务 · 终端诊断输出（`pnpm dev:caa` 控制台） */

export function caaLog(message: string, detail?: Record<string, unknown>): void {
  const line = `[caa] ${message}`;
  if (detail && Object.keys(detail).length > 0) {
    console.log(line, detail);
  } else {
    console.log(line);
  }
}

export function caaLogLines(lines: string[]): void {
  for (const line of lines) caaLog(line);
}
