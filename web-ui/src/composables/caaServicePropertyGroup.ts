import { computed } from "vue";
import {
  CAA_SERVICE_DEFAULT_PORT,
  CAA_SERVICE_PROXY_PATH,
  caaServiceBaseUrl,
} from "../constants/caaService";
import { useCaaDialogPageStore } from "../stores/caaDialogPage";
import { pnwPropGroup, pnwPropReadonly } from "phoenix-wing";
import type { PnwPagePropertyGroup } from "phoenix-wing";

/** 统一 Node 服务中的 CAA API 状态。 */
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
    pnwPropReadonly("caa_api", "API 路径", {
      value: computed(() => CAA_SERVICE_PROXY_PATH),
      mono: true,
      hint: "由统一 Phoenix Node 服务提供",
    }),
    pnwPropReadonly("caa_health", "健康检查", {
      value: computed(() => `${CAA_SERVICE_PROXY_PATH}/health`),
      mono: true,
    }),
  ]);
}
