import net from "node:net";

export const DEV_UI_PREFERRED_PORT = 49_373;
export const DEV_UI_PORT_ATTEMPTS = 32;

export function parsePreferredUiPort(value, fallback = DEV_UI_PREFERRED_PORT) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`WEB_UI_PORT must be an integer in 1..65535, received: ${text}`);
  }
  return port;
}

export function canListenOnLocalhost(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    const done = (available) => {
      server.removeAllListeners();
      try { server.close(); } catch { /* the server never listened */ }
      resolve(available);
    };
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => done(true));
  });
}

export async function selectDevUiPort({
  preferredPort = DEV_UI_PREFERRED_PORT,
  attempts = DEV_UI_PORT_ATTEMPTS,
  canListen = canListenOnLocalhost,
} = {}) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = preferredPort + offset;
    if (port > 65_535) break;
    if (await canListen(port)) return port;
  }
  const lastPort = Math.min(65_535, preferredPort + attempts - 1);
  throw new Error(`Desk Tools dev UI has no free port in ${preferredPort}..${lastPort}`);
}

export async function resolveDevUiPort(
  env = process.env,
  canListen = canListenOnLocalhost,
) {
  const explicit = String(env.WEB_UI_PORT ?? "").trim();
  const preferredPort = parsePreferredUiPort(explicit);
  return selectDevUiPort({
    preferredPort,
    attempts: explicit ? 1 : DEV_UI_PORT_ATTEMPTS,
    canListen,
  });
}

export function createTauriDevConfigOverride(port) {
  const origin = `http://localhost:${port}`;
  return {
    build: { devUrl: origin },
    app: {
      security: {
        devCsp: [
          `default-src 'self' ${origin}`,
          `connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:* ${origin} ws://localhost:${port}`,
          `img-src 'self' asset: http://asset.localhost data: blob:`,
          `style-src 'self' 'unsafe-inline' ${origin}`,
          "font-src 'self' data:",
        ].join("; "),
      },
    },
  };
}
