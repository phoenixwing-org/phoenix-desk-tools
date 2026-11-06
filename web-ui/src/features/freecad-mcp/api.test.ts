import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonFetch } from "../../api";
import { freecadMcpApi, validateConnection, validateOwnedWorker, validatePlan, validateStatus } from "./api";
import { syntheticPlan, syntheticStatus } from "./fixtures.test-support";
vi.mock("../../api", () => ({ jsonFetch: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
describe("FreeCAD MCP typed response boundary", () => {
  const idle = { schema_version: 1, id: null, phase: "idle", reason_code: "not_started", message: "未启动", owned: false, configuration_revision: null };
  const starting = { ...idle, id: "11111111-1111-4111-8111-111111111111", phase: "starting", reason_code: "launching", owned: true, configuration_revision: "combined-host-revision" };
  it("accepts an optional redacted worker observation without treating ownership as readiness", () => {
    expect(validateOwnedWorker(starting).phase).toBe("starting");
    expect(validateStatus({ ...syntheticStatus(), owned_worker: { enabled: false, reason: "候选默认关闭", observation: starting } }).owned_worker?.observation.owned).toBe(true);
    for (const patch of [{ phase: "running" }, { id: 12345 }, { id: null }, { owned: false }, { configuration_revision: null }, { pid: 12345 }, { url: "http://127.0.0.1:1/" }, { resource: "/private/synthetic" }, { reason_code: "arbitrary" }]) expect(() => validateOwnedWorker({ ...starting, ...patch })).toThrow();
  });
  it("requires confirmation and only a revision or manager UUID for explicit start/stop", async () => {
    vi.mocked(jsonFetch).mockResolvedValueOnce(starting).mockResolvedValueOnce({ ...starting, phase: "stopped", reason_code: "stopped_after_owned_close", owned: false });
    await freecadMcpApi.start("settings-revision"); await freecadMcpApi.stop(starting.id);
    expect(vi.mocked(jsonFetch).mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))])).toEqual([["/api/freecad-mcp/instance/start", { revision: "settings-revision", confirmed: true }], ["/api/freecad-mcp/instance/stop", { id: starting.id, confirmed: true }]]);
  });
  it("accepts only schema 1 settings observations and a bounded existing port", () => {
    expect(validateStatus(syntheticStatus())).toEqual(syntheticStatus());
    for (const patch of [{ schema_version: 2 }, { revision: "" }, { settings: { ...syntheticStatus().settings, existing_port: 0 } }, { settings: { ...syntheticStatus().settings, mode: "discover" } }, { installation: { state: "installed", version: null, reason: "not a supported state" } }]) expect(() => validateStatus({ ...syntheticStatus(), ...patch })).toThrow();
  });
  it("uses the same non-privileged port range as the server and settings input", () => {
    for (const port of [1, 80, 1023, 65536, 19326.5]) expect(() => validateStatus({ ...syntheticStatus(), settings: { ...syntheticStatus().settings, existing_port: port } })).toThrow();
    for (const port of [1024, 65535]) expect(validateStatus({ ...syntheticStatus(), settings: { ...syntheticStatus().settings, existing_port: port } }).settings.existing_port).toBe(port);
  });
  it("rejects any JSON bridge presented as ready MCP, including unverified MCP phases", () => {
    const original = syntheticStatus().connection;
    expect(() => validateConnection({ ...original, state: "ready", phase: "bridge", mcp_verified: true })).toThrow();
    expect(() => validateConnection({ ...original, state: "ready", phase: "mcp", mcp_verified: false })).toThrow();
    expect(validateConnection({ ...original, state: "ready", phase: "mcp", mcp_verified: true }).state).toBe("ready");
    expect(validateConnection({ ...original, state: "blocked", phase: "bridge" }).mcp_verified).toBe(false);
  });
  it("rejects malformed or incomplete ready installation plans, not just their TypeScript types", () => {
    expect(validatePlan(syntheticPlan())).toEqual(syntheticPlan());
    for (const patch of [{ plan_id: undefined }, { source_digest: "unverified" }, { target: "" }, { changes: [{ path: "Init.py", kind: "overwrite_unknown" }] }, { expires_at: "tomorrow" }]) expect(() => validatePlan({ ...syntheticPlan(), ...patch })).toThrow();
    expect(validatePlan({ state: "blocked", reason: "No compatible trusted resource" }).state).toBe("blocked");
  });
  it("GET detection performs no launch, installation or connection request", async () => {
    vi.mocked(jsonFetch).mockResolvedValue(syntheticStatus()); const controller = new AbortController(); await freecadMcpApi.status(controller.signal);
    expect(jsonFetch).toHaveBeenCalledExactlyOnceWith("/api/freecad-mcp/status", { signal: controller.signal });
  });
  it("saves an explicit revision and settings, not launcher freecad_ok as connection evidence", async () => {
    vi.mocked(jsonFetch).mockResolvedValue(syntheticStatus()); await freecadMcpApi.save(syntheticStatus().settings, "revision-for-save");
    const [url, init] = vi.mocked(jsonFetch).mock.calls[0]; expect(url).toBe("/api/freecad-mcp/settings"); expect(init?.method).toBe("PUT"); expect(JSON.parse(String(init?.body))).toEqual({ settings: syntheticStatus().settings, expected_revision: "revision-for-save" });
  });
  it("previews a frozen revision, then installs only with a server plan and confirmation", async () => {
    vi.mocked(jsonFetch).mockResolvedValueOnce(syntheticPlan()).mockResolvedValueOnce({ state: "installed", backup: null, restart_required: true, status: syntheticStatus() });
    await freecadMcpApi.preview("preview-revision"); await freecadMcpApi.apply("server-plan");
    expect(vi.mocked(jsonFetch).mock.calls.map(([url, init]) => [url, init?.method, JSON.parse(String(init?.body))])).toEqual([
      ["/api/freecad-mcp/install/preview", "POST", { revision: "preview-revision" }],
      ["/api/freecad-mcp/install/apply", "POST", { plan_id: "server-plan", confirmed: true }],
    ]);
  });
  it("checks the selected connection revision without treating it as an old XML-RPC request", async () => {
    vi.mocked(jsonFetch).mockResolvedValue(syntheticStatus().connection); await freecadMcpApi.check("connection-revision");
    expect(jsonFetch).toHaveBeenCalledWith("/api/freecad-mcp/connection/check", expect.objectContaining({ method: "POST", body: JSON.stringify({ revision: "connection-revision" }) }));
  });
});
