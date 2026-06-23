import { defineStore } from "pinia";
import { ref } from "vue";
import type { CaaDialogIr } from "../types/caaDialogIr";

export const useCaaDialogPageStore = defineStore("caaDialogPage", () => {
  const ir = ref<CaaDialogIr | null>(null);
  const selectedId = ref<string | null>(null);
  const loading = ref(false);
  const errorText = ref("");
  const caaOnline = ref<boolean | null>(null);

  function setIr(value: CaaDialogIr | null) {
    ir.value = value;
  }

  function setSelectedId(id: string | null) {
    selectedId.value = id;
  }

  return {
    ir,
    selectedId,
    loading,
    errorText,
    caaOnline,
    setIr,
    setSelectedId,
  };
});
