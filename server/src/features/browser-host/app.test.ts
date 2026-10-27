import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createPhoenixServerApp } from "../../serverApp.js";
import { DESK_TOOLS_APP_VERSION } from "../../lib/deskToolsRegistration.js";
import type { BrowserHostOptions } from "./app.js";

const owned: string[] = [];
afterEach(() => { for (const directory of owned.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function fixture(pinned = false) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-public-browser-host-")));
  owned.push(directory);
  const webRoot = path.join(directory, "web"), assets = path.join(webRoot, "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(webRoot, "index.html"), '<!doctype html><main>Independent browser build</main><script src="/assets/example.js"></script>');
  fs.writeFileSync(path.join(assets, "example.js"), 'console.log("Independent public fixture");');
  fs.writeFileSync(path.join(assets, "example.css"), "main{color:inherit}");
  fs.writeFileSync(path.join(webRoot, "favicon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  let currentOrigin = "http://127.0.0.1:48123";
  const digests = Object.fromEntries(["index.html", "assets/example.js", "assets/example.css", "favicon.svg"].map(rel => [rel, createHash("sha256").update(fs.readFileSync(path.join(webRoot, rel))).digest("hex")]));
  const options: BrowserHostOptions = { origin: () => currentOrigin, instanceId: "independent-instance", startedAt: "2035-01-01T00:00:00.000Z", runtimeId: "independent-runtime", webRoot, ...(pinned ? { assetDigests: digests } : {}) };
  const app = createPhoenixServerApp({ browserHost: options });
  const request = (url: string, init?: RequestInit) => app.request(`${currentOrigin}${url}`, { ...init, headers: { Host: new URL(currentOrigin).host, ...init?.headers } });
  return { directory, webRoot, assets, options, app, request, digests, setOrigin(value: string) { currentOrigin = value; } };
}

describe("opt-in local browser host", () => {
  it("returns a noncached identity and real loopback Web URL without changing legacy health", async () => {
    const f = fixture(), response = await f.request("/api/desk-service");
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ schema_version: 1, service: "phoenix-desk-tools", protocol_version: 1, browser_host_protocol: 1,
      app_version: DESK_TOOLS_APP_VERSION, instance_id: "independent-instance", pid: process.pid, started_at: "2035-01-01T00:00:00.000Z",
      runtime_id: "independent-runtime", api_origin: "http://127.0.0.1:48123", web_url: "http://127.0.0.1:48123/", capabilities: ["browser-web", "local-api"] });
    expect(await (await f.request("/api/health")).json()).toEqual({ status: "ok", service: "phoenix-node", protocol_version: 1, app_version: DESK_TOOLS_APP_VERSION });
    f.setOrigin("http://127.0.0.1:48124");
    expect((await (await f.request("/api/desk-service")).json()).web_url).toBe("http://127.0.0.1:48124/");
  });

  it("admits same-origin API requests and originless local tools without broadening cross-origin access", async () => {
    const f = fixture();
    const sameOrigin = await f.request("/api/browser-fixture-not-an-api", { method: "POST", headers: { Origin: "http://127.0.0.1:48123", "Content-Type": "application/json" }, body: "{}" });
    expect(sameOrigin.status).toBe(404); expect(sameOrigin.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:48123");
    expect((await f.request("/api/browser-fixture-not-an-api", { method: "POST" })).status).toBe(404);
    for (const origin of ["http://localhost:48123", "http://127.0.0.1:48124", "http://localhost:49373", "http://tauri.localhost", "https://untrusted.invalid", "null"]) {
      const rejected = await f.request("/api/health", { headers: { Origin: origin } });
      expect(rejected.status, origin).toBe(403); expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
    }
    const preflight = await f.request("/api/health", { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:48123", "Access-Control-Request-Method": "POST" } });
    expect(preflight.status).toBe(204);
  });

  it("rejects missing, foreign and misleading Host values before API or static handling", async () => {
    const f = fixture();
    for (const host of ["localhost:48123", "127.0.0.1:48124", "untrusted.invalid:48123", "127.0.0.1:48123.untrusted.invalid", "127.0.0.1:48123,untrusted.invalid"]) {
      for (const url of ["/", "/assets/example.js", "/api/desk-service", "/api/health"]) expect((await f.request(url, { headers: { Host: host } })).status, host).toBe(403);
    }
    expect((await f.app.request("http://127.0.0.1:48123/api/health")).status).toBe(403);
  });

  it("serves only the chosen build's root/index and typed static assets with HEAD and no SPA fallback", async () => {
    const f = fixture();
    for (const url of ["/", "/?page=batch_tasks", "/index.html"]) {
      const response = await f.request(url); expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8"); expect(response.headers.get("cache-control")).toBe("no-cache"); expect(await response.text()).toContain("Independent browser build");
      expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
    for (const [url, mime] of [["/assets/example.js", "text/javascript; charset=utf-8"], ["/assets/example.css", "text/css; charset=utf-8"], ["/favicon.svg", "image/svg+xml"]]) {
      const response = await f.request(url); expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe(mime); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const head = await f.request(url, { method: "HEAD" }); expect(head.status).toBe(200); expect(await head.text()).toBe(""); expect(Number(head.headers.get("content-length"))).toBeGreaterThan(0);
    }
    for (const url of ["/unknown-view", "/assets/", "/assets/missing.js", "/favicon-missing.svg"]) expect((await f.request(url)).status).toBe(404);
  });

  it("does not swallow unknown API routes with index.html", async () => {
    const response = await fixture().request("/api/missing-browser-fixture");
    expect(response.status).toBe(404); expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: "未找到 API 路由", path: "/api/missing-browser-fixture" });
  });

  it("rejects traversal, hidden paths, private file types and double-encoded paths", async () => {
    const f = fixture();
    fs.mkdirSync(path.join(f.assets, ".private"));
    for (const name of ["config.json", "source.ts", "source.js.map", "records.sqlite", "model.FCStd", "private.key"]) fs.writeFileSync(path.join(f.assets, name), "Independent private sentinel");
    fs.writeFileSync(path.join(f.assets, ".private", "leak.js"), "Independent private sentinel");
    fs.writeFileSync(path.join(f.directory, "outside.js"), "Independent outside sentinel");
    for (const url of ["/assets/../outside.js", "/assets/%2e%2e/outside.js", "/assets/%252e%252e/outside.js", "/assets/%2eprivate/leak.js", "/assets/.private/leak.js", "/assets/example.js%00", "/assets/example%5c.js", "/assets/%ZZ.js", "/assets//example.js", "/assets/config.json", "/assets/source.ts", "/assets/source.js.map", "/assets/records.sqlite", "/assets/model.FCStd", "/assets/private.key"]) {
      const response = await f.request(url); expect(response.status, url).toBe(404); expect(await response.text()).not.toContain("sentinel");
    }
  });

  it("never serves a symlink file, directory or replaced build root", async () => {
    const f = fixture(), privateDir = path.join(f.directory, "outside"); fs.mkdirSync(privateDir);
    fs.writeFileSync(path.join(privateDir, "leak.js"), "Independent outside sentinel");
    fs.symlinkSync(path.join(privateDir, "leak.js"), path.join(f.assets, "file-link.js"));
    fs.symlinkSync(privateDir, path.join(f.assets, "directory-link"), "dir");
    for (const url of ["/assets/file-link.js", "/assets/directory-link/leak.js"]) { const response = await f.request(url); expect(response.status).toBe(404); expect(await response.text()).not.toContain("sentinel"); }
    fs.renameSync(f.webRoot, `${f.webRoot}-previous`); fs.mkdirSync(f.webRoot); fs.writeFileSync(path.join(f.webRoot, "index.html"), "Independent replacement sentinel");
    expect((await f.request("/")).status).toBe(404);
  });

  it("requires an explicit usable build and rejects a symlink build root or index", () => {
    const f = fixture();
    expect(() => createPhoenixServerApp({ browserHost: { ...f.options, webRoot: path.join(f.directory, "missing") } })).toThrow();
    expect(() => createPhoenixServerApp({ browserHost: { ...f.options, webRoot: "relative/build" } })).toThrow(/explicit absolute/);
    fs.symlinkSync(f.webRoot, path.join(f.directory, "root-link"), "dir");
    expect(() => createPhoenixServerApp({ browserHost: { ...f.options, webRoot: path.join(f.directory, "root-link") } })).toThrow(/real directories/);
    fs.unlinkSync(path.join(f.webRoot, "index.html")); fs.symlinkSync(path.join(f.assets, "example.js"), path.join(f.webRoot, "index.html"));
    expect(() => createPhoenixServerApp({ browserHost: f.options })).toThrow(/regular index/);
  });

  it("keeps unavailable or non-loopback dynamic origins closed", async () => {
    const f = fixture();
    for (const origin of ["", "http://0.0.0.0:48123", "http://localhost:48123", "https://127.0.0.1:48123", "http://127.0.0.1:48123/private", "http://user:pass@127.0.0.1:48123"]) {
      f.setOrigin(origin);
      const response = await f.app.request("http://127.0.0.1:48123/api/desk-service", { headers: { Host: "127.0.0.1:48123" } });
      expect(response.status, origin).toBe(503);
    }
  });

  it("does not enable browser hosting or change old origin handling without explicit options", async () => {
    const app = createPhoenixServerApp();
    expect((await app.request("/")).status).toBe(404); expect((await app.request("/api/desk-service")).status).toBe(404);
    const response = await app.request("/api/health", { headers: { Origin: "http://localhost:49373" } });
    expect(response.status).toBe(200); expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:49373");
  });

  it("serves a pinned build only when each exact returned file matches its frozen digest", async () => {
    const f = fixture(true);
    for (const url of ["/", "/index.html", "/assets/example.js", "/assets/example.css", "/favicon.svg"]) {
      expect((await f.request(url)).status, url).toBe(200);
      expect((await f.request(url, { method: "HEAD" })).status, url).toBe(200);
    }
  });

  it.each(["index.html", "assets/example.js"])("refuses an in-place rebuild of pinned %s rather than mixing a new Web with the old runtime identity", async rel => {
    const f = fixture(true);
    fs.writeFileSync(path.join(f.webRoot, rel), "Independent rebuilt Web sentinel");
    for (const method of ["GET", "HEAD"]) {
      const response = await f.request(`/${rel}`, { method });
      expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
      if (method === "GET") expect(await response.json()).toMatchObject({ code: "web_build_changed" });
    }
    expect((await (await f.request("/api/desk-service")).json()).runtime_id).toBe("independent-runtime");
  });

  it("refuses unlisted or removed pinned assets with a build-changed response", async () => {
    const f = fixture(true);
    fs.writeFileSync(path.join(f.assets, "new-build.js"), "Independent unlisted build sentinel");
    fs.unlinkSync(path.join(f.assets, "example.css"));
    for (const rel of ["assets/new-build.js", "assets/unknown.js", "assets/example.css"]) {
      const response = await f.request(`/${rel}`);
      expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "web_build_changed" });
    }
  });

  it("clones the caller's digest record so later mutations cannot change the hosted build", async () => {
    const f = fixture(true);
    f.digests["index.html"] = "0".repeat(64);
    expect((await f.request("/")).status).toBe(200);
    fs.writeFileSync(path.join(f.assets, "example.js"), "Independent rebuilt asset sentinel");
    f.digests["assets/example.js"] = createHash("sha256").update(fs.readFileSync(path.join(f.assets, "example.js"))).digest("hex");
    const response = await f.request("/assets/example.js");
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "web_build_changed" });
  });

  it("rejects malformed digest records and unsafe relative identities before hosting", () => {
    const f = fixture();
    for (const assetDigests of [null, [], { "../outside.js": "a".repeat(64) }, { "/index.html": "a".repeat(64) }, { "assets/file.js": "not a sha" }, { "assets/.private.js": "a".repeat(64) }, { "assets/a\\b.js": "a".repeat(64) }, Object.defineProperty({}, "index.html", { get() { throw new Error("getter must not run"); } })]) {
      expect(() => createPhoenixServerApp({ browserHost: { ...f.options, assetDigests: assetDigests as unknown as Record<string, string> } })).toThrow(/asset digest/);
    }
  });
});
