import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** The hint only chooses the starting directory; selecting a folder never writes files. */
export function resolveDirectoryPickerStart(hint: unknown, workspace: string): string {
  for (const candidate of [typeof hint === "string" ? hint.trim() : "", workspace]) {
    if (!candidate || candidate.includes("\0")) continue;
    const absolute = path.isAbsolute(candidate) ? candidate : workspace ? path.resolve(workspace, candidate) : "";
    try { if (absolute && fs.statSync(absolute).isDirectory()) return absolute; } catch { /* Try workspace. */ }
  }
  return "";
}

/** Paths are arguments/environment values, never interpolated into executable scripts. */
export function directoryPickerCommand(platform: NodeJS.Platform, start: string) {
  if (platform === "darwin") return {
    command: "osascript",
    args: ["-e", `on run argv
      if (count of argv) > 0 then
        return POSIX path of (choose folder with prompt "选择工作空间目录" default location (POSIX file (item 1 of argv)))
      end if
      return POSIX path of (choose folder with prompt "选择工作空间目录")
    end run`, ...start ? [start] : []],
    env: process.env,
  };
  if (platform === "win32") return {
    command: "powershell",
    args: ["-NoProfile", "-STA", "-Command", `Add-Type -AssemblyName System.Windows.Forms; $picker=New-Object System.Windows.Forms.FolderBrowserDialog; $picker.SelectedPath=$env:PHOENIX_DIRECTORY_HINT; if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $picker.SelectedPath }`],
    env: { ...process.env, PHOENIX_DIRECTORY_HINT: start },
  };
  return {
    command: "zenity",
    args: ["--file-selection", "--directory", "--title=选择工作空间目录", ...start ? [`--filename=${start.replace(/\/$/, "")}/`] : []],
    env: process.env,
  };
}

export function pickDirectoryNative(hint: unknown, workspace: string): Promise<string | null> {
  const { command, args, env } = directoryPickerCommand(process.platform, resolveDirectoryPickerStart(hint, workspace));
  return new Promise(resolve => {
    execFile(command, args, { timeout: 120_000, env }, (error, stdout) => {
      resolve(error ? null : stdout.trim() || null);
    });
  });
}
