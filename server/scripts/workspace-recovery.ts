import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createWorkspaceRecoveryBackup,
  inspectWorkspaceRecoveryBackup,
  restoreWorkspaceRecoveryBackup,
} from "../src/features/workspace-recovery/recovery.js";

export const WORKSPACE_RECOVERY_USAGE = [
  "数据库与 outbox 备份恢复（不包含 CAD 模型/缩略图，不自动切换工作空间）",
  "backup --workspace ABS --destination ABS --confirmed",
  "inspect --backup ABS",
  "restore --backup ABS --destination ABS --confirmed",
  "备份/恢复目标必须不存在，且父目录已存在；不接受原位重建、覆盖或删除参数。",
].join("\n");

export type WorkspaceRecoveryCommand =
  | { action: "help" }
  | { action: "backup"; workspace: string; destination: string }
  | { action: "inspect"; backup: string }
  | { action: "restore"; backup: string; destination: string };

/** This parser authorizes only the exact explicitly named new target, never overwrite. */
export function parseWorkspaceRecoveryCommand(args: readonly string[]): WorkspaceRecoveryCommand {
  if (args.length === 0 || args.length === 1 && ["--help", "help"].includes(args[0])) return { action: "help" };
  const [action, ...tail] = args;
  if (!["backup", "inspect", "restore"].includes(action)) throw new Error("未知恢复命令");
  const accepted = action === "backup" ? ["--workspace", "--destination", "--confirmed"]
    : action === "inspect" ? ["--backup"] : ["--backup", "--destination", "--confirmed"];
  const values = new Map<string, string | true>();
  for (let index = 0; index < tail.length; index++) {
    const key = tail[index];
    if (!accepted.includes(key) || values.has(key)) throw new Error("参数未知或重复");
    if (key === "--confirmed") { values.set(key, true); continue; }
    const value = tail[++index];
    if (!value || value.startsWith("--") || value.includes("\0") || !path.isAbsolute(value)) {
      throw new Error("路径参数必须为非空绝对路径");
    }
    values.set(key, value);
  }
  if (accepted.some(key => !values.has(key))) throw new Error("缺少参数；写入操作需要 --confirmed");
  if (action === "backup") return { action, workspace: values.get("--workspace") as string, destination: values.get("--destination") as string };
  if (action === "inspect") return { action, backup: values.get("--backup") as string };
  return { action: "restore", backup: values.get("--backup") as string, destination: values.get("--destination") as string };
}

export async function runWorkspaceRecoveryCommand(args: readonly string[], signal?: AbortSignal): Promise<unknown> {
  const command = parseWorkspaceRecoveryCommand(args);
  if (command.action === "help") return { usage: WORKSPACE_RECOVERY_USAGE };
  if (command.action === "backup") return createWorkspaceRecoveryBackup({ workspace: command.workspace, destinationDirectory: command.destination, signal });
  if (command.action === "inspect") return inspectWorkspaceRecoveryBackup(command.backup, signal);
  return restoreWorkspaceRecoveryBackup({ backupDirectory: command.backup, destinationWorkspace: command.destination, signal });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const result = await runWorkspaceRecoveryCommand(process.argv.slice(2), abort.signal);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const failure = error as Error & { code?: string; incompleteDirectory?: string };
    process.stderr.write(`${JSON.stringify({
      code: failure.code ?? "workspace_recovery_failed", detail: failure.message,
      ...(failure.incompleteDirectory ? { incompleteDirectory: failure.incompleteDirectory } : {}),
    })}\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
