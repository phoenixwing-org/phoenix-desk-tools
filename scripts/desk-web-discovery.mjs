import fs from "node:fs";
import path from "node:path";
import { deskApiRegistrationDirectory } from "./desk-api-discovery.mjs";

export const DESK_WEB_APP_VERSION = "0.5.0";
export const DESK_WEB_IDENTITY_PATH = "/api/desk-service";
const MAX_REGISTRATION_BYTES = 16_384;
const MAX_IDENTITY_BYTES = 16_384;
const WEB_PREFIX_BYTES = 8_192;
const PROBE_TIMEOUT_MS = 800;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUNTIME_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function registrationSnapshot(env) {
  const directory = deskApiRegistrationDirectory(env);
  const servicePath = path.join(directory, "service.v1.json");
  let lockPresent = false;
  try { fs.lstatSync(path.join(directory, "instance.v1.lock")); lockPresent = true; }
  catch (error) { if (error?.code !== "ENOENT") lockPresent = true; }
  let fd;
  try {
    fd = fs.openSync(servicePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > MAX_REGISTRATION_BYTES) throw new Error("invalid registration");
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    const after = fs.fstatSync(fd), leaf = fs.lstatSync(servicePath);
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || leaf.dev !== before.dev || leaf.ino !== before.ino || !leaf.isFile()) throw new Error("registration changed");
    const registration = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset)));
    if (!record(registration)) throw new Error("invalid registration");
    return { registration, lockPresent, invalid: false };
  } catch (error) {
    return { registration: null, lockPresent, invalid: error?.code !== "ENOENT" };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Reads bounded local metadata only; a returned row has NOT passed live identity verification. */
export function readDeskWebRegistration(env = process.env) {
  return registrationSnapshot(env).registration;
}

function result(state, code, reason, registration = null) {
  return {
    state, code, reason,
    api_origin: state === "ready" ? `http://127.0.0.1:${registration.port}` : null,
    web_url: state === "ready" ? registration.web_url : null,
    instance_id: state === "ready" ? registration.instance_id : null,
    reused: state === "ready",
  };
}

function validWebUrl(value, origin) {
  if (typeof value !== "string" || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return (value === origin || value === origin + "/") && url.origin === origin && url.hostname === "127.0.0.1"
      && url.protocol === "http:" && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

async function responseBytes(response, limit, prefixOnly = false) {
  if (!response.body?.getReader) {
    if (typeof response.text !== "function") throw new Error("body unavailable");
    const bytes = Buffer.from(await response.text());
    if (!prefixOnly && bytes.length > limit) throw new Error("body too large");
    return bytes.subarray(0, limit);
  }
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = limit - length;
      if (!prefixOnly && value.length > remaining) throw new Error("body too large");
      const part = value.subarray(0, remaining); chunks.push(part); length += part.length;
      if (prefixOnly && length === limit) break;
    }
    return Buffer.concat(chunks, length);
  } finally {
    try { await reader.cancel(); } catch { /* The bounded probe never owns the server. */ }
    reader.releaseLock();
  }
}

/** Strict browser-host discovery, never startup, shutdown, registry repair or execution authority. */
export async function probeDeskWeb(registration, fetchImpl = globalThis.fetch, options = {}) {
  if (!registration) return result("absent", "no_registration", "没有 Desk Web 服务登记");
  const expectedVersion = options.expectedVersion ?? DESK_WEB_APP_VERSION;
  const expectedRuntimeId = options.expectedRuntimeId;
  const port = registration.port;
  if (!record(registration) || registration.schema_version !== 1 || registration.service !== "phoenix-desk-tools"
    || registration.host !== "127.0.0.1" || !Number.isInteger(port) || port < 1 || port > 65_535
    || !UUID.test(registration.instance_id ?? "") || !Number.isSafeInteger(registration.pid) || registration.pid <= 0) {
    return result("incompatible", "invalid_registration", "Desk 服务登记身份、回环地址或端口无效");
  }
  if (registration.protocol_version !== 1 || registration.browser_host_protocol !== 1 || registration.identity_path !== DESK_WEB_IDENTITY_PATH) {
    return result("incompatible", "browser_host_required", "已登记服务不是兼容的 Desk 浏览器宿主；旧 API-only 服务不会被替换或关闭");
  }
  const origin = `http://127.0.0.1:${port}`;
  if (registration.app_version !== expectedVersion || !RUNTIME_ID.test(registration.runtime_id ?? "")
    || (expectedRuntimeId !== undefined && registration.runtime_id !== expectedRuntimeId)) {
    return result("incompatible", "runtime_mismatch", "Desk 服务版本或运行真源不匹配；请人工核对已运行服务");
  }
  if (!validWebUrl(registration.web_url, origin)) return result("incompatible", "invalid_web_url", "Desk Web 地址必须与登记 API 使用同一个明确回环 origin");
  let identity;
  try {
    const response = await fetchImpl(origin + DESK_WEB_IDENTITY_PATH, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers: { Accept: "application/json" },
    });
    if (response.status !== 200) return result("incompatible", "identity_unavailable", "登记服务未提供兼容的 Desk 浏览器宿主身份接口");
    if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers?.get?.("content-type") ?? "")) throw new Error("identity is not JSON");
    identity = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await responseBytes(response, MAX_IDENTITY_BYTES)));
  } catch {
    return result("unavailable", "identity_probe_failed", "无法确认登记服务身份；未启动、关闭或删除任何服务");
  }
  if (!record(identity) || identity.schema_version !== 1 || identity.service !== "phoenix-desk-tools"
    || identity.protocol_version !== 1 || identity.browser_host_protocol !== 1 || identity.app_version !== registration.app_version
    || identity.instance_id !== registration.instance_id || identity.pid !== registration.pid || identity.runtime_id !== registration.runtime_id
    || identity.api_origin !== origin || identity.web_url !== registration.web_url
    || !Array.isArray(identity.capabilities) || identity.capabilities.length !== 2
    || !identity.capabilities.includes("browser-web") || !identity.capabilities.includes("local-api")) {
    return result("incompatible", "identity_mismatch", "实际 Desk 宿主身份、版本、地址或能力与登记不一致");
  }
  try {
    const response = await fetchImpl(origin + "/", {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers: { Accept: "text/html" },
    });
    if (response.status !== 200 || !/\btext\/html\b/i.test(response.headers?.get?.("content-type") ?? "")) {
      return result("incompatible", "web_not_html", "登记服务没有提供可打开的 HTML 界面；API-only 服务不能充当浏览器宿主");
    }
    const prefix = new TextDecoder().decode(await responseBytes(response, WEB_PREFIX_BYTES, true));
    if (!/<!doctype\s+html\b|<html(?:\s|>)/i.test(prefix)) return result("incompatible", "web_not_html", "登记服务的首页不是 Desk HTML 页面");
  } catch {
    return result("unavailable", "web_probe_failed", "Desk 页面尚未就绪或发生重定向；未改变已有服务");
  }
  return result("ready", "verified", "已验证并复用兼容的 Desk 浏览器宿主", registration);
}

export async function discoverDeskWeb(env = process.env, fetchImpl = globalThis.fetch, options = {}) {
  const snapshot = registrationSnapshot(env);
  if (!snapshot.registration) {
    const output = snapshot.invalid || snapshot.lockPresent
      ? result("unavailable", snapshot.lockPresent ? "owner_lock_present" : "invalid_registration", "服务登记不可确认；现有锁或登记保持原样，请人工核对")
      : result("absent", "no_registration", "没有 Desk Web 服务登记");
    return { ...output, lock_present: snapshot.lockPresent };
  }
  return { ...await probeDeskWeb(snapshot.registration, fetchImpl, options), lock_present: snapshot.lockPresent };
}
