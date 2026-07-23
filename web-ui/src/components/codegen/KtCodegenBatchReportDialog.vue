<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import {
  ktCodegenDefineApplyReportElements,
  type KtCodegenApplyReport,
  type KtCodegenApplyReportActionDetail,
} from "@phoenix-wing/kt-codegen/ui";
import type { KtCodegenBatchReport } from "../../models/ktCodegenBatchReport";

const props = defineProps<{ report: KtCodegenBatchReport | null }>();
const emit = defineEmits<{ action: [detail: KtCodegenApplyReportActionDetail] }>();
const open = defineModel<boolean>({ default: false });
const reportRef = ref<KtCodegenApplyReport | null>(null);

ktCodegenDefineApplyReportElements();

watch(() => props.report, async (value) => {
  await nextTick();
  if (reportRef.value) reportRef.value.model = value ?? undefined;
}, { immediate: true, deep: true });

function forwardAction(event: Event): void {
  emit("action", (event as CustomEvent<KtCodegenApplyReportActionDetail>).detail);
}
</script>

<template>
  <el-dialog
    v-model="open"
    width="min(1040px, 94vw)"
    append-to-body
    destroy-on-close
    title="Codegen 全部应用报告"
  >
    <kt-codegen-apply-report
      ref="reportRef"
      @kt-codegen-apply-report-action="forwardAction"
    />
  </el-dialog>
</template>
