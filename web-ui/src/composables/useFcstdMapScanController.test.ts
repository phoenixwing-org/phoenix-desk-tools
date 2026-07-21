import { nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useFcstdMapScanController } from "./useFcstdMapScanController";

function payload() {
  return {
    exists: true,
    prefs: { force_update_part_name: false },
    entries: [],
    stats: {
      total_entries: 2,
      present: 2,
      missing: 0,
      cad_file_count: 3,
      fcstd_file_count: 2,
    },
  } as any;
}

function progressFixture() {
  const state = ref<any>(null);
  const isRunning = ref(false);
  const store = {
    setFullscreen: vi.fn(),
    confirmTask: vi.fn(),
    removeTask: vi.fn(),
  };
  return {
    state,
    isRunning,
    store,
    startPolling: vi.fn(async (start: () => Promise<unknown>) => {
      await start();
      isRunning.value = true;
    }),
    cancel: vi.fn(async () => undefined),
    resume: vi.fn(async () => false),
  } as any;
}

function createController(progress = progressFixture(), overrides: Record<string, unknown> = {}) {
  const transport = {
    start: vi.fn(async () => ({ scan_id: "scan-1" })),
    poll: vi.fn(),
    cancel: vi.fn(),
    load: vi.fn(async () => payload()),
  };
  const callbacks = {
    onStatus: vi.fn(),
    onLog: vi.fn(),
    onCompleted: vi.fn(),
  };
  const controller = useFcstdMapScanController({
    forceUpdatePartName: ref(true),
    scanWorksetId: ref("ws-1"),
    worksetName: () => "主工作集",
    ...callbacks,
    progress,
    prompt: vi.fn(async () => ({ choiceId: "cancel" })) as any,
    transport: transport as any,
    ...overrides,
  });
  return { controller, progress, transport, callbacks };
}

describe("useFcstdMapScanController", () => {
  it("统一装配扫描参数、任务名和开始状态", async () => {
    const { controller, progress, transport, callbacks } = createController();

    await controller.start();

    expect(transport.start).toHaveBeenCalledWith(true, "ws-1");
    expect(progress.startPolling.mock.calls[0][3]).toMatchObject({
      taskName: "工程内搜索 · 主工作集",
      singleton: true,
    });
    expect(callbacks.onLog).toHaveBeenCalledWith("工程内搜索：工作集「主工作集」", true);
    expect(callbacks.onStatus).toHaveBeenCalledWith("扫描已开始，详情见浮层面板");
  });

  it("确认已完成冲突后在同一 controller 内重试", async () => {
    const progress = progressFixture();
    progress.startPolling
      .mockRejectedValueOnce({ __conflict: true, taskId: "old", taskName: "旧扫描", status: "done" })
      .mockImplementationOnce(async (start: () => Promise<unknown>) => {
        await start();
        progress.isRunning.value = true;
      });
    const prompt = vi.fn(async () => ({ choiceId: "new" }));
    const { controller } = createController(progress, { prompt: prompt as any });

    await controller.start();

    expect(progress.store.confirmTask).toHaveBeenCalledWith("old");
    expect(progress.startPolling).toHaveBeenCalledTimes(2);
  });

  it("仅在轮询终态加载结果并交给页面回调", async () => {
    const { controller, progress, transport, callbacks } = createController();
    await controller.start();
    expect(transport.load).not.toHaveBeenCalled();

    progress.state.value = { status: "done" };
    await nextTick();
    await nextTick();

    expect(transport.load).toHaveBeenCalledTimes(1);
    expect(callbacks.onCompleted).toHaveBeenCalledWith(expect.objectContaining({ exists: true }));
    expect(callbacks.onStatus).toHaveBeenCalledWith("扫描完成：存在 2 · CAD 3");
  });

  it("刷新恢复和取消都复用共享进度控制器", async () => {
    const progress = progressFixture();
    progress.resume.mockResolvedValue(true);
    progress.isRunning.value = true;
    const { controller, callbacks } = createController(progress);

    await controller.resume();
    await controller.cancel();

    expect(progress.resume).toHaveBeenCalledTimes(1);
    expect(progress.cancel).toHaveBeenCalledTimes(1);
    expect(callbacks.onStatus).toHaveBeenCalledWith("已恢复扫描，详情见浮层面板");
  });
});
