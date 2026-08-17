import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  KT_CODEGEN_TABLE_DATA_KIND,
  KT_CODEGEN_TABLE_DATA_SCHEMA_VERSION,
  KtCodegenParam,
  ktCodegenBlockKeysForPreset,
  type KtCodegenMarkerRegion,
  type KtCodegenTableData,
} from "@phoenix-wing/kt-codegen";
import type {
  KtCodegenHostDocument,
  KtCodegenPreflightPayload,
} from "../api";

const api = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(message: string, readonly status: number, readonly payload: unknown) {
      super(message);
    }
  }
  return {
    ApiError,
    applyKtCodegenPlan: vi.fn(),
    fetchKtCodegenDocumentState: vi.fn(),
    fetchKtCodegenSourceStates: vi.fn(),
    fetchKtCodegenSourcePreview: vi.fn(),
    fetchKtCodegenDocuments: vi.fn(),
    openKtCodegenDocument: vi.fn(),
    runKtCodegenPreflight: vi.fn(),
    saveKtCodegenDocument: vi.fn(),
  };
});

vi.mock("../api", () => api);

import { useKtCodegenStore } from "./ktCodegen";

function makeTable(revision = 1): KtCodegenTableData {
  return {
    kind: KT_CODEGEN_TABLE_DATA_KIND,
    schemaVersion: KT_CODEGEN_TABLE_DATA_SCHEMA_VERSION,
    documentRevision: revision,
    selectedRow: null,
    items: [],
  };
}

function makeDocument(revision = 1): KtCodegenHostDocument {
  const param = new KtCodegenParam({ namePrefix: "Kt", nameMiddle: "Widget", items: [] });
  return {
    kind: "kt.codegen.host-document",
    schema_version: 1,
    path: "widget.codegen.json",
    file_name: "widget.codegen.json",
    format: "legacy-v4-json",
    class_name: "KtWidget",
    item_count: 0,
    diagnostic_count: 0,
    fingerprint: `sha256:${revision}`,
    file_signature: `signature:${revision}`,
    document_revision: revision,
    encoding: "utf8",
    param,
    table: makeTable(revision),
    diagnostics: [],
  };
}

function makePreflight(): KtCodegenPreflightPayload {
  return {
    plan_fingerprint: "sha256:plan",
    safe_to_apply: true,
    reused: false,
    created_at: "2026-07-16T00:00:00.000Z",
    indexed_file_count: 2,
    candidate_file_count: 1,
    source_scan_truncated: false,
    source_scan_byte_limit_reached: false,
    source_snapshot_bytes: 128,
    source_cache_hits: 0,
    source_files_read: 2,
    source_file_signatures: { "Widget.h": "signature:source" },
    source_file_fingerprints: { "Widget.h": "sha256:source" },
    source_candidates: [{
      path: "Widget.h",
      fingerprint: "sha256:source",
      encoding: "utf8",
      eol: "lf",
      marker_line: 0,
    }],
    source_candidates_truncated: false,
    plan: {
      kind: "kt.codegen.plan",
      schemaVersion: 1,
      phase: "preview",
      targets: [],
      blockKeys: ["PARAM DECLARATION"],
      artifacts: [{
        id: "artifact-1",
        regionId: "region-1",
        target: "cpp.parameter",
        blockKey: "PARAM DECLARATION",
        classId: "KtWidgetBase",
        content: "int value;",
        sourceParameters: ["value"],
      }],
      markerRegions: [{
        id: "region-1",
        path: "Widget.h",
        sourceFingerprint: "sha256:source",
        start: { line: 1 },
        end: { line: 3 },
      } as unknown as KtCodegenMarkerRegion],
      diagnostics: [],
      hasChanges: true,
      canApply: true,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("KT Codegen store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("isolates document and operation state by Workbench tab", () => {
    const first = useKtCodegenStore("tab-first");
    const second = useKtCodegenStore("tab-second");

    first.status = "first view";
    first.markDirty(3);

    expect(useKtCodegenStore("tab-first")).toBe(first);
    expect(second).not.toBe(first);
    expect(second.status).toBe("请选择左侧 Codegen 配置文档");
    expect(second.dirty).toBe(false);
  });

  it("coalesces concurrent discovery calls", async () => {
    const store = useKtCodegenStore();
    api.fetchKtCodegenDocuments.mockResolvedValue({
      workspace: "/workspace",
      documents: [],
      scanned_file_count: 7,
      truncated: false,
      cache_hit_count: 4,
      files_read: 3,
      config_snapshot_bytes: 1024,
      config_scan_byte_limit_reached: true,
    });

    const first = store.discover();
    const second = store.discover();
    await Promise.all([first, second]);

    expect(api.fetchKtCodegenDocuments).toHaveBeenCalledTimes(1);
    expect(store.discoveryMeta).toEqual({
      scanned: 7,
      truncated: false,
      cacheHits: 4,
      filesRead: 3,
      snapshotBytes: 1024,
      byteLimitReached: true,
    });
    expect(store.loadingDocuments).toBe(false);
  });

  it("cancels document discovery without surfacing an AbortError", async () => {
    const store = useKtCodegenStore();
    api.fetchKtCodegenDocuments.mockImplementation(({ signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true })),
    );

    const pending = store.discover();
    expect(store.loadingDocuments).toBe(true);
    store.cancelDiscovery();
    await expect(pending).resolves.toBeUndefined();

    expect(store.loadingDocuments).toBe(false);
    expect(store.status).toMatch(/已取消/);
  });

  it("does not let discovery from a previous workspace overwrite the reset store", async () => {
    const store = useKtCodegenStore();
    const previous = deferred<{
      workspace: string;
      documents: Array<ReturnType<typeof makeDocument>>;
      scanned_file_count: number;
      truncated: boolean;
      cache_hit_count: number;
      files_read: number;
    }>();
    const current = deferred<{
      workspace: string;
      documents: Array<ReturnType<typeof makeDocument>>;
      scanned_file_count: number;
      truncated: boolean;
      cache_hit_count: number;
      files_read: number;
    }>();
    api.fetchKtCodegenDocuments
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(current.promise);

    const oldRequest = store.discover();
    store.reset();
    const newRequest = store.discover();
    current.resolve({
      workspace: "/new",
      documents: [{ ...makeDocument(2), path: "new.codegen.json", file_name: "new.codegen.json" }],
      scanned_file_count: 1,
      truncated: false,
      cache_hit_count: 0,
      files_read: 1,
    });
    await newRequest;
    previous.resolve({
      workspace: "/old",
      documents: [{ ...makeDocument(1), path: "old.codegen.json", file_name: "old.codegen.json" }],
      scanned_file_count: 1,
      truncated: false,
      cache_hit_count: 0,
      files_read: 1,
    });
    await oldRequest;

    expect(store.documents.map((document) => document.path)).toEqual(["new.codegen.json"]);
    expect(store.loadingDocuments).toBe(false);
  });

  it("keeps the active document summary newer than an in-flight discovery snapshot", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument(1);
    const saved = { ...makeDocument(2), class_name: "KtSaved" };
    const discovery = deferred<{
      workspace: string;
      documents: Array<ReturnType<typeof makeDocument>>;
      scanned_file_count: number;
      truncated: boolean;
      cache_hit_count: number;
      files_read: number;
    }>();
    api.openKtCodegenDocument.mockResolvedValue(opened);
    api.saveKtCodegenDocument.mockResolvedValue(saved);
    api.fetchKtCodegenDocuments.mockReturnValue(discovery.promise);
    await store.open(opened.path);
    store.markDirty();

    const discovering = store.discover();
    await store.save(opened.table);
    discovery.resolve({
      workspace: "/workspace",
      documents: [{ ...opened, class_name: "KtOld" }],
      scanned_file_count: 1,
      truncated: false,
      cache_hit_count: 0,
      files_read: 1,
    });
    await discovering;

    expect(store.documents[0]?.class_name).toBe("KtSaved");
  });

  it("drops a preflight response after its block selection becomes stale", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument();
    const response = deferred<KtCodegenPreflightPayload>();
    api.openKtCodegenDocument.mockResolvedValue(opened);
    api.runKtCodegenPreflight.mockReturnValue(response.promise);
    await store.open(opened.path);

    const pending = store.runPreflight(opened.table);
    expect(store.preflighting).toBe(true);
    store.setSelectedBlocks(["PARAM DECLARATION"]);
    expect(store.preflighting).toBe(false);
    response.resolve(makePreflight());

    await expect(pending).resolves.toBeNull();
    expect(store.preflight).toBeNull();
    expect(store.selectedArtifactId).toBe("");
  });

  it("cancels an active preflight through AbortSignal", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument();
    api.openKtCodegenDocument.mockResolvedValue(opened);
    api.runKtCodegenPreflight.mockImplementation((_body: unknown, { signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true })),
    );
    await store.open(opened.path);

    const pending = store.runPreflight(opened.table);
    expect(store.preflighting).toBe(true);
    store.cancelPreflight();
    await expect(pending).resolves.toBeNull();

    expect(store.preflighting).toBe(false);
    expect(store.status).toMatch(/已取消/);
  });

  it("serializes foreground preflight with coalesced background discovery", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument();
    const preflightResponse = deferred<KtCodegenPreflightPayload>();
    let discoverySignal: AbortSignal | undefined;
    api.openKtCodegenDocument.mockResolvedValue(opened);
    api.fetchKtCodegenDocuments
      .mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
        discoverySignal = signal;
        return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true }));
      })
      .mockResolvedValueOnce({
        workspace: "/workspace",
        documents: [opened],
        scanned_file_count: 1,
        truncated: false,
        cache_hit_count: 1,
        files_read: 0,
      });
    api.runKtCodegenPreflight.mockReturnValue(preflightResponse.promise);
    api.fetchKtCodegenSourcePreview.mockResolvedValue({
      path: "Widget.h",
      fingerprint: "sha256:source",
      file_signature: "signature:source",
      expected_fingerprint: "sha256:source",
      stale: false,
      encoding: "utf8",
      eol: "lf",
      focus_start_line: 1,
      focus_end_line: 3,
      from_line: 0,
      to_line: 4,
      lines: [],
    });
    await store.open(opened.path);

    const discovery = store.discover();
    const foreground = store.runPreflight(opened.table);
    await expect(discovery).resolves.toBeUndefined();
    expect(discoverySignal?.aborted).toBe(true);

    await Promise.all([store.discover(), store.discover()]);
    expect(api.fetchKtCodegenDocuments).toHaveBeenCalledTimes(1);
    preflightResponse.resolve(makePreflight());
    await foreground;

    await vi.waitFor(() => expect(api.fetchKtCodegenDocuments).toHaveBeenCalledTimes(2));
    expect(store.preflighting).toBe(false);
  });

  it("flushes one queued discovery when a block change invalidates preflight", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument();
    api.openKtCodegenDocument.mockResolvedValue(opened);
    api.runKtCodegenPreflight.mockImplementation((_body: unknown, { signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true })),
    );
    api.fetchKtCodegenDocuments.mockResolvedValue({
      workspace: "/workspace",
      documents: [opened],
      scanned_file_count: 1,
      truncated: false,
      cache_hit_count: 1,
      files_read: 0,
      config_snapshot_bytes: 0,
      config_scan_byte_limit_reached: false,
    });
    await store.open(opened.path);

    const foreground = store.runPreflight(opened.table);
    await store.discover();
    store.setSelectedBlocks(["PARAM DECLARATION"]);
    await expect(foreground).resolves.toBeNull();
    await vi.waitFor(() => expect(api.fetchKtCodegenDocuments).toHaveBeenCalledTimes(1));

    const secondForeground = store.runPreflight(opened.table);
    store.cancelPreflight();
    await expect(secondForeground).resolves.toBeNull();
    expect(api.fetchKtCodegenDocuments).toHaveBeenCalledTimes(1);
  });

  it("does not let an older document open replace a newer one", async () => {
    const store = useKtCodegenStore();
    const firstResponse = deferred<KtCodegenHostDocument>();
    const secondResponse = deferred<KtCodegenHostDocument>();
    api.openKtCodegenDocument
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);

    const first = store.open("first.codegen.json");
    const second = store.open("second.codegen.json");
    secondResponse.resolve({ ...makeDocument(2), path: "second.codegen.json", file_name: "second.codegen.json" });
    await second;
    firstResponse.resolve({ ...makeDocument(1), path: "first.codegen.json", file_name: "first.codegen.json" });
    await first;

    expect(store.active?.path).toBe("second.codegen.json");
    expect(store.opening).toBe(false);
  });

  it("blocks save and preflight while a document switch is in flight", async () => {
    const store = useKtCodegenStore();
    const current = makeDocument(1);
    const switching = deferred<KtCodegenHostDocument>();
    api.openKtCodegenDocument
      .mockResolvedValueOnce(current)
      .mockReturnValueOnce(switching.promise);
    await store.open(current.path);

    const pending = store.open("next.codegen.json");
    expect(store.opening).toBe(true);
    await expect(store.save(current.table)).rejects.toThrow(/正在切换/);
    await expect(store.runPreflight(current.table)).rejects.toThrow(/正在切换/);
    expect(api.saveKtCodegenDocument).not.toHaveBeenCalled();
    expect(api.runKtCodegenPreflight).not.toHaveBeenCalled();

    switching.resolve({ ...makeDocument(2), path: "next.codegen.json", file_name: "next.codegen.json" });
    await pending;
  });

  it("requires explicit discard authority before reopening a dirty document", async () => {
    const store = useKtCodegenStore();
    const document = makeDocument();
    api.openKtCodegenDocument.mockResolvedValue(document);
    await store.open(document.path);
    store.markDirty();

    await expect(store.open(document.path)).rejects.toThrow(/明确放弃/);
    expect(api.openKtCodegenDocument).toHaveBeenCalledTimes(1);
    await expect(store.open(document.path, { discardDraft: true })).resolves.toEqual(document);
    expect(store.dirty).toBe(false);
  });

  it("keeps the active Block summary in sync with metadata and draft row count", async () => {
    const store = useKtCodegenStore();
    const document = makeDocument();
    api.openKtCodegenDocument.mockResolvedValue(document);
    await store.open(document.path);
    store.active!.param.nameMiddle = "Draft";

    store.markDirty(7);

    expect(store.active).toMatchObject({ class_name: "KtDraft", item_count: 7 });
    expect(store.documents[0]).toMatchObject({ class_name: "KtDraft", item_count: 7 });
  });

  it("detects an external document change without discarding the active draft", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument(1);
    api.openKtCodegenDocument.mockResolvedValue(opened);
    api.fetchKtCodegenDocumentState.mockResolvedValue({
      path: opened.path,
      exists: true,
      file_signature: "signature:external",
      fingerprint: "sha256:external",
      changed: true,
    });
    await store.open(opened.path);
    store.markDirty();

    await store.checkExternalChange();

    expect(store.active?.fingerprint).toBe(opened.fingerprint);
    expect(store.dirty).toBe(true);
    expect(store.externalChange?.fingerprint).toBe("sha256:external");
    expect(store.status).toMatch(/外部修改/);
  });

  it("keeps a deleted open session visible after background discovery", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument(1);
    api.openKtCodegenDocument.mockResolvedValue(opened);
    api.fetchKtCodegenDocumentState.mockResolvedValue({
      path: opened.path,
      exists: false,
      file_signature: "",
      fingerprint: "",
      changed: true,
    });
    api.fetchKtCodegenDocuments.mockResolvedValue({
      workspace: "/workspace",
      documents: [],
      scanned_file_count: 0,
      truncated: false,
      cache_hit_count: 0,
      files_read: 0,
      config_snapshot_bytes: 0,
      config_scan_byte_limit_reached: false,
    });
    await store.open(opened.path);
    await store.checkExternalChange();
    expect(store.status).toMatch(/已被删除/);

    await store.discover();

    expect(store.documents.map((document) => document.path)).toEqual([opened.path]);
    expect(store.status).toMatch(/已被删除/);
  });

  it("coalesces overlapping external-change heartbeats for one document", async () => {
    const store = useKtCodegenStore();
    const document = makeDocument();
    const response = deferred<{
      path: string;
      exists: boolean;
      file_signature: string;
      fingerprint: string;
      changed: boolean;
    }>();
    api.openKtCodegenDocument.mockResolvedValue(document);
    api.fetchKtCodegenDocumentState.mockReturnValue(response.promise);
    await store.open(document.path);

    const first = store.checkExternalChange();
    const second = store.checkExternalChange();
    expect(api.fetchKtCodegenDocumentState).toHaveBeenCalledTimes(1);
    response.resolve({
      path: document.path,
      exists: true,
      file_signature: document.file_signature,
      fingerprint: document.fingerprint,
      changed: false,
    });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("aborts a hung external-change heartbeat after the request deadline", async () => {
    vi.useFakeTimers();
    const store = useKtCodegenStore();
    const document = makeDocument();
    let observedSignal: AbortSignal | undefined;
    api.openKtCodegenDocument.mockResolvedValue(document);
    api.fetchKtCodegenDocumentState.mockImplementation((_body: unknown, options: { signal: AbortSignal }) => {
      observedSignal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true }));
    });
    await store.open(document.path);

    const pending = store.checkExternalChange();
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(pending).resolves.toBeNull();
    expect(observedSignal?.aborted).toBe(true);
  });

  it("automatically reloads an external document change when the view is clean", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument(1);
    const external = { ...makeDocument(2), class_name: "KtExternal" };
    api.openKtCodegenDocument
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce(external);
    api.fetchKtCodegenDocumentState.mockResolvedValue({
      path: opened.path,
      exists: true,
      file_signature: external.file_signature,
      fingerprint: external.fingerprint,
      changed: true,
    });
    await store.open(opened.path);

    await store.checkExternalChange();

    expect(store.active?.fingerprint).toBe(external.fingerprint);
    expect(store.externalChange).toBeNull();
    expect(store.dirty).toBe(false);
    expect(store.status).toMatch(/自动加载/);
  });

  it("does not let an old external heartbeat steal a user document switch", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument(1);
    const next = { ...makeDocument(2), path: "next.codegen.json", file_name: "next.codegen.json" };
    const state = deferred<{
      path: string;
      exists: boolean;
      file_signature: string;
      fingerprint: string;
      changed: boolean;
    }>();
    const nextOpen = deferred<KtCodegenHostDocument>();
    api.openKtCodegenDocument
      .mockResolvedValueOnce(opened)
      .mockReturnValueOnce(nextOpen.promise);
    api.fetchKtCodegenDocumentState.mockReturnValue(state.promise);
    await store.open(opened.path);

    const heartbeat = store.checkExternalChange();
    const switching = store.open(next.path);
    state.resolve({
      path: opened.path,
      exists: true,
      file_signature: "signature:external",
      fingerprint: "sha256:external",
      changed: true,
    });
    await expect(heartbeat).resolves.toBeNull();
    expect(api.openKtCodegenDocument).toHaveBeenCalledTimes(2);

    nextOpen.resolve(next);
    await switching;
    expect(store.active?.path).toBe(next.path);
  });

  it("remembers a metadata-only signature change without rebinding the dirty document", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument(1);
    api.openKtCodegenDocument.mockResolvedValue(opened);
    api.fetchKtCodegenDocumentState.mockResolvedValue({
      path: opened.path,
      exists: true,
      file_signature: "signature:touched",
      fingerprint: opened.fingerprint,
      changed: false,
    });
    await store.open(opened.path);
    store.active!.param.nameMiddle = "Unsaved";
    store.markDirty();

    await store.checkExternalChange();
    await store.checkExternalChange();

    expect(store.active?.param.nameMiddle).toBe("Unsaved");
    expect(store.dirty).toBe(true);
    expect(store.externalChange).toBeNull();
    expect(api.fetchKtCodegenDocumentState).toHaveBeenLastCalledWith(expect.objectContaining({
      expected_file_signature: "signature:touched",
    }), expect.objectContaining({ signal: expect.anything() }));
  });

  it("starts from Wing's all preset and invalidates preflight after a block change", async () => {
    const store = useKtCodegenStore();
    const document = makeDocument();
    api.openKtCodegenDocument.mockResolvedValue(document);
    api.runKtCodegenPreflight.mockResolvedValue(makePreflight());
    api.fetchKtCodegenSourcePreview.mockResolvedValue({
      path: "Widget.h",
      fingerprint: "sha256:source",
      file_signature: "signature:source",
      expected_fingerprint: "sha256:source",
      stale: false,
      encoding: "utf8",
      eol: "lf",
      focus_start_line: 1,
      focus_end_line: 3,
      from_line: 0,
      to_line: 4,
      lines: [],
    });

    expect(store.selectedBlockKeys).toEqual(ktCodegenBlockKeysForPreset("all"));
    await store.open(document.path);
    await store.runPreflight(document.table);
    await store.previewRegion("region-1");
    expect(store.preflight?.plan.artifacts).toHaveLength(1);
    expect(store.selectedArtifactId).toBe("artifact-1");
    expect(store.sourcePreview?.path).toBe("Widget.h");
    expect(api.fetchKtCodegenSourcePreview).toHaveBeenCalledWith(expect.objectContaining({
      path: "Widget.h",
      expected_fingerprint: "sha256:source",
    }), expect.objectContaining({ signal: expect.anything() }));

    await store.previewCandidate(makePreflight().source_candidates[0]!);
    expect(api.fetchKtCodegenSourcePreview).toHaveBeenLastCalledWith(expect.objectContaining({
      path: "Widget.h",
      start_line: 0,
      end_line: 0,
      expected_fingerprint: "sha256:source",
    }), expect.objectContaining({ signal: expect.anything() }));
    expect(store.selectedArtifact).toBeNull();
    await expect(store.previewCandidate({
      ...makePreflight().source_candidates[0]!,
      fingerprint: "sha256:stale-candidate",
    })).resolves.toBeNull();

    store.setSelectedBlocks(["PARAM DECLARATION", "not-a-block"]);
    expect(store.selectedBlockKeys).toEqual(["PARAM DECLARATION"]);
    expect(store.preflight).toBeNull();
    expect(store.selectedArtifactId).toBe("");
  });

  it("keeps an existing plan when the normalized Block selection is unchanged", async () => {
    const store = useKtCodegenStore();
    const document = makeDocument();
    api.openKtCodegenDocument.mockResolvedValue(document);
    api.runKtCodegenPreflight.mockResolvedValue(makePreflight());
    api.fetchKtCodegenSourcePreview.mockResolvedValue({
      path: "Widget.h",
      fingerprint: "sha256:source",
      file_signature: "signature:source",
      expected_fingerprint: "sha256:source",
      stale: false,
      encoding: "utf8",
      eol: "lf",
      focus_start_line: 1,
      focus_end_line: 3,
      from_line: 0,
      to_line: 4,
      lines: [],
    });
    await store.open(document.path);
    store.setSelectedBlocks(["PARAM DECLARATION"]);
    await store.runPreflight(document.table);

    store.setSelectedBlocks(["PARAM DECLARATION", "PARAM DECLARATION"]);

    expect(store.preflight?.plan.artifacts).toHaveLength(1);
  });

  it("opens a source diagnostic at its Wing row with warning focus metadata", async () => {
    const store = useKtCodegenStore();
    const document = makeDocument();
    const preflight = makePreflight();
    const diagnostic = {
      code: "marker.mismatch",
      severity: "warning" as const,
      message: "marker mismatch",
      path: { source: "source" as const, file: "Widget.h", row: 7, column: 2 },
    };
    preflight.plan = { ...preflight.plan, diagnostics: [diagnostic] };
    api.openKtCodegenDocument.mockResolvedValue(document);
    api.runKtCodegenPreflight.mockResolvedValue(preflight);
    api.fetchKtCodegenSourcePreview.mockResolvedValue({
      path: "Widget.h",
      fingerprint: "sha256:source",
      file_signature: "signature:source",
      expected_fingerprint: "sha256:source",
      stale: false,
      encoding: "utf8",
      eol: "lf",
      focus_start_line: 7,
      focus_end_line: 7,
      from_line: 2,
      to_line: 12,
      lines: [],
    });
    await store.open(document.path);
    await store.runPreflight(document.table);

    await store.previewDiagnostic(diagnostic);

    expect(store.sourcePreviewKind).toBe("diagnostic");
    expect(api.fetchKtCodegenSourcePreview).toHaveBeenLastCalledWith(expect.objectContaining({
      path: "Widget.h",
      start_line: 7,
      end_line: 7,
      expected_fingerprint: "sha256:source",
    }), expect.objectContaining({ signal: expect.anything() }));
  });

  it("opens an arbitrary report source path without requiring a current preflight", async () => {
    const store = useKtCodegenStore();
    api.fetchKtCodegenSourcePreview.mockResolvedValue({
      path: "Widget.cpp",
      fingerprint: "sha256:current",
      file_signature: "signature:current",
      expected_fingerprint: "",
      stale: false,
      encoding: "utf8",
      eol: "lf",
      focus_start_line: 41,
      focus_end_line: 41,
      from_line: 36,
      to_line: 46,
      lines: [],
    });

    await expect(store.previewPath("Widget.cpp", 41)).resolves.toMatchObject({
      path: "Widget.cpp",
      focus_start_line: 41,
    });

    expect(store.sourcePreviewKind).toBe("diagnostic");
    expect(api.fetchKtCodegenSourcePreview).toHaveBeenCalledWith({
      path: "Widget.cpp",
      start_line: 41,
      end_line: 41,
      expected_fingerprint: "",
      context_lines: 5,
    }, expect.objectContaining({ signal: expect.anything() }));
  });

  it("applies only the currently displayed safe plan and invalidates it after verified writeback", async () => {
    const store = useKtCodegenStore();
    const document = makeDocument();
    const preflight = makePreflight();
    api.openKtCodegenDocument.mockResolvedValue(document);
    api.runKtCodegenPreflight.mockResolvedValue(preflight);
    api.fetchKtCodegenSourcePreview.mockResolvedValue({
      path: "Widget.h",
      fingerprint: "sha256:source",
      file_signature: "signature:source",
      expected_fingerprint: "sha256:source",
      stale: false,
      encoding: "utf8",
      eol: "lf",
      focus_start_line: 1,
      focus_end_line: 3,
      from_line: 0,
      to_line: 4,
      lines: [],
    });
    api.applyKtCodegenPlan.mockResolvedValue({
      kind: "kt.codegen.apply-result",
      schema_version: 1,
      applied_at: "2026-07-17T00:00:00.000Z",
      plan_fingerprint: preflight.plan_fingerprint,
      region_count: 1,
      files: [{
        path: "Widget.h",
        encoding: "utf8",
        eol: "lf",
        region_count: 1,
        bytes_before: 100,
        bytes_after: 120,
        fingerprint_before: "sha256:source",
        fingerprint_after: "sha256:applied",
      }],
      diagnostics: [],
      verified: true,
    });
    await store.open(document.path);
    await store.runPreflight(document.table);

    const result = await store.apply(document.table);

    expect(api.applyKtCodegenPlan).toHaveBeenCalledWith(expect.objectContaining({
      expected_plan_fingerprint: preflight.plan_fingerprint,
      block_keys: store.selectedBlockKeys,
    }));
    expect(result?.verified).toBe(true);
    expect(store.lastApply?.files[0]?.path).toBe("Widget.h");
    expect(store.preflight).toBeNull();
    expect(store.applying).toBe(false);
    expect(store.status).toMatch(/复读验证通过/);
  });

  it("invalidates a preflight when the selected source changes externally", async () => {
    const store = useKtCodegenStore();
    const document = makeDocument();
    api.openKtCodegenDocument.mockResolvedValue(document);
    api.runKtCodegenPreflight.mockResolvedValue(makePreflight());
    api.fetchKtCodegenSourcePreview.mockResolvedValue({
      path: "Widget.h",
      fingerprint: "sha256:source",
      file_signature: "signature:source",
      expected_fingerprint: "sha256:source",
      stale: false,
      encoding: "utf8",
      eol: "lf",
      focus_start_line: 1,
      focus_end_line: 3,
      from_line: 0,
      to_line: 4,
      lines: [],
    });
    api.fetchKtCodegenSourceStates.mockResolvedValue({
      files: [{
        path: "Widget.h",
        exists: true,
        file_signature: "signature:external",
        fingerprint: "sha256:external",
        changed: true,
      }],
      changed_count: 1,
    });
    await store.open(document.path);
    await store.runPreflight(document.table);
    await store.previewRegion("region-1");

    await store.checkPreflightSourceChanges();

    expect(store.preflight).toBeNull();
    expect(store.sourcePreview).toBeNull();
    expect(store.status).toMatch(/原预检计划已失效/);
  });

  it("coalesces overlapping source-state heartbeats for one plan", async () => {
    const store = useKtCodegenStore();
    const document = makeDocument();
    const response = deferred<{
      files: Array<{
        path: string;
        exists: boolean;
        file_signature: string;
        fingerprint: string;
        changed: boolean;
      }>;
      changed_count: number;
    }>();
    api.openKtCodegenDocument.mockResolvedValue(document);
    api.runKtCodegenPreflight.mockResolvedValue(makePreflight());
    api.fetchKtCodegenSourcePreview.mockResolvedValue({
      path: "Widget.h",
      fingerprint: "sha256:source",
      file_signature: "signature:source",
      expected_fingerprint: "sha256:source",
      stale: false,
      encoding: "utf8",
      eol: "lf",
      focus_start_line: 1,
      focus_end_line: 3,
      from_line: 0,
      to_line: 4,
      lines: [],
    });
    api.fetchKtCodegenSourceStates.mockReturnValue(response.promise);
    await store.open(document.path);
    await store.runPreflight(document.table);

    const first = store.checkPreflightSourceChanges();
    const second = store.checkPreflightSourceChanges();
    expect(api.fetchKtCodegenSourceStates).toHaveBeenCalledTimes(1);
    response.resolve({
      files: [{
        path: "Widget.h",
        exists: true,
        file_signature: "signature:source",
        fingerprint: "sha256:source",
        changed: false,
      }],
      changed_count: 0,
    });
    await expect(Promise.all([first, second])).resolves.toEqual([0, 0]);
  });

  it("cancels an old Plan heartbeat and suppresses new ones during foreground preflight", async () => {
    const store = useKtCodegenStore();
    const document = makeDocument();
    const refresh = deferred<KtCodegenPreflightPayload>();
    api.openKtCodegenDocument.mockResolvedValue(document);
    api.runKtCodegenPreflight
      .mockResolvedValueOnce(makePreflight())
      .mockReturnValueOnce(refresh.promise);
    const oldHeartbeatResponse = deferred<{
      files: Array<{
        path: string;
        exists: boolean;
        file_signature: string;
        fingerprint: string;
        changed: boolean;
      }>;
      changed_count: number;
    }>();
    api.fetchKtCodegenSourceStates.mockReturnValue(oldHeartbeatResponse.promise);
    api.fetchKtCodegenSourcePreview.mockResolvedValue({
      path: "Widget.h",
      fingerprint: "sha256:source",
      file_signature: "signature:source",
      expected_fingerprint: "sha256:source",
      stale: false,
      encoding: "utf8",
      eol: "lf",
      focus_start_line: 1,
      focus_end_line: 3,
      from_line: 0,
      to_line: 4,
      lines: [],
    });
    await store.open(document.path);
    await store.runPreflight(document.table);

    const oldHeartbeat = store.checkPreflightSourceChanges();
    const foreground = store.runPreflight(document.table);
    await expect(store.checkPreflightSourceChanges()).resolves.toBeNull();
    expect(api.fetchKtCodegenSourceStates).toHaveBeenCalledTimes(1);
    oldHeartbeatResponse.resolve({
      files: [{
        path: "Widget.h",
        exists: true,
        file_signature: "signature:external",
        fingerprint: "sha256:external",
        changed: true,
      }],
      changed_count: 1,
    });
    await expect(oldHeartbeat).resolves.toBeNull();
    expect(store.preflighting).toBe(true);

    refresh.resolve(makePreflight());
    await foreground;
  });

  it("saves with the current fingerprint and clears dirty state", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument(1);
    const saved = makeDocument(2);
    api.openKtCodegenDocument.mockResolvedValue(opened);
    api.saveKtCodegenDocument.mockResolvedValue(saved);

    await store.open(opened.path);
    store.markDirty();
    await store.save(opened.table);

    expect(api.saveKtCodegenDocument).toHaveBeenCalledWith(expect.objectContaining({
      path: opened.path,
      fingerprint: opened.fingerprint,
      table: opened.table,
    }));
    expect(store.active?.fingerprint).toBe(saved.fingerprint);
    expect(store.dirty).toBe(false);
  });

  it("blocks document switching during save and drops a response after workspace reset", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument(1);
    const saved = makeDocument(2);
    const response = deferred<KtCodegenHostDocument>();
    api.openKtCodegenDocument.mockResolvedValue(opened);
    api.saveKtCodegenDocument.mockReturnValue(response.promise);
    await store.open(opened.path);

    const pending = store.save(opened.table);
    expect(store.saving).toBe(true);
    await expect(store.open("other.codegen.json")).rejects.toThrow(/正在保存/);
    store.reset();
    response.resolve(saved);

    await expect(pending).resolves.toBeNull();
    expect(store.active).toBeNull();
    expect(store.saving).toBe(false);
  });

  it("reloads the disk version while preserving a stale-save draft for recovery", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument(1);
    const disk = { ...makeDocument(2), class_name: "KtExternal" };
    api.openKtCodegenDocument
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce(disk);
    api.saveKtCodegenDocument.mockRejectedValue(new api.ApiError(
      "磁盘上的 Codegen 配置已变化",
      409,
      { detail: "磁盘上的 Codegen 配置已变化" },
    ));
    await store.open(opened.path);
    store.active!.param.nameMiddle = "LocalDraft";
    store.markDirty();

    await expect(store.save(opened.table)).resolves.toBeNull();

    expect(store.active?.fingerprint).toBe(disk.fingerprint);
    expect(store.active?.class_name).toBe("KtExternal");
    expect(store.documents[0]?.class_name).toBe("KtExternal");
    expect(store.dirty).toBe(false);
    expect((store.recoveryConflict?.param as { nameMiddle?: string }).nameMiddle).toBe("LocalDraft");
    expect(store.recoveryConflict?.diskFingerprint).toBe(disk.fingerprint);
    await expect(store.save(disk.table)).rejects.toThrow(/先复制或放弃/);
    expect(api.saveKtCodegenDocument).toHaveBeenCalledTimes(1);
  });

  it("restores a validated Wing table draft and keeps fingerprint conflicts recoverable", async () => {
    const store = useKtCodegenStore();
    const opened = makeDocument(1);
    api.openKtCodegenDocument.mockResolvedValue(opened);
    await store.open(opened.path);

    const draftParam = new KtCodegenParam({ namePrefix: "Kt", nameMiddle: "Recovered" });
    expect(store.restoreDraft(draftParam, makeTable(99))).toBe(true);
    expect(store.active?.class_name).toBe("KtRecovered");
    expect(store.active?.table.documentRevision).toBe(opened.document_revision);
    expect(store.dirty).toBe(true);

    store.rememberRecoveryConflict({
      path: opened.path,
      snapshotFingerprint: "sha256:old",
      diskFingerprint: opened.fingerprint,
      param: draftParam,
      table: opened.table,
    });
    expect(store.recoveryConflict?.snapshotFingerprint).toBe("sha256:old");
    expect(store.status).toMatch(/未自动载入/);
    store.clearRecoveryConflict();
    expect(store.recoveryConflict).toBeNull();
  });
});
