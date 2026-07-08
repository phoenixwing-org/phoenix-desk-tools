/** pnwPythonSidecar — Python 3 调用封装
 *
 * 管理保留 Python 程序的路径检测、调用和状态。
 * 用于 step_batch、sw_step_export 等依赖 freecadcmd/COM 的模块。
 *
 * 未来可拆到 phoenix-wing/sidecar/pnwPythonSidecar.ts
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 路径检测 ──────────────────────────────────────────

let _pythonPath: string | null = null;
let _detected = false;

/** 检测 Python 3 路径（优先级：env → which → 默认路径） */
export function detectPython(): string | null {
  if (_detected) return _pythonPath;
  _detected = true;

  // 1. 环境变量
  if (process.env.PHOENIX_PYTHON_PATH) {
    const p = process.env.PHOENIX_PYTHON_PATH;
    if (existsSync(p)) { _pythonPath = p; return p; }
  }

  // 2. 系统默认
  const candidates = [
    "/usr/bin/python3",
    "/usr/local/bin/python3",
    "/opt/homebrew/bin/python3",
    "python3",  // PATH 查找
  ];

  for (const c of candidates) {
    // 简单检测：如果不是绝对路径，假设 PATH 中能找到
    if (!c.startsWith("/")) { _pythonPath = c; return c; }
    if (existsSync(c)) { _pythonPath = c; return c; }
  }

  return null;
}

/** 强制设置 Python 路径 */
export function setPythonPath(p: string): void {
  _pythonPath = p; _detected = true;
}

/** 当前 Python 路径（未检测返回 null） */
export function pythonPath(): string | null { return _pythonPath; }

/** Python 是否可用 */
export function pythonAvailable(): boolean { return _pythonPath !== null; }

// ── 调用接口 ──────────────────────────────────────────

export interface PythonResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  killed: boolean;
}

/** 执行 Python 脚本 */
export function runPython(
  scriptRel: string,
  args: string[] = [],
  opts?: { timeout?: number; cwd?: string },
): Promise<PythonResult> {
  const py = detectPython();
  if (!py) return Promise.resolve({ ok: false, stdout: "", stderr: "Python 3 未找到", exitCode: null, killed: false });

  const scriptPath = path.resolve(__dirname, "../../scripts", scriptRel);
  return new Promise((resolve) => {
    const child = execFile(py, [scriptPath, ...args], {
      timeout: opts?.timeout ?? 60_000,
      cwd: opts?.cwd,
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, stdout, stderr, exitCode: (err as any).code ?? null, killed: (err as any).killed ?? false });
      } else {
        resolve({ ok: true, stdout, stderr, exitCode: 0, killed: false });
      }
    });
  });
}

/** 快速检查 Python 是否可用（启动时调用） */
export async function checkPythonSidecar(): Promise<{ available: boolean; path: string | null; version: string | null }> {
  const py = detectPython();
  if (!py) return { available: false, path: null, version: null };

  return new Promise((resolve) => {
    execFile(py, ["--version"], { timeout: 5000 }, (err, stdout, stderr) => {
      const version = (stdout || stderr).trim();
      resolve({ available: !err, path: py, version: version || null });
    });
  });
}
