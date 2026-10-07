import { computed, ref, type Ref } from "vue";
import type { BomFields, RenameLog } from "../api";
import {
  executeFileRename,
  fetchRenameLogs,
  analyzeRenameReferences,
  applyRenameAnalysisCorrections,
  applyReferenceLabelCorrections,
} from "../api";
import { useAppShell } from "./useAppShell";
import { useRenamePreferencesStore } from "../stores/renamePreferences";
import {
  validateRenameTarget,
  isFcstdFile,
} from "../utils/fileRename";

export interface RenameDialogOpenOptions {
  preferredNewFilename?: string;
}

export function useRenameDialog(
  rel: Ref<string>,
  originalFilename: Ref<string>,
  form: Ref<Partial<BomFields>>,
  baseline: Ref<Partial<BomFields>>,
  bomReadonly: Ref<boolean | undefined> = ref(undefined),
) {
  const shell = useAppShell();

  const dialogOpen = ref(false);
  const newFilename = ref("");
  const renamed = ref(false);
  const lastRenameLog = ref<RenameLog | null>(null);
  const renameLogs = ref<RenameLog[]>([]);
  const logsLoading = ref(false);
  const busy = ref(false);
  const pageError = ref("");
  const completionNote = ref("");
  const preferences = useRenamePreferencesStore();
  const option = (key: "fixXref" | "syncLabels" | "fixBasename") => computed({
    get: () => preferences[key],
    set: (value: boolean) => preferences.setOption(key, value),
  });
  const fixXref = option("fixXref");
  const syncLabels = option("syncLabels");
  const fixBasename = option("fixBasename");

  const isFcstd = computed(() => isFcstdFile(rel.value));
  const drawingReadonly = computed(() => bomReadonly.value ?? /\.drawing\.fcstd$/i.test(rel.value));
  const sameFilename = computed(() => Boolean(newFilename.value.trim())
    && newFilename.value.trim() === originalFilename.value.trim());

  const canRename = computed(
    () =>
      Boolean(rel.value.trim()) &&
      Boolean(newFilename.value.trim()) &&
      !renamed.value &&
      !sameFilename.value &&
      !busy.value,
  );

  /** 去重排序后的改名记录展示列表：本次改名置顶 */
  const displayRenameLogs = computed(() => {
    const logs = renameLogs.value;
    const latest = lastRenameLog.value;
    if (!latest) return logs;
    const idx = logs.findIndex((l) => l.id === latest.id);
    if (idx < 0) return [latest, ...logs];
    if (idx === 0) return logs;
    return [logs[idx], ...logs.slice(0, idx), ...logs.slice(idx + 1)];
  });

  function isCurrentRenameLog(log: RenameLog) {
    return lastRenameLog.value?.id === log.id;
  }

  async function loadRenameLogs() {
    const path = rel.value.trim();
    if (!path) {
      renameLogs.value = [];
      return;
    }
    logsLoading.value = true;
    try {
      const data = await fetchRenameLogs(20, path);
      renameLogs.value = data.entries ?? [];
    } catch {
      renameLogs.value = [];
    } finally {
      logsLoading.value = false;
    }
  }

  function open(opts?: RenameDialogOpenOptions) {
    pageError.value = "";
    completionNote.value = "";
    renamed.value = false;
    lastRenameLog.value = null;

    const preferred = opts?.preferredNewFilename?.trim();
    const draft = form.value.filename?.trim();
    const disk = originalFilename.value.trim();
    newFilename.value = preferred || draft || disk;

    dialogOpen.value = true;
    void loadRenameLogs();
  }

  function close() {
    dialogOpen.value = false;
  }

  function resetWorkflow() {
    renamed.value = false;
    lastRenameLog.value = null;
    const preferred = form.value.filename?.trim();
    newFilename.value = preferred || originalFilename.value.trim();
  }

  function openRenameAnalysisForLog(log: RenameLog) {
    shell.openRenameAnalysis({
      renameLogId: log.id,
      oldBasename: log.old_basename,
      newBasename: log.new_basename,
      excludeRepoRel: log.new_repo_rel_path,
      autoAnalyze: true,
    });
  }

  async function onRefreshLogs() {
    if (logsLoading.value || !rel.value.trim()) return;
    await loadRenameLogs();
    shell.setStatus("已刷新改名记录");
  }

  /** 一键静默全执行管道 */
  async function onRename() {
    const curRel = rel.value.trim();
    if (!curRel || !canRename.value) return;

    // Step 1: 校验
    const validation = validateRenameTarget(
      originalFilename.value,
      newFilename.value,
    );
    if (!validation.valid) {
      pageError.value = validation.error ?? "校验失败";
      return;
    }

    busy.value = true;
    pageError.value = "";

    const targetName = newFilename.value.trim();
    const renameWorkspace = shell.workspacePath.value;
    const options = { fixXref: fixXref.value, syncLabels: syncLabels.value, fixBasename: fixBasename.value };
    const correctionWarnings: string[] = [];
    completionNote.value = "";
    const hasUnsaved = !drawingReadonly.value &&
      (["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName", "label"] as const).some(
        (k) => String(form.value[k] ?? "").trim() !== String(baseline.value[k] ?? "").trim(),
      );

    try {
      // Step 2: 磁盘改名（如有未写属性先写回）
      shell.appendLog(
        `[改名] ${originalFilename.value} → ${targetName}…`,
        { source: "file_detail", open: true },
      );

      const data = await executeFileRename(
        curRel,
        { ...(drawingReadonly.value ? baseline.value : form.value), filename: targetName },
        baseline.value,
        { writeAttrsFirst: hasUnsaved },
      );

      renamed.value = true;
      lastRenameLog.value = data.rename_log ?? null;

      const log = data.rename_log;
      shell.appendLog(
        `[改名] 已重命名为 ${data.filename}${log ? ` · 记录 #${log.id}` : ""}`,
        { source: "file_detail" },
      );

      // Step 3-4: 引用修正（仅 FCStd 且勾选时）
      if (isFcstd.value && (options.fixXref || options.syncLabels || options.fixBasename) && log) {
        shell.appendLog("[改名] 扫描入向引用…", { source: "file_detail" });

        const scan = await analyzeRenameReferences({
          rename_log_id: log.id,
          transitive: true,
          persist: true,
        });

        shell.appendLog(
          `[改名] 引用扫描完成：宿主 ${scan.host_count} 个 · XLink ${scan.hit_count} 处 · 待修正 ${scan.pending_hit_count ?? 0} 处`,
          { source: "file_detail" },
        );
        const hosts = [...new Set(scan.hosts.map((h) => h.host_repo_rel_path.trim()).filter(Boolean))];
        if (!hosts.length) {
          if (scan.host_count > 0 || scan.hit_count > 0 || (scan.pending_hit_count ?? 0) > 0) {
            throw new Error("引用扫描计数与宿主列表不一致，请重新分析");
          }
          completionNote.value = "当前索引未发现引用，已跳过引用修正";
          if (drawingReadonly.value || data.bom_readonly) completionNote.value += "；未找到适用的 Label / basename 修正项";
          shell.appendLog(`[改名] ${completionNote.value}。若磁盘文件在其他地方发生变化，请更新索引后再分析。`, {
            source: "file_detail",
          });
        }

        if (hosts.length && options.fixBasename && !scan.pending_hit_count) {
          shell.appendLog("[改名] 未找到待修正的 basename 引用，已跳过", { source: "file_detail" });
        }

        // Step 4: 修正 XLink（fixXref 或 fixBasename 勾选时）
        if (hosts.length && (options.fixXref || options.fixBasename) && scan.pending_hit_count && scan.pending_hit_count > 0) {
          shell.appendLog(`[改名] 写回 XLink 修正（${hosts.length} 个宿主）…`, {
            source: "file_detail",
          });

          const result = await applyRenameAnalysisCorrections(hosts, {
            renameLogId: log.id,
            transitive: true,
          });

          shell.appendLog(
            `[改名] XLink 修正完成：${result.xlink_patches} 处 · 宿主 ${result.applied_hosts.length} 个`,
            { source: "file_detail" },
          );

          if (result.failed.length > 0) {
            correctionWarnings.push(`XLink 修正失败 ${result.failed.length} 个宿主`);
            shell.appendLog(
              `[改名] ⚠ XLink 修正失败 ${result.failed.length} 个：${result.failed.map((f) => f.host_repo_rel_path).join(", ")}`,
              { source: "file_detail" },
            );
          }
        }

        // Step 5: 标签同步
        if (options.syncLabels && hosts.length) {
          shell.appendLog(`[改名] 同步引用标签（${hosts.length} 个宿主）…`, {
            source: "file_detail",
          });

          const labelResult = await applyReferenceLabelCorrections(hosts, {
            renameLogId: log.id,
            transitive: true,
            labelScope: "incoming",
          });

          shell.appendLog(
            `[改名] 标签同步完成：${labelResult.label_patches ?? 0} 处`,
            { source: "file_detail" },
          );
          if (labelResult.failed.length > 0) {
            correctionWarnings.push(`标签同步失败 ${labelResult.failed.length} 个宿主`);
          }
          for (const skipped of labelResult.skipped || []) {
            const note = `${skipped.host_repo_rel_path}：${skipped.reason}`;
            shell.appendLog(`[改名] ${note}`, { source: "file_detail" });
          }
          if (labelResult.skipped?.length) completionNote.value = `未找到适用的 Label 修正项 ${labelResult.skipped.length} 处，已跳过`;
        }
      }

      if (correctionWarnings.length) {
        pageError.value = `文件已改名，但${correctionWarnings.join("；")}。请打开改名分析继续处理。`;
        shell.appendLog(`[改名] ${pageError.value}`, { source: "file_detail" });
        shell.setStatus("文件已改名，引用修正未完成");
      } else {
        shell.setStatus(`改名完成：${targetName}${completionNote.value ? ` · ${completionNote.value}` : ""}`);
      }
    } catch (e) {
      const msg = String(e);
      pageError.value = renamed.value ? `文件已改名，但后续处理失败：${msg}。请打开改名分析继续处理。` : msg;
      shell.appendLog(`[改名] 失败: ${msg}`, { source: "file_detail" });
    } finally {
      busy.value = false;
      // Refresh even after a partial failure or lost reply; a disk rename may have succeeded.
      // Do not select/open a file or refresh another workspace after switching away.
      if (shell.workspacePath.value === renameWorkspace) shell.requestTreeRescan();
      await loadRenameLogs();
    }
  }

  return {
    dialogOpen,
    newFilename,
    renamed,
    canRename,
    sameFilename,
    busy,
    logsLoading,
    renameLogs,
    displayRenameLogs,
    isFcstd,
    fixXref,
    syncLabels,
    fixBasename,
    pageError,
    completionNote,
    lastRenameLog,
    open,
    close,
    onRename,
    onRefreshLogs,
    resetWorkflow,
    openRenameAnalysisForLog,
    isCurrentRenameLog,
  };
}
