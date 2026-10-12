import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { ApiError, pickWorkspaceDirectory } from "../../api";
import { absoluteJsonTarget, exportBomDelivery, joinOutputDirectory, previewBomDelivery, releaseBomDelivery } from "./api";
import type { BomDeliveryPhase, BomDeliveryPreview, BomDeliveryReceipt, BomDeliveryStatus } from "./types";

export interface BomDeliveryHost {
  appendLog: (text: string, options: { source: string; open: boolean }) => void;
  confirmExport: (message: string) => Promise<boolean>;
  pickDirectory?: (hint: string) => Promise<string | null>;
}

/** Volatile server handles never enter PageSession. All asynchronous paths bind to one context. */
export function useCadBomDelivery(workspace: Ref<string>, host: BomDeliveryHost, active: Ref<boolean> = ref(true)) {
  const preview = shallowRef<BomDeliveryPreview | null>(null), receipt = shallowRef<BomDeliveryReceipt | null>(null);
  const phase = ref<BomDeliveryPhase>("idle"), status = ref<BomDeliveryStatus>("idle"), error = ref("");
  const targetSetting = ref(""), directorySetting = ref(""), expired = ref(false);
  let generation = 0, disposed = false, controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, previewWorkspace = "";
  let exportingTarget = "";
  const released = new Set<string>();
  const preferences = new Map<string, { target: string; directory: string }>();
  const busy = computed(() => phase.value !== "idle");
  const counts = computed(() => ({ parts: preview.value?.envelope.parts.length ?? 0, boms: preview.value?.envelope.boms.length ?? 0, items: preview.value?.envelope.boms.reduce((total, bom) => total + bom.items.length, 0) ?? 0 }));
  const targetPath = computed(() => {
    if (targetSetting.value) return targetSetting.value;
    if (!preview.value) return "";
    const root = directorySetting.value || `${workspace.value.replace(/[\\/]+$/, "")}/.phoenix/outbox`;
    try { return joinOutputDirectory(root, preview.value.suggested_filename); } catch { return ""; }
  });
  const targetValid = computed(() => { try { absoluteJsonTarget(targetPath.value); return true; } catch { return false; } });
  const canPreview = computed(() => active.value && !!workspace.value.trim() && !busy.value && !disposed);
  const canExport = computed(() => canPreview.value && !!preview.value && !expired.value && targetValid.value);
  function log(text: string, open = true) { host.appendLog(`[BOM交付] ${text}`, { source: "bom_delivery", open }); }
  function current(token: number, ws: string) { return !disposed && active.value && generation === token && workspace.value === ws; }
  function clearTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
  function release(ws: string, value: BomDeliveryPreview | null) {
    if (!value) return;
    const key = `${ws}\0${value.preview_id}`;
    if (released.has(key)) return;
    released.add(key);
    // Cleanup must not inherit the cancelled request's signal.
    void releaseBomDelivery(ws, value.preview_id).catch(e => { released.delete(key); log(`预览释放未确认（将在服务端到期）：${message(e)}`); });
  }
  function message(value: unknown): string {
    const base = value instanceof Error ? value.message : String(value);
    const causes = value instanceof ApiError && value.payload && typeof value.payload === "object" && "causes" in value.payload ? value.payload.causes : null;
    const entries = [{ text: base, limit: 4096 }, ...(Array.isArray(causes) ? causes.filter((c): c is string => typeof c === "string").slice(0, 8).map(text => ({ text, limit: 512 })) : [])];
    const seen = new Set<string>();
    return entries.filter(entry => { const key = entry.text.trim(); if (seen.has(key)) return false; seen.add(key); return true; }).map(entry => entry.text.slice(0, entry.limit)).join("\n");
  }
  function invalidate(reason: "cancel" | "context" | "dispose") {
    const wasExporting = phase.value === "exporting", target = exportingTarget;
    generation++; controller?.abort(); controller = null; clearTimer();
    release(previewWorkspace, preview.value); preview.value = null; expired.value = false; phase.value = "idle";
    if (wasExporting) {
      error.value = `结果未确认，请核对目标：${target}`; status.value = "unconfirmed"; log(error.value);
    } else if (reason === "cancel") { error.value = "已取消；预览已释放。"; status.value = "cancelled"; }
  }
  function armExpiry(value: BomDeliveryPreview, token: number, ws: string) {
    clearTimer();
    const expire = () => {
      if (!current(token, ws) || preview.value !== value) return;
      expired.value = true;
      if (!busy.value) { status.value = "expired"; error.value = "预览已到期，请重新预览后导出。"; }
      if (!busy.value) release(ws, value);
    };
    const delay = Date.parse(value.expires_at) - Date.now();
    if (delay <= 0) expire(); else timer = setTimeout(expire, Math.min(delay, 2147483647));
  }
  async function runPreview() {
    if (!canPreview.value) return;
    release(previewWorkspace, preview.value); clearTimer(); preview.value = null; expired.value = false; error.value = "";
    const token = ++generation, ws = workspace.value;
    controller = new AbortController(); const signal = controller.signal; phase.value = "previewing";
    try {
      const result = await previewBomDelivery(ws, signal);
      if (!current(token, ws)) { release(ws, result); return; }
      preview.value = result; previewWorkspace = ws; status.value = "ready"; armExpiry(result, token, ws);
    } catch (e) {
      if (!current(token, ws)) return;
      error.value = message(e); status.value = "failed"; log(error.value);
    } finally { if (current(token, ws)) { phase.value = "idle"; controller = null; if (expired.value) { status.value = "expired"; error.value = "预览已到期，请重新预览后导出。"; } } }
  }
  async function runExport() {
    if (!canExport.value) return;
    const value = preview.value!, ws = workspace.value, target = targetPath.value, token = generation;
    phase.value = "confirming"; error.value = "";
    try {
      const yes = await host.confirmExport(`范围：整个工作空间 ${ws}\n目标：${target}\n交付 ID：${value.envelope.transferId}\n载荷哈希：${value.envelope.payloadHash}\n零件 ${counts.value.parts} · 直接 BOM ${counts.value.boms} · 直接行 ${counts.value.items}\n只写入服务端已预检的原始 JSON；不覆盖已有不同内容，不修改 CAD，不自动联网。自选目录须已存在。`);
      if (!current(token, ws) || preview.value !== value) return;
      if (!yes) return;
      if (expired.value || Date.parse(value.expires_at) <= Date.now()) { expired.value = true; status.value = "expired"; error.value = "预览已到期，请重新预览后导出。"; return; }
      if (targetPath.value !== target) { error.value = "目标已变化，请核对后重新确认导出。"; return; }
      exportingTarget = target; phase.value = "exporting"; controller = new AbortController();
      const result = await exportBomDelivery(ws, value.preview_id, target, controller.signal);
      if (result.transferId !== value.envelope.transferId || result.payloadHash !== value.envelope.payloadHash || result.bytes !== value.bytes) throw new Error("导出回执与预览不一致");
      if (!current(token, ws)) { log(`旧上下文已确认发布（${ws}）：${result.targetPath}${result.warnings.length ? `\n${result.warnings.join("\n")}` : ""}`); return; }
      receipt.value = result; status.value = "published";
      log(`${result.status === "existing" ? "已有相同字节" : "已发布"}：${result.targetPath}${result.directorySync === "failed" ? "\n文件已发布，但目录同步未确认；不保证断电耐久。" : ""}${result.warnings.length ? `\n${result.warnings.join("\n")}` : ""}`, result.directorySync === "failed" || result.warnings.length > 0);
    } catch (e) {
      if (!current(token, ws)) return;
      if (e instanceof ApiError && e.status === 410) { expired.value = true; status.value = "expired"; error.value = `${message(e)}\n预览不可再用，请重新预览；不会自动重新导出。`; release(ws, value); }
      else if (phase.value === "exporting" && (!(e instanceof ApiError) || e.status >= 500)) { status.value = "unconfirmed"; error.value = `结果未确认，请核对目标：${target}\n${message(e)}`; }
      else { status.value = "failed"; error.value = message(e); }
      log(error.value);
    } finally { if (current(token, ws)) { phase.value = "idle"; controller = null; exportingTarget = ""; if (expired.value) release(ws, value); } }
  }
  async function chooseDirectory() {
    if (!canPreview.value) return;
    const token = generation, ws = workspace.value; phase.value = "choosing";
    try {
      const hint = directorySetting.value || ws;
      const picked = host.pickDirectory ? await host.pickDirectory(hint) : await pickWorkspaceDirectory(hint);
      const result = typeof picked === "string" ? picked : picked && !picked.cancelled ? picked.path : null;
      if (current(token, ws) && result) { directorySetting.value = result; targetSetting.value = ""; }
    } catch (e) { if (current(token, ws)) { error.value = message(e); log(error.value); } }
    finally { if (current(token, ws)) phase.value = "idle"; }
  }
  watch(workspace, (ws, previous) => {
    preferences.set(previous, { target: targetSetting.value, directory: directorySetting.value });
    invalidate("context"); receipt.value = null; error.value = ""; status.value = "idle";
    const settings = preferences.get(ws); targetSetting.value = settings?.target ?? ""; directorySetting.value = settings?.directory ?? "";
  }, { flush: "sync" });
  watch(active, value => { if (!value) invalidate("context"); }, { flush: "sync" });
  onScopeDispose(() => { invalidate("dispose"); disposed = true; });
  return { preview, receipt, phase, status, error, targetSetting, directorySetting, targetPath, targetValid, expired, busy, counts, canPreview, canExport, runPreview, runExport, chooseDirectory, cancel: () => invalidate("cancel") };
}
