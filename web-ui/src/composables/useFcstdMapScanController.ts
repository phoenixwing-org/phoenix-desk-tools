import { computed, ref, watch, type Ref } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import {
  cancelFcstdMapScan,
  fetchFcstdMap,
  fetchFcstdMapScanProgress,
  startFcstdMapScan,
  type FcstdMapPayload,
  type ScanProgressPayload,
} from "../api";
import { useAsyncProgress } from "./useAsyncProgress";

type PromptChoice = Awaited<ReturnType<typeof pnwPromptChoice>>;
type PromptOptions = Parameters<typeof pnwPromptChoice>[0];
type ScanProgress = ReturnType<typeof useAsyncProgress>;

export interface FcstdMapScanControllerOptions {
  forceUpdatePartName: Ref<boolean>;
  scanWorksetId: Ref<string>;
  worksetName: (id: string) => string;
  onStatus: (message: string) => void;
  onLog: (message: string, open?: boolean) => void;
  onCompleted: (payload: FcstdMapPayload) => void | Promise<void>;
  progress?: ScanProgress;
  prompt?: (options: PromptOptions) => Promise<PromptChoice>;
  transport?: {
    start: typeof startFcstdMapScan;
    poll: (scanId: string) => Promise<ScanProgressPayload>;
    cancel: typeof cancelFcstdMapScan;
    load: typeof fetchFcstdMap;
  };
}

type ScanConflict = {
  __conflict: true;
  taskId: string;
  taskName: string;
  status?: string;
};

function isScanConflict(error: unknown): error is ScanConflict {
  return Boolean(error && typeof error === "object" && "__conflict" in error);
}

/** CAD 索引扫描的 Page Controller：统一启动、冲突、终态、取消与刷新恢复。 */
export function useFcstdMapScanController(options: FcstdMapScanControllerOptions) {
  const progress = options.progress ?? useAsyncProgress("fcstd-scan");
  const prompt = options.prompt ?? pnwPromptChoice;
  const transport = options.transport ?? {
    start: startFcstdMapScan,
    poll: fetchFcstdMapScanProgress,
    cancel: cancelFcstdMapScan,
    load: fetchFcstdMap,
  };
  const scanStarting = ref(false);
  const scanning = computed(() => scanStarting.value || progress.isRunning.value);

  function currentWorksetName(): string {
    return options.worksetName(options.scanWorksetId.value) || "工作集";
  }

  async function attemptStart(): Promise<void> {
    try {
      await progress.startPolling(
        () => transport.start(options.forceUpdatePartName.value, options.scanWorksetId.value || undefined),
        transport.poll,
        transport.cancel,
        {
          taskName: options.scanWorksetId.value
            ? `工程内搜索 · ${currentWorksetName()}`
            : "FCStd 工程内搜索",
          singleton: true,
        },
      );
      options.onStatus(progress.isRunning.value
        ? "扫描已开始，详情见浮层面板"
        : "扫描已在运行中，详情见浮层面板");
    } catch (error) {
      if (!isScanConflict(error)) throw error;
      const isDone = error.status === "done" || error.status === "error" || error.status === "cancelled";
      const choice = await prompt({
        title: isDone ? "上次任务已完成" : "上次扫描未完成",
        defaultChoiceId: isDone ? "view" : "cancel",
        message: isDone
          ? `上次「${error.taskName}」已完成，可以查看结果或开始新搜索。`
          : `检测到上次「${error.taskName}」未完成。BOM 缓存已保留，继续扫描会跳过已读取的文件。`,
        choices: isDone
          ? [
              { id: "view", label: "查看上次结果", variant: "primary" },
              { id: "new", label: "新搜索", variant: "default" },
            ]
          : [
              { id: "cancel", label: "取消", variant: "default" },
              { id: "continue", label: "继续上次扫描", variant: "primary" },
              { id: "restart", label: "放弃缓存，重新开始", variant: "danger" },
            ],
      });
      if (!choice.choiceId || choice.choiceId === "cancel") return;
      if (choice.choiceId === "view") {
        progress.store.setFullscreen(true);
        return;
      }
      if (isDone) progress.store.confirmTask(error.taskId);
      else progress.store.removeTask(error.taskId);
      await attemptStart();
    }
  }

  async function start(): Promise<void> {
    if (scanning.value) return;
    scanStarting.value = true;
    const scope = options.scanWorksetId.value
      ? `工作集「${currentWorksetName()}」`
      : "全部";
    options.onLog(`工程内搜索：${scope}`, true);
    try {
      await attemptStart();
    } catch (error) {
      const message = String(error);
      options.onLog(message);
      options.onStatus(message);
      await prompt({
        title: "扫描失败",
        defaultChoiceId: "ok",
        message: message || "扫描请求失败，请检查后端是否正常运行",
        choices: [{ id: "ok", label: "确认", variant: "primary" }],
      });
    } finally {
      scanStarting.value = false;
    }
  }

  watch(
    () => progress.state.value?.status,
    async (status, previousStatus) => {
      if (!status || status === previousStatus) return;
      if (status === "done") {
        try {
          const result = await transport.load();
          options.onLog(`扫描完成：CAD ${result.stats.cad_file_count} · FCStd ${result.stats.fcstd_file_count}`);
          options.onStatus(`扫描完成：存在 ${result.stats.present} · CAD ${result.stats.cad_file_count}`);
          await options.onCompleted(result);
        } catch (error) {
          options.onLog(String(error));
          options.onStatus(String(error));
        }
        return;
      }
      if (status === "error") {
        const message = progress.state.value?.error || "扫描出错";
        options.onLog(`扫描出错: ${message}`);
        options.onStatus(message);
        await prompt({
          title: "扫描出错",
          defaultChoiceId: "ok",
          message,
          choices: [{ id: "ok", label: "确认", variant: "primary" }],
        });
        return;
      }
      if (status === "cancelled") {
        options.onLog("扫描已取消");
        options.onStatus("扫描已取消");
      }
    },
  );

  async function resume(): Promise<boolean> {
    const resumed = await progress.resume();
    if (resumed && progress.isRunning.value) options.onStatus("已恢复扫描，详情见浮层面板");
    return resumed;
  }

  return {
    progress,
    scanStarting,
    scanning,
    start,
    cancel: progress.cancel,
    resume,
  };
}
