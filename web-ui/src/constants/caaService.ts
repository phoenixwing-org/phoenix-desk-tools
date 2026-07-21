/** Node 后端服务默认端口（与 server/、vite proxy 一致） */
export const CAA_SERVICE_DEFAULT_PORT = 48_375;

/** 统一 Node API 中的 CAA 路径。 */
export const CAA_SERVICE_PROXY_PATH = "/api/caa";

export function caaServiceBaseUrl(port = CAA_SERVICE_DEFAULT_PORT): string {
  return `http://127.0.0.1:${port}`;
}
