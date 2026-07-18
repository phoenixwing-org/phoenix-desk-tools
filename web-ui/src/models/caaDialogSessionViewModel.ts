import type { CaaDialogIr } from "../types/caaDialogIr";

export type CaaIrWriteMode = "none" | "patch" | "full";

export interface CaaIrHistoryEntry {
  readonly ir: CaaDialogIr;
  readonly selectedId: string | null;
  readonly irWriteMode: CaaIrWriteMode;
  readonly nlsFlat?: Record<string, string>;
  readonly localeNlsFlats?: Record<string, Record<string, string>>;
}

export interface CaaDialogPageSnapshot {
  nlsFlat?: Record<string, string>;
  nlsSourceText?: string;
  localeNlsFlats?: Record<string, Record<string, string>>;
  isNewDraft?: boolean;
  draftId?: string | null;
  ir?: CaaDialogIr;
  selectedId?: string | null;
  irDirty?: boolean;
  irWriteMode?: CaaIrWriteMode;
  editMode?: boolean;
  undoStack?: CaaIrHistoryEntry[];
  redoStack?: CaaIrHistoryEntry[];
}

export interface CaaDialogSnapshotInput {
  readonly nlsFlat: Readonly<Record<string, string>>;
  readonly nlsSourceText: string;
  readonly localeNlsFlats: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly selectedId: string | null;
  readonly irDirty: boolean;
  readonly irWriteMode: CaaIrWriteMode;
  readonly editMode: boolean;
  readonly undoStack: readonly CaaIrHistoryEntry[];
  readonly redoStack: readonly CaaIrHistoryEntry[];
  readonly isNewDraft: boolean;
  readonly draftId: string | null;
  readonly ir: CaaDialogIr | null;
}

export const CAA_IR_HISTORY_LIMIT = 50;
export const CAA_SESSION_HISTORY_LIMIT = 12;

export function cloneCaaDialogPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function caaDialogIrForSession(ir: CaaDialogIr): CaaDialogIr {
  const cloned = cloneCaaDialogPlain(ir);
  if (cloned.parseMeta) {
    delete cloned.parseMeta.catNlsSourceText;
    delete cloned.parseMeta.localeNlsSourceTexts;
    cloned.parseMeta.locales = cloned.parseMeta.locales.map((locale) => {
      const copy = { ...locale };
      delete copy.sourceText;
      return copy;
    });
  }
  return cloned;
}

export function isCaaDialogSessionRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isCaaDialogIr(value: unknown): value is CaaDialogIr {
  if (!isCaaDialogSessionRecord(value)) return false;
  if (value.schemaVersion !== 1 || typeof value.dialogName !== "string") return false;
  if (!isCaaDialogSessionRecord(value.sources) || !isCaaDialogSessionRecord(value.root)) {
    return false;
  }
  return typeof value.root.id === "string" && Array.isArray(value.root.children);
}

export function normalizeCaaIrWriteMode(
  value: unknown,
  fallback: CaaIrWriteMode,
): CaaIrWriteMode {
  return value === "patch" || value === "full" || value === "none" ? value : fallback;
}

export function caaStringMapFromSession(value: unknown): Record<string, string> | null {
  if (!isCaaDialogSessionRecord(value)) return null;
  const map: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") map[key] = entry;
  }
  return map;
}

export function caaLocaleMapsFromSession(
  value: unknown,
): Record<string, Record<string, string>> | null {
  if (!isCaaDialogSessionRecord(value)) return null;
  const maps: Record<string, Record<string, string>> = {};
  for (const [locale, flat] of Object.entries(value)) {
    const map = caaStringMapFromSession(flat);
    if (map) maps[locale] = map;
  }
  return maps;
}

export function caaHistoryEntryFromSession(value: unknown): CaaIrHistoryEntry | null {
  if (!isCaaDialogSessionRecord(value) || !isCaaDialogIr(value.ir)) return null;
  const nlsFlat = caaStringMapFromSession(value.nlsFlat);
  const localeNlsFlats = caaLocaleMapsFromSession(value.localeNlsFlats);
  return {
    ir: cloneCaaDialogPlain(value.ir),
    selectedId: typeof value.selectedId === "string" ? value.selectedId : null,
    irWriteMode: normalizeCaaIrWriteMode(value.irWriteMode, "full"),
    ...(nlsFlat ? { nlsFlat } : {}),
    ...(localeNlsFlats ? { localeNlsFlats } : {}),
  };
}

export function caaHistoryStackFromSession(value: unknown): CaaIrHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(caaHistoryEntryFromSession)
    .filter((entry): entry is CaaIrHistoryEntry => Boolean(entry))
    .slice(-CAA_IR_HISTORY_LIMIT);
}

export function caaHistoryStackForSession(
  stack: readonly CaaIrHistoryEntry[],
): CaaIrHistoryEntry[] {
  return stack.slice(-CAA_SESSION_HISTORY_LIMIT).map((entry) => ({
    ir: caaDialogIrForSession(entry.ir),
    selectedId: entry.selectedId ?? null,
    irWriteMode: entry.irWriteMode,
    ...(entry.nlsFlat ? { nlsFlat: { ...entry.nlsFlat } } : {}),
    ...(entry.localeNlsFlats
      ? { localeNlsFlats: cloneCaaDialogPlain(entry.localeNlsFlats) }
      : {}),
  }));
}

export function buildCaaDialogPageSnapshot(
  input: CaaDialogSnapshotInput,
): CaaDialogPageSnapshot {
  const snapshot: CaaDialogPageSnapshot = {
    nlsFlat: { ...input.nlsFlat },
    nlsSourceText: input.nlsSourceText,
    localeNlsFlats: cloneCaaDialogPlain(input.localeNlsFlats),
    selectedId: input.selectedId,
    irDirty: input.irDirty,
    irWriteMode: input.irWriteMode,
    editMode: input.editMode,
  };
  const undoHistory = caaHistoryStackForSession(input.undoStack);
  const redoHistory = caaHistoryStackForSession(input.redoStack);
  if (undoHistory.length) snapshot.undoStack = undoHistory;
  if (redoHistory.length) snapshot.redoStack = redoHistory;
  if (input.isNewDraft && input.ir) {
    snapshot.isNewDraft = true;
    snapshot.draftId = input.draftId;
    snapshot.ir = caaDialogIrForSession(input.ir);
  } else if (input.irDirty && input.ir) {
    snapshot.ir = caaDialogIrForSession(input.ir);
  }
  return snapshot;
}
