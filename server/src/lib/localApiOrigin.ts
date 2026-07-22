const DEV_UI_PREFERRED_PORT = 49_373;
const DEV_UI_PORT_ATTEMPTS = 32;

function isAllowedDevUiPort(port: string, env: NodeJS.ProcessEnv): boolean {
  const parsed = Number(port);
  if (!Number.isInteger(parsed)) return false;
  if (parsed >= DEV_UI_PREFERRED_PORT && parsed < DEV_UI_PREFERRED_PORT + DEV_UI_PORT_ATTEMPTS) {
    return true;
  }
  const configured = Number(String(env.WEB_UI_PORT || "").trim());
  return Number.isInteger(configured) && configured >= 1 && configured <= 65_535 && parsed === configured;
}

export function isAllowedPhoenixUiOrigin(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(origin || "").trim();
  if (!raw) return true;
  if (raw === "tauri://localhost") return true;
  try {
    const url = new URL(raw);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname === "tauri.localhost") {
      return !url.port;
    }
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    return url.protocol === "http:" && loopback && isAllowedDevUiPort(url.port, env);
  } catch {
    return false;
  }
}
