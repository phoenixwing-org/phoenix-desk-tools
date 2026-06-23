/** CAA Node 服务默认端口（与 server/caa、vite proxy 一致） */
export const CAA_SERVICE_DEFAULT_PORT = 5180;

/** Phoenix Python API 开发默认端口 */
export const PHOENIX_API_DEFAULT_PORT = 8765;

/** Vite 开发代理路径 */
export const CAA_SERVICE_PROXY_PATH = "/api/caa";

export function caaServiceBaseUrl(port = CAA_SERVICE_DEFAULT_PORT): string {
  return `http://127.0.0.1:${port}`;
}

/** 侧栏属性 · 离线时的启动说明（多行） */
export function formatCaaServiceStartHint(): string {
  return [
    "1. 仓库根目录：pnpm dev:caa",
    "2. 并行保持：python -m phoenix.web --dev",
    "3. 开发时 Web 将 /api/caa 代理到 CAA 端口",
    `4. 自定义端口：CAA_SERVER_PORT=${CAA_SERVICE_DEFAULT_PORT} pnpm dev:caa`,
  ].join("\n");
}
