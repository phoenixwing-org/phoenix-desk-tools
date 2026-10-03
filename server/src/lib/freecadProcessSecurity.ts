import fs from "node:fs";
import path from "node:path";

export const REDACTED_EXTERNAL_VALUE = "[REDACTED]";

const SAFE_SYSTEM_ENVIRONMENT_NAMES = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "__CF_USER_TEXT_ENCODING",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
] as const;

const FREECAD_ADAPTER_ENVIRONMENT_NAMES = new Set([
  "FCD_BATCH_STEP_DIR",
  "FCD_BATCH_OUT_DIR",
  "FCD_BATCH_SKIP_EXISTING",
  "FCD_BATCH_VIEW_FIT_LAST",
  "FCD_BATCH_VIEW_FIT_ALL",
  "FCD_BATCH_REPORT_NAME",
  "FCD_BATCH_PROJECT_TAG",
  "FCD_BATCH_STEP_RECURSIVE",
  "FCD_BATCH_WRITE_REPORT",
  "FCD_BATCH_VERBOSE",
  "PHOENIX_CAD_POINTCHECK_ROOT",
  "PHOENIX_CAD_POINTCHECK_PATHS",
  "PHOENIX_CAD_POINTCHECK_SAVE",
]);

const SENSITIVE_ENVIRONMENT_NAME = /(?:^|_)(?:ACCESS_KEY|API_KEY|AUTH|AUTHORIZATION|BEARER|COOKIE|CREDENTIALS?|ID_TOKEN|PASS(?:WORD|WD)?|PRIVATE_KEY|REFRESH_TOKEN|SECRET|SESSION|TOKEN)(?:$|_)/i;
const ENVIRONMENT_ASSIGNMENT = /(["']?)([A-Za-z_][A-Za-z0-9_]{0,127})\1(\s*(?::|=>|=)\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&\[\]}]+)/g;

function existingFile(candidate: string): string | null {
  try {
    return fs.statSync(candidate).isFile() ? path.resolve(candidate) : null;
  } catch {
    return null;
  }
}

function normalizedCommandPath(candidate: string): string {
  return path.resolve(candidate).replace(/\\/g, "/");
}

function canonicalPath(candidate: string): string {
  const resolved = path.resolve(candidate);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function isFreecadGuiLauncher(candidate: string): boolean {
  return /\/Contents\/MacOS\/FreeCAD$/i.test(normalizedCommandPath(candidate));
}

export function assertSafeFreecadCommand(candidate: string): string {
  const raw = String(candidate || "").trim();
  if (!raw) throw new Error("FreeCADCmd path is required");
  const resolved = path.resolve(raw);
  const canonical = canonicalPath(resolved);
  if (isFreecadGuiLauncher(resolved) || isFreecadGuiLauncher(canonical)) {
    throw new Error(
      "Refusing the FreeCAD GUI launcher because it can expose the parent process environment; "
      + "select the FreeCAD.app directory or Contents/Resources/bin/freecadcmd instead",
    );
  }
  return canonical;
}

export function resolveFreecadCommand(freecadHome: unknown, override?: unknown): string | null {
  const explicit = String(override || "").trim();
  if (explicit) {
    const found = existingFile(explicit);
    return found ? assertSafeFreecadCommand(found) : null;
  }

  const raw = String(freecadHome || "").trim();
  if (!raw) return null;
  const home = path.resolve(raw);
  const candidates = [
    home,
    path.join(home, "Contents", "Resources", "bin", "freecadcmd"),
    path.join(home, "Contents", "MacOS", "FreeCADCmd"),
    path.join(home, "Contents", "Resources", "bin", "FreeCADCmd"),
    path.join(home, "Resources", "bin", "freecadcmd"),
    path.join(home, "Resources", "bin", "FreeCADCmd"),
    path.join(home, "MacOS", "FreeCADCmd"),
    path.join(home, "bin", "freecadcmd"),
    path.join(home, "bin", "FreeCADCmd"),
    path.join(home, "FreeCADCmd"),
    path.join(home, "FreeCADCmd.exe"),
    path.join(home, "bin", "FreeCADCmd.exe"),
  ];
  for (const candidate of candidates) {
    const found = existingFile(candidate);
    if (found) return assertSafeFreecadCommand(found);
  }
  return null;
}

export function normalizeFreecadDirectoryPreference(candidate: unknown): string {
  const raw = String(candidate || "").trim();
  if (!raw) return "";
  const resolved = path.resolve(raw);
  const canonical = canonicalPath(resolved);
  if (isFreecadGuiLauncher(resolved) || isFreecadGuiLauncher(canonical)) {
    throw new Error(
      "Refusing the FreeCAD GUI launcher; select the FreeCAD.app directory instead",
    );
  }
  try {
    if (!fs.statSync(resolved).isDirectory()) {
      throw new Error(`Not a valid FreeCAD directory: ${resolved}`);
    }
  } catch (error: any) {
    if (error?.message?.startsWith("Not a valid FreeCAD directory:")) throw error;
    throw new Error(`Not a valid FreeCAD directory: ${resolved}`);
  }
  if (!resolveFreecadCommand(resolved)) {
    throw new Error(`FreeCADCmd was not found in the configured directory: ${resolved}`);
  }
  return resolved;
}

export function hasSafeFreecadCommand(candidate: unknown): boolean {
  try {
    return Boolean(normalizeFreecadDirectoryPreference(candidate));
  } catch {
    return false;
  }
}

export function isSensitiveEnvironmentName(name: string): boolean {
  return SENSITIVE_ENVIRONMENT_NAME.test(String(name || ""));
}

function environmentValue(
  source: NodeJS.ProcessEnv,
  expectedName: string,
): string | undefined {
  const direct = source[expectedName];
  if (direct != null) return direct;
  if (process.platform !== "win32") return undefined;
  const actualName = Object.keys(source).find((name) => name.toUpperCase() === expectedName);
  return actualName ? source[actualName] : undefined;
}

export function buildFreecadChildEnvironment(
  source: NodeJS.ProcessEnv,
  adapterEnvironment: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {};
  for (const name of SAFE_SYSTEM_ENVIRONMENT_NAMES) {
    const value = environmentValue(source, name.toUpperCase());
    if (value != null) childEnvironment[name] = value;
  }

  // FreeCADCmd is always launched headlessly, including when the screen is locked.
  childEnvironment.QT_QPA_PLATFORM = "offscreen";

  for (const [name, value] of Object.entries(adapterEnvironment)) {
    if (!FREECAD_ADAPTER_ENVIRONMENT_NAMES.has(name) || isSensitiveEnvironmentName(name)) {
      throw new Error(`FreeCAD child environment variable is not allowed: ${name}`);
    }
    if (value != null) childEnvironment[name] = String(value);
  }
  return childEnvironment;
}

export function redactSensitiveText(value: unknown): string {
  let text = String(value ?? "");
  text = text.replace(
    /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
    "[REDACTED PRIVATE KEY]",
  );
  text = text.replace(
    /(\b(?:proxy-)?authorization\b\s*[:=]\s*(?:bearer|basic)\s+)[^\s,;]+/gi,
    `$1${REDACTED_EXTERNAL_VALUE}`,
  );
  text = text.replace(
    /(\bbearer\s+)[A-Za-z0-9._~+/=-]+/gi,
    `$1${REDACTED_EXTERNAL_VALUE}`,
  );
  text = text.replace(
    /(\b(?:cookie|set-cookie)\b\s*:\s*)[^\r\n]*/gi,
    `$1${REDACTED_EXTERNAL_VALUE}`,
  );
  text = text.replace(
    /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi,
    `$1${REDACTED_EXTERNAL_VALUE}@`,
  );
  text = text.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}\b/g,
    REDACTED_EXTERNAL_VALUE,
  );
  text = text.replace(
    /\b(?:sk-(?:proj-)?|github_pat_|gh[opusr]_|npm_)[A-Za-z0-9_-]{8,}\b/gi,
    REDACTED_EXTERNAL_VALUE,
  );
  return text.replace(
    ENVIRONMENT_ASSIGNMENT,
    (match, keyQuote: string, key: string, separator: string, rawValue: string) => {
      if (!isSensitiveEnvironmentName(key)) return match;
      if (/^(?:proxy-)?authorization$/i.test(key) && /^(?:bearer|basic)$/i.test(rawValue)) return match;
      const valueQuote = rawValue.startsWith("\"") || rawValue.startsWith("'") ? rawValue[0] : "";
      return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${REDACTED_EXTERNAL_VALUE}${valueQuote}`;
    },
  );
}

export function redactSensitiveJson<T>(value: T): T {
  if (typeof value === "string") return redactSensitiveText(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveJson(item)) as T;
  if (!value || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = isSensitiveEnvironmentName(key)
      ? REDACTED_EXTERNAL_VALUE
      : redactSensitiveJson(item);
  }
  return sanitized as T;
}

export function truncateExternalProcessText(value: unknown, maxCharacters: number): string {
  const text = String(value ?? "");
  if (text.length <= maxCharacters) return text;
  const marker = `\n[phoenix] external process output truncated (${text.length - maxCharacters} characters omitted)\n`;
  const available = Math.max(0, maxCharacters - marker.length);
  const headLength = Math.min(64 * 1024, Math.floor(available / 3));
  const tailLength = Math.max(0, available - headLength);
  return `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`;
}
