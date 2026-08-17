import {
  ktCodegenExpectedEndFromDiagnostic,
  type KtCodegenControlUiModel,
  type KtCodegenPreflightUiState,
  type KtCodegenPrimaryUiModel,
} from "@phoenix-wing/kt-codegen/ui";
import type { KtCodegenBlockKey } from "@phoenix-wing/kt-codegen";
import { KT_CODEGEN_BLOCK_PRESENTATIONS } from "@phoenix-wing/kt-codegen";
import type {
  KtCodegenApplyPayload,
  KtCodegenDocumentSummary,
  KtCodegenFileStatePayload,
  KtCodegenHostDocument,
  KtCodegenPreflightPayload,
} from "../api";
import type { KtCodegenBatchReport } from "./ktCodegenBatchReport";

export function buildKtCodegenControlUiModel(input: {
  readonly documentId: string;
  readonly fileName: string;
  readonly selectedBlockKeys: readonly KtCodegenBlockKey[];
  readonly preflight: KtCodegenPreflightPayload | null;
  readonly state: KtCodegenPreflightUiState | null;
  readonly message: string;
  readonly lastApply?: KtCodegenApplyPayload | null;
}): KtCodegenControlUiModel {
  const unclosed = input.preflight?.plan.diagnostics
    .map(ktCodegenExpectedEndFromDiagnostic)
    .filter((item) => item !== undefined) ?? [];
  const selected = new Set(input.selectedBlockKeys);
  const blocks = KT_CODEGEN_BLOCK_PRESENTATIONS.map(({ key }) => {
    const hitCount = input.preflight?.plan.markerRegions.filter((region) => region.blockKey === key).length ?? 0;
    const artifactCount = input.preflight?.plan.artifacts.filter((artifact) => artifact.blockKey === key).length ?? 0;
    const hasUnclosed = unclosed.some((item) => item.blockKey === key);
    return {
      key,
      status: !selected.has(key)
        ? "unselected" as const
        : !input.preflight
          ? "pending" as const
          : hasUnclosed
            ? "unclosed" as const
            : hitCount
              ? "hit" as const
              : "missing" as const,
      hitCount,
      artifactCount,
    };
  });
  return {
    kind: "kt.codegen.control-ui-model",
    schemaVersion: 1,
    documentId: input.documentId,
    fileName: input.fileName,
    selectedBlockKeys: input.selectedBlockKeys,
    blocks,
    unclosed,
    ...(input.preflight && input.state ? {
      preflight: {
        plan: input.preflight.plan,
        reused: input.preflight.reused,
        createdAt: input.preflight.created_at,
        state: input.state,
        message: input.message,
        ...(input.state === "applied" && input.lastApply?.region_outcomes ? {
          regionOutcomes: input.lastApply.region_outcomes.map((outcome) => ({
            regionId: outcome.region_id,
            change: outcome.change,
          })),
        } : {}),
      },
    } : {}),
  };
}

export function buildKtCodegenPrimaryUiModel(input: {
  readonly documents: readonly KtCodegenDocumentSummary[];
  readonly active: KtCodegenHostDocument | null;
  readonly dirty: boolean;
  readonly externalChange: KtCodegenFileStatePayload | null;
  readonly selectedBlockKeys: readonly KtCodegenBlockKey[];
  readonly preflight: KtCodegenPreflightPayload | null;
  readonly state: KtCodegenPreflightUiState | null;
  readonly message: string;
  readonly lastApply: KtCodegenApplyPayload | null;
  readonly batchReports?: readonly KtCodegenBatchReport[];
  readonly loadingDocuments: boolean;
  readonly applying: boolean;
  readonly opening: boolean;
  readonly saving: boolean;
  readonly batchApplying: boolean;
  readonly batchProgress?: { readonly current: number; readonly total: number; readonly fileName: string };
  readonly hostBlocked: boolean;
}): KtCodegenPrimaryUiModel {
  const controls = input.active ? buildKtCodegenControlUiModel({
    documentId: input.active.path,
    fileName: input.active.file_name,
    selectedBlockKeys: input.selectedBlockKeys,
    preflight: input.preflight,
    state: input.state,
    message: input.message,
    lastApply: input.lastApply,
  }) : undefined;
  return {
    kind: "kt.codegen.primary-ui-model",
    schemaVersion: 1,
    documents: input.documents.map((document) => {
      const active = input.active?.path === document.path;
      return {
        id: document.path,
        fileName: document.file_name,
        displayPath: document.path,
        itemCount: document.item_count,
        className: document.class_name,
        namePrefix: active ? input.active!.param.namePrefix : "",
        nameMiddle: active ? input.active!.param.nameMiddle : "",
        nameSpace: active ? input.active!.param.nameSpace : "",
        appendFunction: active ? input.active!.param.appendFunction : "",
        open: active,
        active,
        dirty: active && input.dirty,
        externalConflict: active && Boolean(input.externalChange),
        externalState: active && input.externalChange
          ? input.externalChange.exists ? "changed" : "deleted"
          : "current",
        diagnosticCount: document.diagnostic_count,
      };
    }),
    ...(input.active ? { activeId: input.active.path } : {}),
    ...(controls ? { controls } : {}),
    candidates: (input.preflight?.source_candidates ?? []).map((candidate) => ({
      id: candidate.path,
      displayPath: candidate.path,
      markerCount: 1,
      encoding: candidate.encoding,
      eol: candidate.eol,
    })),
    reports: [
      ...(input.batchReports ?? []).map((report) => report.summary),
      ...(input.lastApply && !(input.batchReports ?? []).some((report) => (
        Date.parse(input.lastApply!.applied_at) >= Date.parse(report.startedAt)
        && Date.parse(input.lastApply!.applied_at) <= Date.parse(report.completedAt)
      )) ? [{
        id: input.lastApply.plan_fingerprint,
        subject: input.active?.file_name ?? "Codegen Apply",
        startedAt: input.lastApply.applied_at,
        applyKind: "single" as const,
        itemCount: 1,
        health: input.lastApply.diagnostics.some((item) => item.severity === "error")
          ? "error" as const
          : input.lastApply.diagnostics.some((item) => item.severity === "warning") ? "warning" as const : "success" as const,
        change: input.lastApply.files.length ? "updated" as const : "unchanged" as const,
      }] : []),
    ],
    reportInvalidCount: 0,
    ...(input.batchApplying
      ? { operation: "batch-apply" as const, ...(input.batchProgress ? { batch: input.batchProgress } : {}) }
      : input.loadingDocuments ? { operation: "discovery" as const } : {}),
    running: input.batchApplying || input.applying || input.opening || input.saving,
    capabilities: {
      openJson: false,
      importCsv: false,
      applyAll: input.documents.length > 0 && !input.dirty && !input.externalChange && !input.hostBlocked,
      scanCandidates: Boolean(input.active) && !input.hostBlocked,
      openReportDirectory: false,
    },
  };
}
