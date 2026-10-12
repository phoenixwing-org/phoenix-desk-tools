import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { fetchCadIndexSearch, type CadIndexSearchResult } from "./api";
import { ApiError } from "../../api";

export function useCadIndexSearch(workspace: Ref<string>, refreshToken?: Ref<string | undefined>) {
  const query = ref(""), result = ref<CadIndexSearchResult | null>(null), error = ref(""), busy = ref(false);
  const errorCode = ref("");
  let epoch = 0, disposed = false;
  let confirmedRevision = refreshToken?.value;
  function invalidate() { epoch++; result.value = null; error.value = ""; errorCode.value = ""; busy.value = false; }
  const canOpenResults = computed(() => !!result.value && !busy.value && !error.value);
  async function search() {
    if (disposed) return;
    const seq = ++epoch, ws = workspace.value, term = query.value;
    result.value = null; error.value = ""; errorCode.value = "";
    if (!ws) { error.value = "请先打开工作空间。"; busy.value = false; return; }
    busy.value = true;
    const current = () => !disposed && seq === epoch && ws === workspace.value && term === query.value;
    try { const data = await fetchCadIndexSearch(ws, term); if (current()) result.value = data; }
    catch (cause) {
      if (current()) {
        error.value = cause instanceof Error ? cause.message : String(cause);
        if (cause instanceof ApiError && cause.payload && typeof cause.payload === "object" && "code" in cause.payload) {
          errorCode.value = String(cause.payload.code);
        }
      }
    }
    finally { if (current()) busy.value = false; }
  }
  watch(workspace, () => { confirmedRevision = undefined; query.value = ""; invalidate(); }, { flush: "sync" });
  watch(query, invalidate, { flush: "sync" });
  if (refreshToken) watch(refreshToken, next => {
    // Diagnostics temporarily clear their data while loading. That is not an index revision.
    if (next === undefined) return;
    const previous = confirmedRevision;
    confirmedRevision = next;
    // The first diagnostic response establishes a baseline, even if a search already finished.
    if (previous !== undefined && next !== previous) invalidate();
  }, { flush: "sync" });
  onScopeDispose(() => { disposed = true; invalidate(); });
  return { query, result, error, errorCode, busy, canOpenResults, search, invalidate };
}
