import { defineStore } from "pinia";
import { ref } from "vue";
import type { CaaHealthPayload } from "../api/caaDialog";
import type { CaaDialogIr } from "../types/caaDialogIr";
import { CAA_SERVICE_DEFAULT_PORT, caaServiceBaseUrl } from "../constants/caaService";

/** 当前激活的 CAA 编辑 Tab 同步到此 store，供侧栏控件树 / 属性面板读取。 */
export const useCaaDialogPageStore = defineStore("caaDialogPage", () => {
  const ir = ref<CaaDialogIr | null>(null);
  const selectedId = ref<string | null>(null);
  const loading = ref(false);
  const errorText = ref("");
  const caaOnline = ref<boolean | null>(null);
  const caaServicePort = ref<number>(CAA_SERVICE_DEFAULT_PORT);
  const caaServiceUrl = ref<string>(caaServiceBaseUrl());

  function setCaaHealth(health: CaaHealthPayload | null, online: boolean) {
    caaOnline.value = online;
    if (health?.port) {
      caaServicePort.value = health.port;
      caaServiceUrl.value = health.url ?? caaServiceBaseUrl(health.port);
    } else if (!online) {
      caaServicePort.value = CAA_SERVICE_DEFAULT_PORT;
      caaServiceUrl.value = caaServiceBaseUrl(CAA_SERVICE_DEFAULT_PORT);
    }
  }

  function setIr(value: CaaDialogIr | null) {
    ir.value = value;
  }

  function setSelectedId(id: string | null) {
    selectedId.value = id;
  }

  function clearEditor() {
    ir.value = null;
    selectedId.value = null;
    errorText.value = "";
    loading.value = false;
  }

  return {
    ir,
    selectedId,
    loading,
    errorText,
    caaOnline,
    caaServicePort,
    caaServiceUrl,
    setCaaHealth,
    setIr,
    setSelectedId,
    clearEditor,
  };
});
