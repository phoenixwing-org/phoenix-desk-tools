import { afterEach, expect, it, vi } from "vitest";
import { ensureSaveThumbnail } from "./preferences.js";

const marker = "DESK_SAVE_THUMBNAIL_PERSISTED";
const xml = (members: string) => `<?xml version="1.0"?><methodResponse><params><param><value><struct>${members}</struct></value></param></params></methodResponse>`;
const member = (name: string, value: string) => `<member><name>${name}</name><value>${value}</value></member>`;
const success = (output = marker) => xml(member("success", "<boolean>1</boolean>") + member("output", `<string>${output}</string>`));
function mockResponse(body = success(), init?: ResponseInit) {
  const fetcher = vi.fn(async () => new Response(body, init)); vi.stubGlobal("fetch", fetcher); return fetcher;
}
function resetConfiguration() {
  vi.stubEnv("PHOENIX_FREECAD_RPC_PORT", undefined); vi.stubEnv("PHOENIX_FREECAD_RPC_TOKEN", undefined);
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("thumbnail preference RPC sends only the fixed local Python operation and bounded execute_code arguments", async () => {
  resetConfiguration(); const fetcher = mockResponse();
  await ensureSaveThumbnail();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://127.0.0.1:9875/RPC2");
  expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { "Content-Type": "text/xml; charset=utf-8" } });
  expect(init.signal).toBeInstanceOf(AbortSignal);
  const code = [
    "import FreeCAD as App",
    "_desk_thumbnail_preferences = App.ParamGet('User parameter:BaseApp/Preferences/Document')",
    "_desk_thumbnail_preferences.SetBool('SaveThumbnail', True)", "if App.saveParameter() is False:",
    "    raise RuntimeError('SaveThumbnail preferences were not persisted')",
    "if App.ParamGet('User parameter:BaseApp/Preferences/Document').GetBool('SaveThumbnail', False) is not True:",
    "    raise RuntimeError('SaveThumbnail was not enabled')", `print('${marker}')`,
  ].join("\n").replaceAll("'", "&apos;");
  expect(init.body).toBe(`<?xml version="1.0"?><methodCall><methodName>execute_code</methodName><params><param><value><string>${code}</string></value></param><param><value><int>10</int></value></param></params></methodCall>`);
  expect(init.body).not.toMatch(/\.cfg|doc\.save|saveAs|openDocument|FreeCADGui|listDocuments|Shape/);
});

it("thumbnail preference RPC accepts XML entities and CDATA only within a structurally valid success response", async () => {
  resetConfiguration(); const fetcher = mockResponse(success(`${marker.replaceAll("_", "&#x5f;")}&#10;`));
  await expect(ensureSaveThumbnail()).resolves.toBeUndefined();
  fetcher.mockImplementationOnce(async () => new Response(xml(member("success", "<boolean>1</boolean>") + member("output", `<string><![CDATA[${marker}\n]]></string>`))));
  await expect(ensureSaveThumbnail()).resolves.toBeUndefined();
});

it("thumbnail preference RPC uses the environment port and token only for its loopback URL and Authorization header", async () => {
  resetConfiguration(); vi.stubEnv("PHOENIX_FREECAD_RPC_PORT", "12345"); vi.stubEnv("PHOENIX_FREECAD_RPC_TOKEN", "synthetic-secret-token");
  vi.stubEnv("PHOENIX_FREECAD_RPC_URL", "https://example.invalid/not-permitted");
  const fetcher = mockResponse(); await ensureSaveThumbnail();
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://127.0.0.1:12345/RPC2");
  expect(init.headers).toMatchObject({ Authorization: "Bearer synthetic-secret-token" });
  expect(init.body).not.toContain("synthetic-secret-token");
});

it.each(["0", "65536", "-1", "12.5", "", "9875/RPC2", "http://example.invalid", "9875@elsewhere", " 9875"])("thumbnail preference RPC rejects invalid or URL-like port %j before any request", async port => {
  resetConfiguration(); vi.stubEnv("PHOENIX_FREECAD_RPC_PORT", port); const fetcher = mockResponse();
  await expect(ensureSaveThumbnail()).rejects.toThrow(/端口.*MCP 本地 RPC/); expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  ["false boolean", xml(member("success", "<boolean>0</boolean>") + member("output", `<string>${marker}</string>`))],
  ["string true", xml(member("success", "<string>true</string>") + member("output", `<string>${marker}</string>`))],
  ["integer success", xml(member("success", "<int>1</int>") + member("output", `<string>${marker}</string>`))],
  ["invalid boolean spelling", xml(member("success", "<boolean>true</boolean>") + member("output", `<string>${marker}</string>`))],
  ["base64 output type", xml(member("success", "<boolean>1</boolean>") + member("output", `<base64>${marker}</base64>`))],
  ["dateTime output type", xml(member("success", "<boolean>1</boolean>") + member("output", `<dateTime.iso8601>${marker}</dateTime.iso8601>`))],
  ["missing success", xml(member("output", `<string>${marker}</string>`))],
  ["marker in error", xml(member("success", "<boolean>1</boolean>") + member("error", `<string>${marker}</string>`) + member("output", "<string/>"))],
  ["error alongside success", xml(member("success", "<boolean>1</boolean>") + member("output", `<string>${marker}</string>`) + member("error", "<string>synthetic execution failure</string>"))],
  ["marker prefix", success(`before ${marker}`)], ["marker suffix", success(`${marker} after`)],
  ["embedded fake XML", xml(member("success", "<boolean>0</boolean>") + member("output", `<string>&lt;boolean&gt;1&lt;/boolean&gt;${marker}</string>`))],
  ["duplicate success", xml(member("success", "<boolean>0</boolean>") + member("success", "<boolean>1</boolean>") + member("output", `<string>${marker}</string>`))],
  ["duplicate output", xml(member("success", "<boolean>1</boolean>") + member("output", "<string/> ") + member("output", `<string>${marker}</string>`))],
  ["unknown entity", success(`&secret;${marker}`)], ["external entity declaration", `<!DOCTYPE methodResponse [<!ENTITY secret SYSTEM "file:///unreachable">]>${success()}`],
  ["mismatched XML", success().replace("</struct>", "</array>")], ["extra root", success() + "<extra/>"],
  ["invalid XML declaration", success().replace('version="1.0"', "invalid")],
  ["plain text", `success=true ${marker}`], ["JSON", JSON.stringify({ success: true, output: marker })],
  ["fault", `<methodResponse><fault><value><struct>${member("faultString", `<string>${marker}</string>`)}</struct></value></fault></methodResponse>`],
])("thumbnail preference RPC fails closed for %s rather than accepting marker text", async (_name, body) => {
  resetConfiguration(); mockResponse(body);
  await expect(ensureSaveThumbnail()).rejects.toThrow(/MCP 本地 RPC/);
});

it("thumbnail preference RPC never exposes token or external HTTP, XML fault or network error text", async () => {
  resetConfiguration(); const token = "synthetic-only-secret"; vi.stubEnv("PHOENIX_FREECAD_RPC_TOKEN", token);
  const fetcher = mockResponse(token, { status: 401 }); const log = vi.spyOn(console, "log"), errorLog = vi.spyOn(console, "error");
  for (const implementation of [
    async () => new Response(token, { status: 401 }),
    async () => new Response(`<methodResponse><fault><value><string>${token}</string></value></fault></methodResponse>`),
    async () => { throw new Error(`Authorization: Bearer ${token}`); },
  ]) {
    fetcher.mockImplementationOnce(implementation);
    const error = await ensureSaveThumbnail().catch(error => error as Error);
    expect(error).toBeInstanceOf(Error); expect(String(error)).toContain("MCP 本地 RPC"); expect(String(error)).not.toContain(token);
  }
  expect(log).not.toHaveBeenCalled(); expect(errorLog).not.toHaveBeenCalled();
});

it("thumbnail preference RPC rejects header-control tokens without echoing or transmitting them", async () => {
  resetConfiguration(); const token = "synthetic\r\nInjected: header"; vi.stubEnv("PHOENIX_FREECAD_RPC_TOKEN", token); const fetcher = mockResponse();
  const error = await ensureSaveThumbnail().catch(error => error as Error);
  expect(String(error)).toContain("授权配置格式无效"); expect(String(error)).not.toContain("synthetic"); expect(fetcher).not.toHaveBeenCalled();
});

it("thumbnail preference RPC bounds actual streamed bytes even when Content-Length lies", async () => {
  resetConfiguration(); mockResponse("x".repeat(64 * 1024 + 1), { headers: { "Content-Length": "1" } });
  await expect(ensureSaveThumbnail()).rejects.toThrow(/安全上限/);
  mockResponse(success(), { headers: { "Content-Length": String(64 * 1024 + 1) } });
  await expect(ensureSaveThumbnail()).rejects.toThrow(/安全上限/);
});

it("thumbnail preference RPC rejects invalid UTF-8 and bounds XML depth and node count", async () => {
  resetConfiguration(); vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([255, 254]))));
  await expect(ensureSaveThumbnail()).rejects.toThrow(/UTF-8/);
  mockResponse("<deep>".repeat(40) + "</deep>".repeat(40));
  await expect(ensureSaveThumbnail()).rejects.toThrow(/过深/);
  mockResponse("<methodResponse>" + "<extra/>".repeat(2049) + "</methodResponse>");
  await expect(ensureSaveThumbnail()).rejects.toThrow(/过深/);
});

it("thumbnail preference RPC times out a stalled fetch, aborts it and clears its deadline", async () => {
  resetConfiguration(); vi.useFakeTimers();
  const fetcher = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetcher);
  const pending = expect(ensureSaveThumbnail()).rejects.toThrow(/超时.*MCP 本地 RPC/);
  await vi.advanceTimersByTimeAsync(15_000); await pending;
  expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

it("thumbnail preference RPC also cancels a stalled response body on its deadline", async () => {
  resetConfiguration(); vi.useFakeTimers(); const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel }))));
  const pending = expect(ensureSaveThumbnail()).rejects.toThrow(/超时.*MCP 本地 RPC/);
  await vi.advanceTimersByTimeAsync(15_000); await pending;
  expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
