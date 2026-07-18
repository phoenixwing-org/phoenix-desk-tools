import { computed, ref, toRaw, type Ref } from "vue";
import {
  CAA_IR_HISTORY_LIMIT,
  caaHistoryStackFromSession,
  cloneCaaDialogPlain,
  type CaaDialogPageSnapshot,
  type CaaIrHistoryEntry,
  type CaaIrWriteMode,
} from "../models/caaDialogSessionViewModel";
import type { CaaDialogIr } from "../types/caaDialogIr";

export interface CaaDialogHistoryState {
  readonly ir: Ref<CaaDialogIr | null>;
  readonly selectedId: Ref<string | null>;
  readonly dirty: Ref<boolean>;
  readonly writeMode: Ref<CaaIrWriteMode>;
  readonly nlsFlat: Ref<Record<string, string>>;
  readonly localeNlsFlats: Ref<Record<string, Record<string, string>>>;
}

export interface UseCaaDialogHistoryControllerOptions {
  /** Page-local editor/session state remains the source of truth. */
  readonly state: CaaDialogHistoryState;
  /** Host callback used to mirror a restored entry to Pinia/tab dirty state. */
  readonly onRestored?: () => void;
}

/**
 * CAA editor history controller.
 *
 * It owns stack transitions and snapshot cloning only. PageSession persistence,
 * Host/API work, active-tab routing and Pinia mirrors remain in the page shell.
 */
export function useCaaDialogHistoryController(
  options: UseCaaDialogHistoryControllerOptions,
) {
  const { state } = options;
  const undoStack = ref<CaaIrHistoryEntry[]>([]);
  const redoStack = ref<CaaIrHistoryEntry[]>([]);
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  function snapshotHistoryEntry(): CaaIrHistoryEntry | null {
    if (!state.ir.value) return null;
    return {
      ir: cloneCaaDialogPlain(toRaw(state.ir.value)),
      selectedId: state.selectedId.value,
      irWriteMode: state.writeMode.value,
      nlsFlat: { ...toRaw(state.nlsFlat.value) },
      localeNlsFlats: cloneCaaDialogPlain(toRaw(state.localeNlsFlats.value)),
    };
  }

  function recordHistorySnapshot(): void {
    const entry = snapshotHistoryEntry();
    if (!entry) return;
    undoStack.value = [
      ...undoStack.value.slice(-(CAA_IR_HISTORY_LIMIT - 1)),
      entry,
    ];
    redoStack.value = [];
  }

  function restoreHistoryEntry(entry: CaaIrHistoryEntry): void {
    state.ir.value = cloneCaaDialogPlain(toRaw(entry.ir));
    state.selectedId.value = entry.selectedId ?? entry.ir.root.id;
    state.writeMode.value = entry.irWriteMode;
    state.dirty.value = entry.irWriteMode !== "none";
    if (entry.nlsFlat) state.nlsFlat.value = { ...entry.nlsFlat };
    if (entry.localeNlsFlats) {
      state.localeNlsFlats.value = cloneCaaDialogPlain(toRaw(entry.localeNlsFlats));
    }
    options.onRestored?.();
  }

  function undoIrChange(): void {
    const previous = undoStack.value[undoStack.value.length - 1];
    const current = snapshotHistoryEntry();
    if (!previous || !current) return;
    undoStack.value = undoStack.value.slice(0, -1);
    redoStack.value = [
      ...redoStack.value.slice(-(CAA_IR_HISTORY_LIMIT - 1)),
      current,
    ];
    restoreHistoryEntry(previous);
  }

  function redoIrChange(): void {
    const next = redoStack.value[redoStack.value.length - 1];
    const current = snapshotHistoryEntry();
    if (!next || !current) return;
    redoStack.value = redoStack.value.slice(0, -1);
    undoStack.value = [
      ...undoStack.value.slice(-(CAA_IR_HISTORY_LIMIT - 1)),
      current,
    ];
    restoreHistoryEntry(next);
  }

  function resetHistory(): void {
    undoStack.value = [];
    redoStack.value = [];
  }

  function restoreHistoryFromSnapshot(
    snapshot?: CaaDialogPageSnapshot | null,
  ): void {
    undoStack.value = caaHistoryStackFromSession(snapshot?.undoStack);
    redoStack.value = caaHistoryStackFromSession(snapshot?.redoStack);
  }

  return {
    undoStack,
    redoStack,
    canUndo,
    canRedo,
    snapshotHistoryEntry,
    recordHistorySnapshot,
    restoreHistoryEntry,
    undoIrChange,
    redoIrChange,
    resetHistory,
    restoreHistoryFromSnapshot,
  };
}
