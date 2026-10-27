import { beforeEach, expect, it, vi } from "vitest";
const fetch = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("../../api", () => ({ jsonFetch: fetch }));
import { batchTasksApi } from "./api";
import { syntheticTask } from "./fixtures.test-support";
beforeEach(() => fetch.mockClear());
it("binds every request to its explicit workspace and routes recovery before run IDs", async () => {
  await batchTasksApi.actions("/sample space"); await batchTasksApi.byRequest("/sample space", "request/a"); await batchTasksApi.detail("/sample space", "run/a"); await batchTasksApi.cancel("/sample space", "run/a"); await batchTasksApi.backup("/sample space");
  for (const call of fetch.mock.calls) expect(call[0]).toContain("workspace=%2Fsample%20space");
  expect(fetch.mock.calls[1][0]).toContain("/runs/by-request/request%2Fa?"); expect(fetch.mock.calls[2][0]).toContain("/runs/run%2Fa?after=0&");
  expect(fetch.mock.calls[3][1]).toEqual({ method: "POST", body: "{}" });
});
it("sends the stable creation id only for a new definition", async () => {
  const draft = syntheticTask(); await batchTasksApi.save("/sample space", draft, undefined, undefined, "stable-create-key");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ creation_id: "stable-create-key" });
});
it("sends explicit protocol two for a new confirmed admission", async () => {
  const request = { protocol_version: 2 as const, plan_id: "prepared-plan", digest: "bound-digest", client_request_id: "stable-request", confirmed: true as const };
  await batchTasksApi.admit("/sample space", request); expect(fetch.mock.calls[0][0]).toContain("/api/batch-tasks/runs?"); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(request);
});
it("reads workspace-bound failure draft candidates without posting execution or restoration authority", async () => {
  await batchTasksApi.retryDrafts("/sample space", "run/a");
  expect(fetch.mock.calls[0]).toEqual(["/api/batch-tasks/runs/run%2Fa/retry-drafts?workspace=%2Fsample%20space", undefined]);
});
