import { computed } from "vue";
import {
  CAA_SERVICE_DEFAULT_PORT,
  CAA_SERVICE_PROXY_PATH,
  PHOENIX_API_DEFAULT_PORT,
  caaServiceBaseUrl,
  formatCaaServiceStartHint,
} from "../constants/caaService";
import { useCaaDialogPageStore } from "../stores/caaDialogPage";
import { pnwPropGroup, pnwPropReadonly } from "phoenix-wing";
import type { PnwPagePropertyGroup } from "phoenix-wing";

/** CAA 服务 · 侧栏属性分组（端口、代理、启动说明） */
export function caaServicePropertyGroup(): PnwPagePropertyGroup {
  const store = useCaaDialogPageStore();

  const port = computed(() => store.caaServicePort ?? CAA_SERVICE_DEFAULT_PORT);
  const serviceUrl = computed(() => store.caaServiceUrl || caaServiceBaseUrl(port.value));

  return pnwPropGroup("caa_service", "CAA 服务", [
    pnwPropReadonly("caa_status", "状态", {
      value: computed(() => {
        if (store.caaOnline === true) return "在线";
        if (store.caaOnline === false) return "离线";
        return "检测中…";
      }),
    }),
    pnwPropReadonly("caa_port", "端口", {
      value: computed(() => port.value),
      mono: true,
    }),
    pnwPropReadonly("caa_url", "服务地址", {
      value: computed(() => serviceUrl.value),
      mono: true,
    }),
    pnwPropReadonly("caa_proxy", "Web 代理", {
      value: computed(() => `${CAA_SERVICE_PROXY_PATH} → :${port.value}`),
      mono: true,
      hint: "开发模式由 Vite 转发；生产由 Phoenix 或反向代理配置",
    }),
    pnwPropReadonly("phoenix_api", "Phoenix API", {
      value: computed(
        () => `http://127.0.0.1:${PHOENIX_API_DEFAULT_PORT} · python -m phoenix.web --dev`,
      ),
      mono: true,
      hint: "Code 索引、工作空间等 /api（非 /api/caa）",
    }),
    pnwPropReadonly("caa_health", "健康检查", {
      value: computed(() => `${CAA_SERVICE_PROXY_PATH}/health`),
      mono: true,
    }),
    pnwPropReadonly("caa_start", "如何启动", {
      value: computed(() => formatCaaServiceStartHint()),
      multiline: true,
      hidden: computed(() => store.caaOnline === true),
    }),
  ]);
}
