import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverDeskWeb, probeDeskWeb, readDeskWebRegistration } from "./desk-web-discovery.mjs";

const INSTANCE = "5134be95-2b4d-42c0-a8b5-6497c2807779";
function registration(overrides = {}) {
  return { schema_version: 1, service: "phoenix-desk-tools", protocol_version: 1, browser_host_protocol: 1,
    identity_path: "/api/desk-service", app_version: "0.5.0", host: "127.0.0.1", port: 48_381,
    instance_id: INSTANCE, pid: 4321, runtime_id: "registry:independent-test", web_url: "http://127.0.0.1:48381/", ...overrides };
}
function identity(reg = registration(), overrides = {}) {
  return { schema_version: 1, service: "phoenix-desk-tools", protocol_version: 1, browser_host_protocol: 1,
    app_version: reg.app_version, instance_id: reg.instance_id, pid: reg.pid, runtime_id: reg.runtime_id,
    api_origin: `http://127.0.0.1:${reg.port}`, web_url: reg.web_url, capabilities: ["browser-web", "local-api"], ...overrides };
}
function fixture(context, reg = registration()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-web-discovery-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (reg !== null) fs.writeFileSync(path.join(root, "service.v1.json"), JSON.stringify(reg));
  return { root, env: { PHOENIX_DESK_TOOLS_REGISTRY_DIR: root } };
}
function fetcher(reg = registration(), value = identity(reg), html = "<!doctype html><html><body>Independent interface</body></html>") {
  const calls = [];
  return { calls, fetch: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith("/api/desk-service")
      ? new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } })
      : new Response(html, { headers: { "content-type": "text/html" } });
  } };
}

test("reads local registration but only a verified identity and HTML probe produce ready", async (context) => {
  const reg = registration(), f = fixture(context, reg), transport = fetcher(reg);
  assert.deepEqual(readDeskWebRegistration(f.env), reg);
  const output = await discoverDeskWeb(f.env, transport.fetch, { expectedRuntimeId: reg.runtime_id });
  assert.deepEqual(output, { state: "ready", code: "verified", reason: "已验证并复用兼容的 Desk 浏览器宿主",
    api_origin: "http://127.0.0.1:48381", web_url: reg.web_url, instance_id: INSTANCE, reused: true, lock_present: false });
  assert.deepEqual(transport.calls.map(call => call.url), ["http://127.0.0.1:48381/api/desk-service", "http://127.0.0.1:48381/"]);
  for (const { options } of transport.calls) {
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.ok(options.signal instanceof AbortSignal);
  }
});

test("missing and malformed registration or owner locks never trigger cleanup or a fetch", async (context) => {
  const f = fixture(context, null); let fetched = false;
  const transport = async () => { fetched = true; throw new Error("must not fetch"); };
  assert.equal((await discoverDeskWeb(f.env, transport)).state, "absent");
  fs.writeFileSync(path.join(f.root, "instance.v1.lock"), "independent existing owner");
  const before = fs.readFileSync(path.join(f.root, "instance.v1.lock"));
  assert.equal((await discoverDeskWeb(f.env, transport)).code, "owner_lock_present");
  fs.writeFileSync(path.join(f.root, "service.v1.json"), "invalid JSON");
  assert.equal(readDeskWebRegistration(f.env), null);
  assert.equal((await discoverDeskWeb(f.env, transport)).state, "unavailable");
  assert.deepEqual(fs.readFileSync(path.join(f.root, "instance.v1.lock")), before);
  assert.equal(fs.readFileSync(path.join(f.root, "service.v1.json"), "utf8"), "invalid JSON");
  assert.equal(fetched, false);
});

test("rejects unsafe host, URL, instance, port and incompatible browser registration before network", async () => {
  for (const override of [
    { host: "localhost" }, { host: "0.0.0.0" }, { port: "48381" }, { port: 0 }, { port: 65_536 },
    { instance_id: "not-a-uuid" }, { pid: 0 }, { pid: 1.5 }, { protocol_version: 2 }, { browser_host_protocol: 2 },
    { identity_path: "/api/health" }, { web_url: "https://127.0.0.1:48381/" }, { web_url: "http://localhost:48381/" },
    { web_url: "http://127.0.0.1:48382/" }, { web_url: "http://127.0.0.1:48381/?next=https://example.invalid" },
    { web_url: "http://user@127.0.0.1:48381/" }, { app_version: "0.4.9" }, { runtime_id: "" },
  ]) {
    let fetched = false;
    assert.equal((await probeDeskWeb(registration(override), async () => { fetched = true; })).state, "incompatible", JSON.stringify(override));
    assert.equal(fetched, false);
  }
  assert.equal((await probeDeskWeb(registration(), undefined, { expectedRuntimeId: "different" })).code, "runtime_mismatch");
});

test("old API-only registrations are incompatible rather than a request to start another service", async (context) => {
  const reg = registration(); delete reg.browser_host_protocol; delete reg.web_url; delete reg.identity_path;
  const f = fixture(context, reg); let fetched = false;
  const value = await discoverDeskWeb(f.env, async () => { fetched = true; });
  assert.equal(value.state, "incompatible"); assert.equal(value.code, "browser_host_required");
  assert.equal(value.reused, false); assert.equal(value.web_url, null); assert.equal(fetched, false);
});

test("every returned identity binding and both explicit capabilities must match", async () => {
  for (const override of [
    { schema_version: 2 }, { service: "phoenix-node" }, { protocol_version: 2 }, { browser_host_protocol: 2 },
    { app_version: "0.5.1" }, { instance_id: "d177737e-82f4-4cff-9385-013c227b1a87" }, { pid: 4322 },
    { runtime_id: "registry:another" }, { api_origin: "http://127.0.0.1:48382" }, { web_url: "http://127.0.0.1:48381" },
    { capabilities: ["local-api"] }, { capabilities: ["local-api", "local-api"] },
  ]) {
    const transport = fetcher(registration(), identity(registration(), override));
    const value = await probeDeskWeb(registration(), transport.fetch);
    assert.equal(value.code, "identity_mismatch", JSON.stringify(override));
    assert.equal(transport.calls.length, 1); assert.equal(value.web_url, null);
  }
});

test("supports an explicitly chosen exact version, never a loose semver range", async () => {
  const reg = registration({ app_version: "0.6.0" }), transport = fetcher(reg);
  assert.equal((await probeDeskWeb(reg, transport.fetch)).state, "incompatible");
  assert.equal((await probeDeskWeb(reg, transport.fetch, { expectedVersion: "0.6.0" })).state, "ready");
  assert.equal((await probeDeskWeb(reg, transport.fetch, { expectedVersion: ">=0.5.0" })).state, "incompatible");
});

test("does not follow identity or homepage redirects and does not accept API JSON as HTML", async () => {
  const reg = registration();
  assert.equal((await probeDeskWeb(reg, async () => new Response(null, { status: 302, headers: { location: "https://example.invalid" } }))).state, "incompatible");
  for (const response of [new Response("{}", { headers: { "content-type": "application/json" } }),
    new Response(null, { status: 302, headers: { location: "https://example.invalid" } }),
    new Response("plain text", { headers: { "content-type": "text/html" } })]) {
    let calls = 0;
    const value = await probeDeskWeb(reg, async (_url, options) => {
      assert.equal(options.redirect, "error");
      return ++calls === 1 ? new Response(JSON.stringify(identity(reg)), { headers: { "content-type": "application/json" } }) : response;
    });
    assert.equal(value.code, "web_not_html"); assert.equal(value.state, "incompatible");
  }
});

test("network failure is unavailable, and identity bodies are bounded", async () => {
  assert.equal((await probeDeskWeb(registration(), async () => { throw new Error("connection refused"); })).state, "unavailable");
  assert.equal((await probeDeskWeb(registration(), async () => new Response(" ".repeat(20_000), { headers: { "content-type": "application/json" } }))).code, "identity_probe_failed");
});

test("reads only a finite HTML prefix and cancels the rest", async () => {
  let calls = 0, cancelled = false;
  const value = await probeDeskWeb(registration(), async () => {
    if (++calls === 1) return new Response(JSON.stringify(identity()), { headers: { "content-type": "application/json" } });
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("<!doctype html><html>" + " ".repeat(20_000))); }, cancel() { cancelled = true; } });
    return new Response(stream, { headers: { "content-type": "text/html" } });
  });
  assert.equal(value.state, "ready"); assert.equal(cancelled, true);
});
