import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  KT_CODEGEN_TABLE_DATA_KIND,
  KT_CODEGEN_TABLE_DATA_SCHEMA_VERSION,
  KtCodegenParam,
  KtCodegenTableCore,
  ktCodegenBlockKeysForPreset,
  ktCodegenIsBlockKey,
  type KtCodegenArtifact,
  type KtCodegenBlockKey,
  type KtCodegenDiagnostic,
  type KtCodegenTableData,
} from "@phoenix-wing/kt-codegen";
import {
  ApiError,
  applyKtCodegenPlan,
  fetchKtCodegenDocumentState,
  fetchKtCodegenSourceStates,
  fetchKtCodegenSourcePreview,
  fetchKtCodegenDocuments,
  openKtCodegenDocument,
  runKtCodegenPreflight,
  saveKtCodegenDocument,
  type KtCodegenDocumentSummary,
  type KtCodegenApplyPayload,
  type KtCodegenFileStatePayload,
  type KtCodegenHostDocument,
  type KtCodegenPreflightPayload,
  type KtCodegenSourcePreviewPayload,
  type KtCodegenSourceCandidateSummary,
} from "../api";

const ALL_BLOCK_KEYS = ktCodegenBlockKeysForPreset("all");
const STATE_REQUEST_TIMEOUT_MS = 15_000;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : Boolean(error && typeof error === "object" && "name" in error
      && (error as { name?: unknown }).name === "AbortError");
}

export type KtCodegenRecoveryConflict = {
  path: string;
  snapshotFingerprint: string;
  diskFingerprint: string;
  param: unknown;
  table: KtCodegenTableData;
};

export type KtCodegenProblem = {
  key: string;
  origin: "配置" | "预检" | "Apply";
  diagnostic: KtCodegenDiagnostic;
};

function defineKtCodegenStore(scopeId: string) {
  return defineStore(`kt-codegen:${scopeId}`, () => {
  const documents = ref<KtCodegenDocumentSummary[]>([]);
  const active = ref<KtCodegenHostDocument | null>(null);
  const selectedBlockKeys = ref<KtCodegenBlockKey[]>([...ALL_BLOCK_KEYS]);
  const preflight = ref<KtCodegenPreflightPayload | null>(null);
  const selectedArtifactId = ref("");
  const selectedRegionId = ref("");
  const sourcePreview = ref<KtCodegenSourcePreviewPayload | null>(null);
  const sourcePreviewKind = ref<"region" | "candidate" | "diagnostic" | null>(null);
  const sourcePreviewLoading = ref(false);
  const sourcePreviewError = ref("");
  const loadingDocuments = ref(false);
  const opening = ref(false);
  const saving = ref(false);
  const applying = ref(false);
  const preflighting = ref(false);
  const dirty = ref(false);
  const status = ref("请选择左侧 Codegen 配置文档");
  const discoveryMeta = ref({
    scanned: 0,
    truncated: false,
    cacheHits: 0,
    filesRead: 0,
    snapshotBytes: 0,
    byteLimitReached: false,
  });
  const recoveryConflict = ref<KtCodegenRecoveryConflict | null>(null);
  const externalChange = ref<KtCodegenFileStatePayload | null>(null);
  const lastApply = ref<KtCodegenApplyPayload | null>(null);
  const runtimeProblems = ref<KtCodegenProblem[]>([]);
  const observedFileSignature = ref("");
  let sourcePreviewRequest = 0;
  let sourceStateRequest = 0;
  let preflightRequest = 0;
  let openRequest = 0;
  let saveRequest = 0;
  let applyRequest = 0;
  let externalCheckRequest = 0;
  let discoveryGeneration = 0;
  let discoveryRefreshPending = false;
  let discoveryRequest: Promise<void> | null = null;
  let discoveryAbort: AbortController | null = null;
  let preflightAbort: AbortController | null = null;
  let externalCheckAbort: AbortController | null = null;
  let sourceStateCheckAbort: AbortController | null = null;
  let sourcePreviewAbort: AbortController | null = null;
  let externalCheckInFlight: {
    path: string;
    promise: Promise<KtCodegenFileStatePayload | null>;
  } | null = null;
  let sourceStateCheckInFlight: {
    plan: KtCodegenPreflightPayload;
    promise: Promise<number | null>;
  } | null = null;

  const selectedArtifact = computed<KtCodegenArtifact | null>(() => {
    if (!selectedArtifactId.value) return null;
    const artifacts = preflight.value?.plan.artifacts ?? [];
    return artifacts.find((artifact) => artifact.id === selectedArtifactId.value) ?? null;
  });

  const problems = computed<KtCodegenProblem[]>(() => [
    ...(active.value?.diagnostics ?? []).map((diagnostic, index) => ({
      key: `document:${index}:${diagnostic.code}`,
      origin: "配置" as const,
      diagnostic,
    })),
    ...(preflight.value?.plan.diagnostics ?? []).map((diagnostic, index) => ({
      key: `preflight:${index}:${diagnostic.code}`,
      origin: "预检" as const,
      diagnostic,
    })),
    ...(lastApply.value?.diagnostics ?? []).map((diagnostic, index) => ({
      key: `apply:${index}:${diagnostic.code}`,
      origin: "Apply" as const,
      diagnostic,
    })),
    ...runtimeProblems.value,
  ]);

  const problemTone = computed<"default" | "warning" | "error">(() => {
    if (problems.value.some((problem) => problem.diagnostic.severity === "error")) return "error";
    if (problems.value.some((problem) => problem.diagnostic.severity === "warning")) return "warning";
    return "default";
  });

  function clearRuntimeProblems(origin: KtCodegenProblem["origin"]): void {
    runtimeProblems.value = runtimeProblems.value.filter((problem) => problem.origin !== origin);
  }

  function reportRuntimeProblem(origin: "预检" | "Apply", code: string, error: unknown): void {
    clearRuntimeProblems(origin);
    runtimeProblems.value = [...runtimeProblems.value, {
      key: `host:${origin}:${Date.now()}:${code}`,
      origin,
      diagnostic: {
        code,
        severity: "error",
        message: String(error),
      },
    }];
  }

  function upsertDocumentSummary(document: KtCodegenHostDocument): void {
    const next: KtCodegenDocumentSummary = {
      path: document.path,
      file_name: document.file_name,
      format: document.format,
      class_name: document.class_name,
      item_count: document.item_count,
      diagnostic_count: document.diagnostic_count,
    };
    const current = documents.value.find((item) => item.path === document.path);
    if (current) Object.assign(current, next);
    else {
      documents.value.push(next);
      documents.value.sort((left, right) => left.path.localeCompare(right.path));
    }
  }

  function resetPlan(message = "控制符选择已变化，请重新预检"): void {
    const hadActivePreflight = preflighting.value;
    preflightRequest += 1;
    preflightAbort?.abort();
    preflightAbort = null;
    preflight.value = null;
    preflighting.value = false;
    selectedArtifactId.value = "";
    selectedRegionId.value = "";
    sourcePreview.value = null;
    sourcePreviewKind.value = null;
    sourcePreviewLoading.value = false;
    sourcePreviewError.value = "";
    sourcePreviewRequest += 1;
    sourceStateRequest += 1;
    sourcePreviewAbort?.abort();
    sourcePreviewAbort = null;
    sourceStateCheckAbort?.abort();
    sourceStateCheckAbort = null;
    sourceStateCheckInFlight = null;
    lastApply.value = null;
    runtimeProblems.value = [];
    if (active.value) status.value = message;
    if (hadActivePreflight) flushQueuedDiscovery();
  }

  function discover(): Promise<void> {
    if (discoveryRequest) return discoveryRequest;
    if (preflighting.value) {
      discoveryRefreshPending = true;
      return Promise.resolve();
    }
    discoveryRefreshPending = false;
    const generation = discoveryGeneration;
    let request!: Promise<void>;
    request = (async () => {
      loadingDocuments.value = true;
      const abort = new AbortController();
      discoveryAbort = abort;
      try {
        const payload = await fetchKtCodegenDocuments({ signal: abort.signal });
        if (generation !== discoveryGeneration) return;
        documents.value = payload.documents;
        // 打开/dirty/冲突会话即使被 Ignore、预算或磁盘删除暂时排除，也继续在
        // Block 中可见；用户应从现有会话明确处理，而不是被一次重扫隐藏。
        if (active.value) {
          upsertDocumentSummary(active.value);
        }
        discoveryMeta.value = {
          scanned: payload.scanned_file_count,
          truncated: payload.truncated,
          cacheHits: payload.cache_hit_count,
          filesRead: payload.files_read,
          snapshotBytes: Number(payload.config_snapshot_bytes || 0),
          byteLimitReached: Boolean(payload.config_scan_byte_limit_reached),
        };
        const partialSuffix = payload.config_scan_byte_limit_reached
          ? "；本轮冷解析达到 64 MiB，后续刷新会继续补齐"
          : payload.truncated ? "；扫描达到 5000 文件上限" : "";
        if (!active.value && payload.documents.length) {
          status.value = `发现 ${payload.documents.length} 个 Codegen 配置${partialSuffix}`;
        } else if (!active.value && !payload.documents.length) {
          status.value = payload.config_scan_byte_limit_reached
            ? "本轮配置冷解析达到 64 MiB，尚未发现兼容配置；后续刷新会继续补齐"
            : `当前工作空间未发现可识别的 Codegen JSON/CSV${partialSuffix}`;
        }
      } catch (error) {
        if (isAbortError(error)) return;
        if (generation === discoveryGeneration) status.value = String(error);
        throw error;
      } finally {
        if (discoveryRequest === request) {
          discoveryRequest = null;
          discoveryAbort = null;
          loadingDocuments.value = false;
        }
      }
    })();
    discoveryRequest = request;
    return request;
  }

  function cancelDiscovery(options: { quiet?: boolean } = {}): void {
    discoveryRefreshPending = false;
    if (!discoveryRequest) return;
    discoveryGeneration += 1;
    discoveryAbort?.abort();
    discoveryAbort = null;
    discoveryRequest = null;
    loadingDocuments.value = false;
    if (!options.quiet) status.value = "已取消 Codegen 配置发现";
  }

  function flushQueuedDiscovery(): void {
    if (!discoveryRefreshPending || preflighting.value || discoveryRequest) return;
    discoveryRefreshPending = false;
    void discover().catch(() => undefined);
  }

  async function open(
    path: string,
    options: { discardDraft?: boolean } = {},
  ): Promise<KtCodegenHostDocument> {
    if (saving.value) throw new Error("Codegen 配置正在保存，请稍候再切换文档");
    if (applying.value) throw new Error("Codegen 正在写回源码，请稍候再切换文档");
    if ((dirty.value || recoveryConflict.value) && !options.discardDraft) {
      throw new Error("当前 Codegen 草稿尚未处理，重新打开文档前需要明确放弃草稿");
    }
    const request = ++openRequest;
    externalCheckRequest += 1;
    externalCheckAbort?.abort();
    externalCheckAbort = null;
    externalCheckInFlight = null;
    resetPlan("正在打开 Codegen 配置…");
    opening.value = true;
    try {
      const document = await openKtCodegenDocument(path);
      if (request !== openRequest) return document;
      active.value = document;
      upsertDocumentSummary(document);
      recoveryConflict.value = null;
      externalChange.value = null;
      observedFileSignature.value = document.file_signature;
      dirty.value = false;
      preflight.value = null;
      selectedArtifactId.value = "";
      selectedRegionId.value = "";
      sourcePreview.value = null;
      sourcePreviewKind.value = null;
      sourcePreviewLoading.value = false;
      sourcePreviewError.value = "";
      sourcePreviewRequest += 1;
      status.value = `已打开 ${document.file_name} · ${document.item_count} 行`;
      return document;
    } catch (error) {
      if (request === openRequest) status.value = String(error);
      throw error;
    } finally {
      if (request === openRequest) opening.value = false;
    }
  }

  async function revert(): Promise<KtCodegenHostDocument | null> {
    if (!active.value) return null;
    return open(active.value.path, { discardDraft: true });
  }

  function markDirty(itemCount?: number): void {
    if (!active.value) return;
    active.value.class_name = `${active.value.param.namePrefix}${active.value.param.nameMiddle}`;
    if (typeof itemCount === "number" && Number.isFinite(itemCount)) {
      active.value.item_count = Math.max(0, Math.trunc(itemCount));
    }
    upsertDocumentSummary(active.value);
    dirty.value = true;
    resetPlan("配置已有修改，请保存或直接按当前草稿重新预检");
  }

  async function save(table: KtCodegenTableData): Promise<KtCodegenHostDocument | null> {
    if (!active.value) return null;
    if (opening.value) throw new Error("Codegen 配置正在切换，请稍候再保存");
    if (applying.value) throw new Error("Codegen 正在写回源码，请稍候再保存配置");
    if (recoveryConflict.value) {
      throw new Error("请先复制或放弃旧 Codegen 冲突草稿，再保存当前磁盘版本");
    }
    const request = ++saveRequest;
    const baseDocument = active.value;
    const draftParam = JSON.parse(JSON.stringify(baseDocument.param)) as unknown;
    const draftTable = JSON.parse(JSON.stringify(table)) as KtCodegenTableData;
    saving.value = true;
    try {
      const document = await saveKtCodegenDocument({
        path: baseDocument.path,
        fingerprint: baseDocument.fingerprint,
        param: baseDocument.param,
        table,
      });
      if (request !== saveRequest || active.value?.path !== baseDocument.path) return null;
      active.value = document;
      upsertDocumentSummary(document);
      externalChange.value = null;
      observedFileSignature.value = document.file_signature;
      externalCheckRequest += 1;
      externalCheckAbort?.abort();
      externalCheckAbort = null;
      externalCheckInFlight = null;
      dirty.value = false;
      resetPlan("已保存；源码预检缓存已清除");
      status.value = document.diagnostic_count
        ? `已保存，${document.diagnostic_count} 条兼容提示`
        : `已保存 ${document.file_name}`;
      return document;
    } catch (error) {
      if (request !== saveRequest || active.value?.path !== baseDocument.path) return null;
      if (error instanceof ApiError
        && error.status === 409
        && active.value?.path === baseDocument.path) {
        try {
          const diskDocument = await openKtCodegenDocument(baseDocument.path);
          if (request !== saveRequest || active.value?.path !== baseDocument.path) return null;
          active.value = diskDocument;
          upsertDocumentSummary(diskDocument);
          externalChange.value = null;
          observedFileSignature.value = diskDocument.file_signature;
          externalCheckRequest += 1;
          externalCheckAbort?.abort();
          externalCheckAbort = null;
          externalCheckInFlight = null;
          dirty.value = false;
          resetPlan("正在保护外部修改冲突草稿…");
          rememberRecoveryConflict({
            path: baseDocument.path,
            snapshotFingerprint: baseDocument.fingerprint,
            diskFingerprint: diskDocument.fingerprint,
            param: draftParam,
            table: draftTable,
          });
          return null;
        } catch {
          // 无法读取新的磁盘版本时保留当前草稿，继续抛出最初的并发冲突。
        }
      }
      status.value = String(error);
      throw error;
    } finally {
      if (request === saveRequest) saving.value = false;
    }
  }

  async function apply(table: KtCodegenTableData): Promise<KtCodegenApplyPayload | null> {
    const document = active.value;
    const plan = preflight.value;
    if (!document || !plan) throw new Error("请先完成 Codegen 预检");
    if (opening.value || saving.value || preflighting.value || applying.value) {
      throw new Error("Codegen 正在执行其他文档操作，请稍候再 Apply");
    }
    if (recoveryConflict.value) throw new Error("请先处理 Codegen 冲突草稿，再 Apply 源码");
    if (!plan.safe_to_apply) throw new Error("当前 Codegen 预检未通过安全 Apply 门禁");
    const request = ++applyRequest;
    const pathAtStart = document.path;
    applying.value = true;
    lastApply.value = null;
    try {
      const result = await applyKtCodegenPlan({
        param: document.param,
        table,
        block_keys: selectedBlockKeys.value,
        expected_plan_fingerprint: plan.plan_fingerprint,
      });
      if (request !== applyRequest || active.value?.path !== pathAtStart) return null;
      resetPlan("源码已写回；原预检计划已失效");
      lastApply.value = result;
      status.value = `已写回 ${result.files.length} 个源码文件 · ${result.region_count} 个区域 · 复读验证通过`;
      return result;
    } catch (error) {
      if (request === applyRequest && active.value?.path === pathAtStart) status.value = String(error);
      throw error;
    } finally {
      if (request === applyRequest) applying.value = false;
    }
  }

  async function runPreflight(table: KtCodegenTableData): Promise<KtCodegenPreflightPayload | null> {
    if (!active.value) return null;
    if (opening.value) throw new Error("Codegen 配置正在切换，请稍候再预检");
    if (applying.value) throw new Error("Codegen 正在写回源码，请稍候再预检");
    // A user preflight is the foreground workspace scan. Replace an older
    // discovery scan; background refreshes arriving while it runs coalesce
    // into one discovery after the foreground operation finishes.
    if (discoveryRequest) cancelDiscovery({ quiet: true });
    sourceStateRequest += 1;
    sourceStateCheckAbort?.abort();
    sourceStateCheckAbort = null;
    sourceStateCheckInFlight = null;
    preflightAbort?.abort();
    const abort = new AbortController();
    preflightAbort = abort;
    const request = ++preflightRequest;
    preflighting.value = true;
    try {
      const result = await runKtCodegenPreflight({
        param: active.value.param,
        table,
        block_keys: selectedBlockKeys.value,
      }, { signal: abort.signal });
      if (request !== preflightRequest) return null;
      preflight.value = result;
      sourceStateCheckInFlight = null;
      selectedArtifactId.value = result.plan.artifacts[0]?.id ?? "";
      const firstRegion = result.plan.artifacts[0]?.regionId
        ?? result.plan.markerRegions[0]?.id
        ?? "";
      const cacheSuffix = result.reused ? " · 复用安全缓存" : "";
      const sourceCacheSuffix = result.source_cache_hits
        ? ` · 源文件缓存 ${result.source_cache_hits}`
        : "";
      const scanSuffix = result.source_scan_byte_limit_reached
        ? " · 源码快照已达 64 MiB，Apply 已关闭"
        : result.source_scan_truncated ? " · 扫描已达 5000 文件上限，Apply 已关闭" : "";
      status.value = `${result.candidate_file_count} 个候选文件 · ${result.plan.markerRegions.length} 个区域 · ${result.plan.artifacts.length} 个产物 · ${result.plan.diagnostics.length} 条诊断${cacheSuffix}${sourceCacheSuffix}${scanSuffix}`;
      if (firstRegion) void previewRegion(firstRegion);
      return result;
    } catch (error) {
      if (request !== preflightRequest) return null;
      if (isAbortError(error)) {
        status.value = "已取消 Codegen 预检";
        return null;
      }
      preflight.value = null;
      selectedArtifactId.value = "";
      selectedRegionId.value = "";
      sourcePreview.value = null;
      sourcePreviewLoading.value = false;
      sourcePreviewError.value = "";
      sourcePreviewRequest += 1;
      status.value = String(error);
      throw error;
    } finally {
      if (request === preflightRequest) {
        preflightAbort = null;
        preflighting.value = false;
        flushQueuedDiscovery();
      }
    }
  }

  function cancelPreflight(): void {
    if (!preflighting.value) return;
    preflightRequest += 1;
    preflightAbort?.abort();
    preflightAbort = null;
    preflighting.value = false;
    status.value = "已取消 Codegen 预检";
    flushQueuedDiscovery();
  }

  function setSelectedBlocks(keys: readonly string[]): void {
    if (applying.value) return;
    const next = [...new Set(keys.filter(ktCodegenIsBlockKey))];
    if (next.length === selectedBlockKeys.value.length
      && next.every((key, index) => key === selectedBlockKeys.value[index])) return;
    selectedBlockKeys.value = next;
    resetPlan();
  }

  function restoreDraft(rawParam: unknown, rawTable: unknown): boolean {
    const document = active.value;
    if (!document || !rawParam || typeof rawParam !== "object" || Array.isArray(rawParam)) return false;
    if (!rawTable || typeof rawTable !== "object" || Array.isArray(rawTable)) return false;
    const table = rawTable as Partial<KtCodegenTableData>;
    if (table.kind !== KT_CODEGEN_TABLE_DATA_KIND
      || table.schemaVersion !== KT_CODEGEN_TABLE_DATA_SCHEMA_VERSION
      || !Array.isArray(table.items)) return false;

    try {
      const param = new KtCodegenParam(rawParam as Partial<KtCodegenParam>);
      const core = new KtCodegenTableCore(param, document.document_revision);
      core.setData({
        kind: KT_CODEGEN_TABLE_DATA_KIND,
        schemaVersion: KT_CODEGEN_TABLE_DATA_SCHEMA_VERSION,
        documentRevision: document.document_revision,
        selectedRow: typeof table.selectedRow === "number" ? table.selectedRow : null,
        items: table.items,
      });
      const normalizedTable = core.getData();
      active.value = {
        ...document,
        class_name: `${param.namePrefix}${param.nameMiddle}`,
        item_count: normalizedTable.items.length,
        param,
        table: normalizedTable,
      };
      dirty.value = true;
      resetPlan("正在恢复 Codegen 会话草稿…");
      recoveryConflict.value = null;
      status.value = `已安全恢复 ${document.file_name} 的未保存草稿`;
      return true;
    } catch {
      return false;
    }
  }

  function rememberRecoveryConflict(conflict: KtCodegenRecoveryConflict): void {
    recoveryConflict.value = conflict;
    status.value = "磁盘文件已变化，旧草稿未自动载入；可复制草稿后手动合并";
  }

  function clearRecoveryConflict(): void {
    recoveryConflict.value = null;
    externalCheckRequest += 1;
    externalCheckAbort?.abort();
    externalCheckAbort = null;
    externalCheckInFlight = null;
  }

  function checkExternalChange(): Promise<KtCodegenFileStatePayload | null> {
    const document = active.value;
    if (!document || recoveryConflict.value || saving.value || opening.value) return Promise.resolve(null);
    if (externalChange.value?.path === document.path) {
      return Promise.resolve(externalChange.value);
    }
    if (externalCheckInFlight?.path === document.path) return externalCheckInFlight.promise;
    externalCheckAbort?.abort();
    const abort = new AbortController();
    externalCheckAbort = abort;
    const timeout = setTimeout(() => abort.abort(), STATE_REQUEST_TIMEOUT_MS);
    const request = ++externalCheckRequest;
    let pending!: Promise<KtCodegenFileStatePayload | null>;
    pending = (async () => {
      try {
        const state = await fetchKtCodegenDocumentState({
          path: document.path,
          expected_file_signature: observedFileSignature.value || document.file_signature,
          expected_fingerprint: document.fingerprint,
        }, { signal: abort.signal });
        if (request !== externalCheckRequest || active.value?.path !== document.path) return null;
        if (state.changed) {
          if (state.exists && !dirty.value) {
            if (opening.value) return null;
            const reloaded = await open(document.path);
            if (active.value?.path !== reloaded.path
              || active.value.fingerprint !== reloaded.fingerprint) return null;
            status.value = `已自动加载 ${document.file_name} 的外部修改`;
            return state;
          }
          externalChange.value = state;
          status.value = state.exists
            ? "磁盘上的 Codegen 配置已在外部修改；当前草稿仍保留，保存时会进行指纹保护"
            : "磁盘上的 Codegen 配置已被删除；当前草稿仍保留";
        } else if (state.file_signature) {
          observedFileSignature.value = state.file_signature;
        }
        return state;
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
        if (externalCheckAbort === abort) externalCheckAbort = null;
        if (externalCheckInFlight?.promise === pending) externalCheckInFlight = null;
      }
    })();
    externalCheckInFlight = { path: document.path, promise: pending };
    return pending;
  }

  function selectArtifact(id: string): void {
    selectedArtifactId.value = id;
    const artifact = preflight.value?.plan.artifacts.find((item) => item.id === id);
    if (artifact) void previewRegion(artifact.regionId);
  }

  async function previewRegion(regionId: string): Promise<KtCodegenSourcePreviewPayload | null> {
    const region = preflight.value?.plan.markerRegions.find((item) => item.id === regionId);
    if (!region) return null;
    selectedRegionId.value = regionId;
    selectedArtifactId.value = preflight.value?.plan.artifacts
      .find((artifact) => artifact.regionId === regionId)?.id ?? "";
    const request = ++sourcePreviewRequest;
    sourceStateRequest += 1;
    sourcePreviewAbort?.abort();
    const abort = new AbortController();
    sourcePreviewAbort = abort;
    const timeout = setTimeout(() => abort.abort(), STATE_REQUEST_TIMEOUT_MS);
    sourceStateCheckAbort?.abort();
    sourceStateCheckAbort = null;
    sourceStateCheckInFlight = null;
    sourcePreview.value = null;
    sourcePreviewKind.value = "region";
    sourcePreviewLoading.value = true;
    sourcePreviewError.value = "";
    try {
      const preview = await fetchKtCodegenSourcePreview({
        path: region.path,
        start_line: region.start.line,
        end_line: region.end.line,
        expected_fingerprint: region.sourceFingerprint,
        context_lines: 5,
      }, { signal: abort.signal });
      if (request !== sourcePreviewRequest) return null;
      sourcePreview.value = preview;
      if (preview.stale) {
        resetPlan("源码在预检后已变化，请重新预检");
      }
      return preview;
    } catch (error) {
      if (request !== sourcePreviewRequest) return null;
      sourcePreview.value = null;
      sourcePreviewError.value = isAbortError(error) ? "源码预览已取消或超时" : String(error);
      return null;
    } finally {
      clearTimeout(timeout);
      if (sourcePreviewAbort === abort) sourcePreviewAbort = null;
      if (request === sourcePreviewRequest) sourcePreviewLoading.value = false;
    }
  }

  async function previewCandidate(
    candidate: KtCodegenSourceCandidateSummary,
  ): Promise<KtCodegenSourcePreviewPayload | null> {
    if (!preflight.value?.source_candidates.some((item) =>
      item.path === candidate.path && item.fingerprint === candidate.fingerprint)) return null;
    selectedRegionId.value = "";
    selectedArtifactId.value = "";
    const request = ++sourcePreviewRequest;
    sourceStateRequest += 1;
    sourcePreviewAbort?.abort();
    const abort = new AbortController();
    sourcePreviewAbort = abort;
    const timeout = setTimeout(() => abort.abort(), STATE_REQUEST_TIMEOUT_MS);
    sourceStateCheckAbort?.abort();
    sourceStateCheckAbort = null;
    sourceStateCheckInFlight = null;
    sourcePreview.value = null;
    sourcePreviewKind.value = "candidate";
    sourcePreviewLoading.value = true;
    sourcePreviewError.value = "";
    try {
      const preview = await fetchKtCodegenSourcePreview({
        path: candidate.path,
        start_line: candidate.marker_line,
        end_line: candidate.marker_line,
        expected_fingerprint: candidate.fingerprint,
        context_lines: 5,
      }, { signal: abort.signal });
      if (request !== sourcePreviewRequest) return null;
      sourcePreview.value = preview;
      if (preview.stale) resetPlan("候选源码在扫描后已变化，请重新预检");
      return preview;
    } catch (error) {
      if (request !== sourcePreviewRequest) return null;
      sourcePreview.value = null;
      sourcePreviewError.value = isAbortError(error) ? "源码预览已取消或超时" : String(error);
      return null;
    } finally {
      clearTimeout(timeout);
      if (sourcePreviewAbort === abort) sourcePreviewAbort = null;
      if (request === sourcePreviewRequest) sourcePreviewLoading.value = false;
    }
  }

  async function previewDiagnostic(
    diagnostic: KtCodegenDiagnostic,
  ): Promise<KtCodegenSourcePreviewPayload | null> {
    const result = preflight.value;
    if (!result?.plan.diagnostics.includes(diagnostic)) return null;
    const location = diagnostic.path;
    const rel = location?.source === "source" ? location.file?.replace(/\\/g, "/") : "";
    const row = location?.row;
    if (!rel || !Number.isSafeInteger(row) || (row as number) < 0) return null;
    const expectedFingerprint = result.source_file_fingerprints[rel];
    if (!expectedFingerprint) return null;
    selectedRegionId.value = "";
    selectedArtifactId.value = "";
    const request = ++sourcePreviewRequest;
    sourceStateRequest += 1;
    sourcePreviewAbort?.abort();
    const abort = new AbortController();
    sourcePreviewAbort = abort;
    const timeout = setTimeout(() => abort.abort(), STATE_REQUEST_TIMEOUT_MS);
    sourceStateCheckAbort?.abort();
    sourceStateCheckAbort = null;
    sourceStateCheckInFlight = null;
    sourcePreview.value = null;
    sourcePreviewKind.value = "diagnostic";
    sourcePreviewLoading.value = true;
    sourcePreviewError.value = "";
    try {
      const preview = await fetchKtCodegenSourcePreview({
        path: rel,
        start_line: row as number,
        end_line: row as number,
        expected_fingerprint: expectedFingerprint,
        context_lines: 5,
      }, { signal: abort.signal });
      if (request !== sourcePreviewRequest) return null;
      sourcePreview.value = preview;
      if (preview.stale) resetPlan("诊断源码在预检后已变化，请重新预检");
      return preview;
    } catch (error) {
      if (request !== sourcePreviewRequest) return null;
      sourcePreview.value = null;
      sourcePreviewError.value = isAbortError(error) ? "诊断源码预览已取消或超时" : String(error);
      return null;
    } finally {
      clearTimeout(timeout);
      if (sourcePreviewAbort === abort) sourcePreviewAbort = null;
      if (request === sourcePreviewRequest) sourcePreviewLoading.value = false;
    }
  }

  function checkPreflightSourceChanges(): Promise<number | null> {
    const result = preflight.value;
    if (!result || preflighting.value) return Promise.resolve(null);
    if (sourceStateCheckInFlight?.plan === result) return sourceStateCheckInFlight.promise;
    const filesByPath = new Map<string, {
      path: string;
      expected_file_signature: string;
      expected_fingerprint: string;
    }>();
    for (const region of result.plan.markerRegions) {
      if (filesByPath.has(region.path)) continue;
      filesByPath.set(region.path, {
        path: region.path,
        expected_file_signature: result.source_file_signatures[region.path] ?? "",
        expected_fingerprint: region.sourceFingerprint,
      });
    }
    if (!filesByPath.size) return Promise.resolve(0);
    sourceStateCheckAbort?.abort();
    const abort = new AbortController();
    sourceStateCheckAbort = abort;
    const timeout = setTimeout(() => abort.abort(), STATE_REQUEST_TIMEOUT_MS);
    const request = ++sourceStateRequest;
    let pending!: Promise<number | null>;
    pending = (async () => {
      try {
        const states = await fetchKtCodegenSourceStates(
          [...filesByPath.values()],
          { signal: abort.signal },
        );
        if (request !== sourceStateRequest || preflight.value !== result) return null;
        if (states.changed_count) {
          const changed = states.files.find((state) => state.changed);
          resetPlan(changed?.exists === false
            ? "预检命中的源码已被删除，原计划已失效"
            : "源码已在外部变化，原预检计划已失效");
        } else {
          for (const state of states.files) {
            if (state.file_signature) result.source_file_signatures[state.path] = state.file_signature;
          }
        }
        return states.changed_count;
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
        if (sourceStateCheckAbort === abort) sourceStateCheckAbort = null;
        if (sourceStateCheckInFlight?.promise === pending) sourceStateCheckInFlight = null;
      }
    })();
    sourceStateCheckInFlight = { plan: result, promise: pending };
    return pending;
  }

  function reset(): void {
    discoveryAbort?.abort();
    discoveryAbort = null;
    preflightAbort?.abort();
    preflightAbort = null;
    externalCheckAbort?.abort();
    externalCheckAbort = null;
    sourceStateCheckAbort?.abort();
    sourceStateCheckAbort = null;
    sourcePreviewAbort?.abort();
    sourcePreviewAbort = null;
    externalCheckInFlight = null;
    sourceStateCheckInFlight = null;
    openRequest += 1;
    saveRequest += 1;
    applyRequest += 1;
    externalCheckRequest += 1;
    discoveryGeneration += 1;
    discoveryRefreshPending = false;
    discoveryRequest = null;
    documents.value = [];
    active.value = null;
    preflight.value = null;
    selectedArtifactId.value = "";
    selectedRegionId.value = "";
    sourcePreview.value = null;
    sourcePreviewKind.value = null;
    sourcePreviewLoading.value = false;
    sourcePreviewError.value = "";
    sourcePreviewRequest += 1;
    sourceStateRequest += 1;
    preflightRequest += 1;
    preflighting.value = false;
    loadingDocuments.value = false;
    opening.value = false;
    saving.value = false;
    applying.value = false;
    dirty.value = false;
    recoveryConflict.value = null;
    externalChange.value = null;
    lastApply.value = null;
    runtimeProblems.value = [];
    observedFileSignature.value = "";
    status.value = "请选择左侧 Codegen 配置文档";
    discoveryMeta.value = {
      scanned: 0,
      truncated: false,
      cacheHits: 0,
      filesRead: 0,
      snapshotBytes: 0,
      byteLimitReached: false,
    };
  }

  return {
    documents,
    active,
    selectedBlockKeys,
    preflight,
    selectedArtifactId,
    selectedRegionId,
    selectedArtifact,
    sourcePreview,
    sourcePreviewKind,
    sourcePreviewLoading,
    sourcePreviewError,
    loadingDocuments,
    opening,
    saving,
    applying,
    preflighting,
    dirty,
    status,
    discoveryMeta,
    recoveryConflict,
    externalChange,
    lastApply,
    runtimeProblems,
    problems,
    problemTone,
    discover,
    cancelDiscovery,
    open,
    revert,
    markDirty,
    save,
    apply,
    runPreflight,
    cancelPreflight,
    setSelectedBlocks,
    restoreDraft,
    rememberRecoveryConflict,
    clearRecoveryConflict,
    checkExternalChange,
    selectArtifact,
    previewRegion,
    previewCandidate,
    previewDiagnostic,
    checkPreflightSourceChanges,
    clearRuntimeProblems,
    reportRuntimeProblem,
    reset,
  };
  });
}

type KtCodegenStoreDefinition = ReturnType<typeof defineKtCodegenStore>;

const storeDefinitions = new Map<string, KtCodegenStoreDefinition>();

/**
 * 每个 Workbench Tab 使用独立的 KT Codegen store。
 *
 * 默认 scope 仅供单元测试和无工作台宿主的兼容调用；正式页面始终传入 tab id，
 * 从而让不同 JSON View 的草稿、预检计划、Apply 状态与恢复冲突互不覆盖。
 */
export function useKtCodegenStore(scopeId = "default") {
  const key = scopeId.trim() || "default";
  let definition = storeDefinitions.get(key);
  if (!definition) {
    definition = defineKtCodegenStore(key);
    storeDefinitions.set(key, definition);
  }
  return definition();
}
