import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Hono, MiddlewareHandler } from "hono";
import { DESK_TOOLS_APP_VERSION } from "../../lib/deskToolsRegistration.js";

export interface BrowserHostOptions {
  readonly origin: () => string;
  readonly instanceId: string;
  readonly startedAt: string;
  readonly runtimeId: string;
  readonly webRoot: string;
  readonly assetDigests?: Readonly<Record<string, string>>;
}

const MIME: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".eot": "application/vnd.ms-fontobject", ".wasm": "application/wasm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm",
};
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const sameIdentity = (left: fs.Stats, right: fs.Stats): boolean => left.dev === right.dev && left.ino === right.ino;
const isApiPath = (value: string): boolean => value === "/api" || value.startsWith("/api/");

function snapshotAssetDigests(value: BrowserHostOptions["assetDigests"]): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new Error("Browser Web asset digests must be a plain record");
  const snapshot: Record<string, string> = Object.create(null);
  const keys = Reflect.ownKeys(value);
  if (keys.length > 10_000) throw new Error("Browser Web asset digest map exceeds the file budget");
  for (const key of keys) {
    if (typeof key !== "string" || !key || key.length > 2048 || key !== key.trim() || /[\\:%\p{Cc}\p{Cf}\p{Cs}]/u.test(key)
      || key.split("/").some(segment => !segment || segment.startsWith(".") || ["node_modules", "__pycache__"].includes(segment.toLowerCase()))) throw new Error("Browser Web asset digest has an unsafe relative path");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" || !/^[a-f0-9]{64}$/iu.test(descriptor.value)) throw new Error("Browser Web asset digest must be a SHA-256 value");
    snapshot[key] = descriptor.value.toLowerCase();
  }
  return Object.freeze(snapshot);
}

function selectedRoot(value: string): { root: string; identity: fs.Stats } {
  if (!path.isAbsolute(value)) throw new Error("Browser host requires an explicit absolute Web build directory");
  const root = path.resolve(value);
  // Do not silently resolve a user-selected symlink or a symlink ancestor.
  let current = path.parse(root).root;
  for (const segment of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Browser Web build path must contain only real directories");
  }
  const identity = fs.lstatSync(root), index = fs.lstatSync(path.join(root, "index.html"));
  if (!identity.isDirectory() || !index.isFile() || index.isSymbolicLink() || index.size < 1 || index.size > 4 * 1024 * 1024) throw new Error("Browser Web build is missing a regular index.html");
  return { root, identity };
}

function staticRelativePath(rawPath: string): { rel: string; mime: string; index: boolean } | null {
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); } catch { return null; }
  if (/[\\:%\p{Cc}\p{Cf}\p{Cs}]/u.test(decoded)) return null;
  if (decoded === "/" || decoded === "/index.html") return { rel: "index.html", mime: "text/html; charset=utf-8", index: true };
  const rel = decoded.slice(1), segments = rel.split("/");
  if (!decoded.startsWith("/") || segments.some(segment => !segment || segment.startsWith(".") || ["node_modules", "__pycache__"].includes(segment.toLowerCase()))) return null;
  // Public build assets only, never arbitrary JSON/configuration, maps, source,
  // database files or a listing of the explicit root.
  if (!decoded.startsWith("/assets/") && !["/favicon.svg", "/favicon.ico", "/favicon.png", "/apple-touch-icon.png"].includes(decoded)) return null;
  const mime = MIME[path.extname(rel).toLowerCase()];
  return mime ? { rel, mime, index: false } : null;
}

function readStaticFile(root: string, rootIdentity: fs.Stats, rel: string, index: boolean): Buffer | null {
  const filename = path.join(root, ...rel.split("/"));
  const directories: Array<{ filename: string; identity: fs.Stats }> = [{ filename: root, identity: rootIdentity }];
  let descriptor: number | undefined;
  try {
    let current = root;
    for (const segment of rel.split("/").slice(0, -1)) {
      current = path.join(current, segment);
      const identity = fs.lstatSync(current);
      if (!identity.isDirectory() || identity.isSymbolicLink()) return null;
      directories.push({ filename: current, identity });
    }
    const checkDirectories = () => directories.every(directory => {
      const now = fs.lstatSync(directory.filename);
      return now.isDirectory() && !now.isSymbolicLink() && sameIdentity(directory.identity, now);
    });
    if (!checkDirectories() || fs.realpathSync(filename) !== filename) return null;
    const beforePath = fs.lstatSync(filename);
    if (!beforePath.isFile() || beforePath.isSymbolicLink()) return null;
    descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(descriptor), limit = index ? 4 * 1024 * 1024 : MAX_ASSET_BYTES;
    if (!before.isFile() || !sameIdentity(beforePath, before) || before.size < 0 || before.size > limit) return null;
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) { const amount = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset); if (!amount) return null; offset += amount; }
    const after = fs.fstatSync(descriptor), afterPath = fs.lstatSync(filename);
    if (!sameIdentity(before, after) || !sameIdentity(after, afterPath) || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || afterPath.isSymbolicLink() || !checkDirectories() || fs.realpathSync(filename) !== filename) return null;
    return bytes;
  } catch { return null; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

/** Opt-in browser transport. It owns neither service startup nor a CAD session. */
export function createBrowserHost(options: BrowserHostOptions) {
  if (!options.instanceId.trim() || !options.runtimeId.trim() || !Number.isFinite(Date.parse(options.startedAt))) throw new Error("Browser host identity is incomplete");
  const { root, identity } = selectedRoot(options.webRoot);
  const assetDigests = snapshotAssetDigests(options.assetDigests);
  function origin(): URL {
    const raw = options.origin(), value = new URL(raw);
    if (value.protocol !== "http:" || value.hostname !== "127.0.0.1" || value.username || value.password || value.pathname !== "/" || value.search || value.hash) throw new Error("Browser host origin is unavailable");
    return value;
  }
  function isAllowedOrigin(value: string): boolean {
    if (!value) return true;
    try { return value === origin().origin; } catch { return false; }
  }
  const guard: MiddlewareHandler = async (c, next) => {
    let expected: URL;
    try { expected = origin(); } catch { return c.json({ code: "browser_host_unavailable", detail: "Browser service is not ready" }, 503); }
    if (c.req.header("Host") !== expected.host) return c.json({ code: "host_forbidden", detail: "Host is not allowed for this local service" }, 403);
    if (isApiPath(c.req.path) && !isAllowedOrigin(c.req.header("Origin") || "")) return c.json({ code: "origin_forbidden", detail: "Origin is not allowed for this local service" }, 403);
    c.header("X-Content-Type-Options", "nosniff");
    await next();
  };
  function mountRoutes(app: Hono): void {
    app.get("/api/desk-service", c => {
      const apiOrigin = origin().origin;
      c.header("Cache-Control", "no-store");
      return c.json({ schema_version: 1, service: "phoenix-desk-tools", protocol_version: 1, browser_host_protocol: 1,
        app_version: DESK_TOOLS_APP_VERSION, instance_id: options.instanceId, pid: process.pid, started_at: options.startedAt,
        runtime_id: options.runtimeId, api_origin: apiOrigin, web_url: `${apiOrigin}/`, capabilities: ["browser-web", "local-api"] });
    });
    app.on(["GET", "HEAD"], "*", (c, next) => {
      if (isApiPath(c.req.path)) return next();
      const target = staticRelativePath(new URL(c.req.url).pathname);
      if (!target) return c.notFound();
      const changedBuild = () => {
        c.header("Cache-Control", "no-store");
        return c.json({ code: "web_build_changed", detail: "Web build changed or is incomplete; restart this browser service with the current build" }, 503);
      };
      if (assetDigests && !Object.hasOwn(assetDigests, target.rel)) return changedBuild();
      const bytes = readStaticFile(root, identity, target.rel, target.index);
      if (!bytes) return assetDigests ? changedBuild() : c.notFound();
      if (assetDigests && createHash("sha256").update(bytes).digest("hex") !== assetDigests[target.rel]) return changedBuild();
      return new Response(c.req.method === "HEAD" ? null : new Uint8Array(bytes), { status: 200, headers: {
        "Content-Type": target.mime, "Content-Length": String(bytes.length), "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": target.index ? "no-cache" : "public, max-age=3600",
      } });
    });
  }
  return { guard, isAllowedOrigin, mountRoutes };
}
