import { computed } from "vue";
import { useAppShell } from "./useAppShell";
import { useOnboardingStore } from "../stores/onboarding";
import { FREECAD_TASK_MSG } from "../utils/onboardingConstants";

/** STEP 批量、SW→STEP 等需本机 FreeCAD 目录的任务门禁 */
export function useFreecadTaskGate() {
  const shell = useAppShell();
  const onboarding = useOnboardingStore();

  const blocked = computed(() => !onboarding.freecadOk);

  function assertFreecadForTask(): boolean {
    if (onboarding.freecadOk) return true;
    shell.setStatus(FREECAD_TASK_MSG);
    shell.goToPage("config");
    return false;
  }

  return { blocked, assertFreecadForTask, hint: FREECAD_TASK_MSG };
}
