import { expect, it, vi } from "vitest";
import type { FileWorksetPayload } from "../../api";
import { createBatchWorksetInput } from "./worksetInput";
const payload = (workspace: string, id: string): FileWorksetPayload => ({ version: 1, workspace_path: workspace, worksets: [{ id, name: id, entries: [{ type: "file", path: "samples/note.txt" }], updated_at: "2035-01-01T00:00:00Z" }] });
it("only imports a private snapshot from the captured workspace and ignores old-space responses", async () => {
  const read = vi.fn<(workspace: string) => Promise<FileWorksetPayload>>();
  let resolve!: (value: FileWorksetPayload) => void; read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const input = createBatchWorksetInput(read); input.setWorkspace("/one"); const old = input.load();
  input.setWorkspace("/two"); const current = payload("/two", "two"); read.mockResolvedValueOnce(current); expect(await input.load()).toBe(true);
  resolve(payload("/one", "one")); expect(await old).toBe(false); expect(input.state.worksets.map(item => item.id)).toEqual(["two"]);
  current.worksets[0].entries![0].path = "samples/changed.txt"; expect(input.state.worksets[0].entries![0].path).toBe("samples/note.txt");
  read.mockResolvedValueOnce(payload("/one", "wrong-host-space")); expect(await input.load()).toBe(false); expect(input.state.worksets).toEqual([]); expect(input.state.error).toContain("不属于请求");
});
