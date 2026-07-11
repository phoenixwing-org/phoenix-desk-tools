const DEV_UI_PORT = "5173";

export function isAllowedPhoenixUiOrigin(origin: string): boolean {
  const raw = String(origin || "").trim();
  if (!raw) return true;
  if (raw === "tauri://localhost") return true;
  try {
    const url = new URL(raw);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname === "tauri.localhost") {
      return !url.port;
    }
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    return url.protocol === "http:" && loopback && url.port === DEV_UI_PORT;
  } catch {
    return false;
  }
}
