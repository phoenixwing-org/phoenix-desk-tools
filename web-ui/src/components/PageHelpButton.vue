<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { getPageHelp, hasPageTour, type PageHelpContent } from "../content/pageHelp";
import { startPageTour } from "../composables/usePageTour";
import { useAppShell } from "../composables/useAppShell";

const props = defineProps<{
  pageId: string;
  content?: PageHelpContent;
}>();

const shell = useAppShell();
const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});

const help = computed(() => props.content ?? getPageHelp(props.pageId));
const canTour = computed(() => hasPageTour(props.pageId));

const POPOVER_WIDTH = 320;
const VIEWPORT_PAD = 8;

async function positionPopover() {
  await nextTick();
  const btn = rootRef.value?.querySelector(".page-help-btn");
  if (!(btn instanceof HTMLElement)) return;
  const r = btn.getBoundingClientRect();
  const maxW = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_PAD * 2);
  let left = r.left;
  if (left + maxW > window.innerWidth - VIEWPORT_PAD) {
    left = window.innerWidth - maxW - VIEWPORT_PAD;
  }
  left = Math.max(VIEWPORT_PAD, left);
  popoverStyle.value = {
    top: `${r.bottom + 6}px`,
    left: `${left}px`,
    width: `${maxW}px`,
  };
}

async function toggle() {
  open.value = !open.value;
  if (open.value) await positionPopover();
}

function close() {
  open.value = false;
}

function onViewportChange() {
  if (open.value) void positionPopover();
}

function onPageTour() {
  close();
  if (props.pageId === "home") {
    shell.openOnboardingGuide();
    return;
  }
  if (!startPageTour(props.pageId)) {
    shell.setStatus("本页暂无可高亮的导引步骤（可能尚未加载完）");
  }
}

function onDocOutside(e: MouseEvent) {
  if (!open.value || !rootRef.value) return;
  const t = e.target;
  if (!(t instanceof Node)) return;
  if (rootRef.value.contains(t)) return;
  if (t instanceof Element && t.closest(".page-help-popover")) return;
  close();
}

onMounted(() => {
  document.addEventListener("click", onDocOutside);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
});
onUnmounted(() => {
  document.removeEventListener("click", onDocOutside);
  window.removeEventListener("resize", onViewportChange);
  window.removeEventListener("scroll", onViewportChange, true);
});
</script>

<template>
  <div ref="rootRef" class="page-help">
    <button
      type="button"
      class="page-help-btn"
      :aria-expanded="open"
      aria-haspopup="dialog"
      title="本页说明与导引"
      @click.stop="toggle"
    >
      ?
    </button>
    <div v-if="open" class="page-help-popover" role="dialog" @click.stop>
      <p class="popover-title">{{ help.title }}</p>
      <ul class="popover-list">
        <li v-for="(line, i) in help.bullets" :key="i">{{ line }}</li>
      </ul>
      <p v-if="help.docPath" class="popover-doc">详见仓库 {{ help.docPath }}</p>
      <div class="popover-actions">
        <button v-if="canTour || pageId === 'home'" type="button" class="btn-tour" @click="onPageTour">
          {{ pageId === "home" ? "跳到新手指南" : "本页导引" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-help {
  position: relative;
  flex-shrink: 0;
}

.page-help-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--btn-bg);
  color: var(--muted);
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1;
}

.page-help-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: #f0f6ff;
}

.page-help-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  left: auto;
  z-index: 200;
  width: min(320px, 70vw);
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  font-size: 0.82rem;
  line-height: 1.55;
}

.popover-title {
  margin: 0 0 8px;
  font-weight: 600;
}

.popover-list {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--text);
}

.popover-doc {
  margin: 10px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.popover-actions {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #eef2f7;
}

.btn-tour {
  padding: 6px 14px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 0.82rem;
}
</style>
