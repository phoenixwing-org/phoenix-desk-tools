import { reactive } from "vue";
import type { FileWorkset, FileWorksetPayload } from "../../api";
import { fetchBatchInputWorksets } from "./api";

/** A private read snapshot, never the mutable shared workset store. */
export function createBatchWorksetInput(read: (workspace: string) => Promise<FileWorksetPayload> = fetchBatchInputWorksets) {
  const state = reactive({ workspace: "", worksets: [] as FileWorkset[], loading: false, error: "" });
  let generation = 0, request = 0;
  function setWorkspace(workspace: string) {
    if (workspace === state.workspace) return;
    generation++; request++; Object.assign(state, { workspace, worksets: [], loading: false, error: "" });
  }
  async function load() {
    if (!state.workspace) return false;
    const own = generation, ticket = ++request, workspace = state.workspace; state.loading = true; state.error = "";
    try {
      const payload = await read(workspace);
      if (own !== generation || ticket !== request) return false;
      if (payload.workspace_path !== workspace) throw new Error("工作集响应不属于请求的工作空间，未提供导入；请确认空间后重新读取。");
      state.worksets = JSON.parse(JSON.stringify(payload.worksets)) as FileWorkset[]; return true;
    } catch (cause) {
      if (own === generation && ticket === request) { state.worksets = []; state.error = cause instanceof Error ? cause.message : String(cause); }
      return false;
    } finally { if (own === generation && ticket === request) state.loading = false; }
  }
  return { state, setWorkspace, load };
}
