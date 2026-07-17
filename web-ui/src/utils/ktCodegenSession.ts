import {
  KT_CODEGEN_TABLE_DATA_KIND,
  KT_CODEGEN_TABLE_DATA_SCHEMA_VERSION,
  ktCodegenIsBlockKey,
  type KtCodegenBlockKey,
  type KtCodegenParam,
  type KtCodegenTableData,
} from "@phoenix-wing/kt-codegen";
import type { KtCodegenHostDocument } from "../api";

export const KT_CODEGEN_SESSION_VERSION = 1;

export type KtCodegenSessionDraft = {
  param: KtCodegenParam;
  table: KtCodegenTableData;
};

export type KtCodegenSessionSnapshot = {
  v: typeof KT_CODEGEN_SESSION_VERSION;
  path: string;
  fingerprint: string;
  dirty: boolean;
  selectedBlockKeys: KtCodegenBlockKey[];
  draft?: KtCodegenSessionDraft;
};

export type KtCodegenDraftRestoreDecision = "clean" | "restore" | "conflict";

export type KtCodegenSessionRecoverySource = {
  path: string;
  snapshotFingerprint: string;
  param: unknown;
  table: KtCodegenTableData;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isTableData(value: unknown): value is KtCodegenTableData {
  if (!isRecord(value)) return false;
  return value.kind === KT_CODEGEN_TABLE_DATA_KIND
    && value.schemaVersion === KT_CODEGEN_TABLE_DATA_SCHEMA_VERSION
    && Array.isArray(value.items);
}

export function buildKtCodegenSessionSnapshot(options: {
  active: KtCodegenHostDocument | null;
  dirty: boolean;
  selectedBlockKeys: readonly KtCodegenBlockKey[];
  table: KtCodegenTableData | null;
  recoveryConflict?: KtCodegenSessionRecoverySource | null;
}): KtCodegenSessionSnapshot {
  const { active, dirty, selectedBlockKeys, table, recoveryConflict } = options;
  if (recoveryConflict) {
    return {
      v: KT_CODEGEN_SESSION_VERSION,
      path: recoveryConflict.path,
      fingerprint: recoveryConflict.snapshotFingerprint,
      dirty: true,
      selectedBlockKeys: [...selectedBlockKeys],
      draft: clonePlain({
        param: recoveryConflict.param as KtCodegenParam,
        table: recoveryConflict.table,
      }),
    };
  }
  const shouldKeepDraft = Boolean(active && dirty && table);
  return {
    v: KT_CODEGEN_SESSION_VERSION,
    path: active?.path ?? "",
    fingerprint: active?.fingerprint ?? "",
    dirty: shouldKeepDraft,
    selectedBlockKeys: [...selectedBlockKeys],
    ...(shouldKeepDraft && active && table ? {
      draft: clonePlain({ param: active.param, table }),
    } : {}),
  };
}

export function parseKtCodegenSessionSnapshot(raw: unknown): KtCodegenSessionSnapshot | null {
  if (!isRecord(raw) || raw.v !== KT_CODEGEN_SESSION_VERSION) return null;
  const selectedBlockKeys = Array.isArray(raw.selectedBlockKeys)
    ? [...new Set(raw.selectedBlockKeys.map(String).filter(ktCodegenIsBlockKey))]
    : [];
  const path = String(raw.path ?? "").trim();
  const fingerprint = String(raw.fingerprint ?? "").trim();
  const dirty = raw.dirty === true;
  if (!dirty) {
    return {
      v: KT_CODEGEN_SESSION_VERSION,
      path,
      fingerprint,
      dirty: false,
      selectedBlockKeys,
    };
  }
  if (!isRecord(raw.draft) || !isRecord(raw.draft.param) || !isTableData(raw.draft.table)) return null;
  return {
    v: KT_CODEGEN_SESSION_VERSION,
    path,
    fingerprint,
    dirty: true,
    selectedBlockKeys,
    draft: clonePlain({
      param: raw.draft.param as unknown as KtCodegenParam,
      table: raw.draft.table,
    }),
  };
}

export function decideKtCodegenDraftRestore(
  snapshot: KtCodegenSessionSnapshot,
  diskFingerprint: string,
): KtCodegenDraftRestoreDecision {
  if (!snapshot.dirty || !snapshot.draft) return "clean";
  return snapshot.fingerprint && snapshot.fingerprint === diskFingerprint
    ? "restore"
    : "conflict";
}
