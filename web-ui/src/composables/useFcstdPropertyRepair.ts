import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { analyzeFcstdProperties, applyFcstdPropertyRepairs, type FcstdPropertyAnalysis, type FcstdPropertyRepairResult } from "../api";

export function useFcstdPropertyRepair(scope: Ref<string>, directory: Ref<string>) {
  const analysis = ref<FcstdPropertyAnalysis | null>(null);
  const result = ref<FcstdPropertyRepairResult | null>(null);
  const selected = ref<string[]>([]);
  const analyzing = ref(false);
  const applying = ref(false);
  const error = ref("");
  let generation = 0;
  function reset() {
    generation += 1;
    analysis.value = null;
    result.value = null;
    selected.value = [];
    error.value = "";
  }
  watch(scope, reset, { flush: "sync" });
  onScopeDispose(reset);
  const canApply = computed(() => Boolean(analysis.value && selected.value.length && !result.value && !analyzing.value && !applying.value));
  async function analyze() {
    reset();
    const request = generation;
    analyzing.value = true;
    try {
      const data = await analyzeFcstdProperties(directory.value.trim() || ".");
      if (request !== generation) return;
      analysis.value = data;
      selected.value = data.files.map(file => file.rel);
    } catch (e) {
      if (request === generation) error.value = String(e);
    } finally { analyzing.value = false; }
  }
  async function apply() {
    if (!canApply.value) return;
    const request = generation;
    const plan = analysis.value!;
    applying.value = true;
    try {
      const data = await applyFcstdPropertyRepairs(plan.plan_id, [...selected.value]);
      if (request === generation) result.value = data;
    } catch (e) {
      if (request === generation) error.value = String(e);
    } finally {
      if (request === generation) selected.value = [];
      applying.value = false;
    }
  }
  return { analysis, result, selected, analyzing, applying, error, canApply, analyze, apply, reset };
}
