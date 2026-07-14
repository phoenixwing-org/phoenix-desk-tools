import { driver } from "driver.js";
import type { Config } from "driver.js";
import "driver.js/dist/driver.css";
import { PAGE_HELP } from "../content/pageHelp";

const DRIVER_OPTS: Config = {
  showProgress: true,
  progressText: "{{current}} / {{total}}",
  nextBtnText: "下一步",
  prevBtnText: "上一步",
  doneBtnText: "完成",
  showButtons: ["next", "previous", "close"],
};

/** 启动当前页高亮导引（driver.js，仅本页步骤） */
function resolveSteps(pageId: string) {
  const raw = PAGE_HELP[pageId]?.tourSteps ?? [];
  return raw.filter((s) => {
    const el = s.element;
    if (typeof el !== "string") return true;
    try {
      return document.querySelector(el) != null;
    } catch {
      return false;
    }
  });
}

export function startPageTour(pageId: string): boolean {
  const steps = resolveSteps(pageId);
  if (!steps.length) return false;
  const d = driver({ ...DRIVER_OPTS, steps });
  d.drive();
  return true;
}
