<script setup lang="ts">
/**
 * CAA 控件右键菜单。
 * 显示/隐藏由 CaaControlContext 管理，每个控件自行构建菜单项。
 */
import { computed, inject, onMounted, onUnmounted, watch } from "vue";
import { CAA_CONTROL_KEY, type CaaContextMenuItem } from "../../composables/useCaaControlContext";

const ctx = inject(CAA_CONTROL_KEY, null);

const visible = computed(() => ctx?.contextMenuVisible.value ?? false);
const items = computed(() => ctx?.contextMenuItems.value ?? []);
const position = computed(() => ctx?.contextMenuPosition.value ?? { x: 0, y: 0 });
const targetId = computed(() => ctx?.contextMenuTargetId.value ?? "");

/** 弹窗定位，防止溢出视口 */
const popStyle = computed(() => {
  const { x, y } = position.value;
  // 默认向右下展开；若近右/下边缘则反向
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = 200; // 估算菜单宽度
  const h = Math.min(items.value.length * 36 + 16, 360);
  return {
    left: `${x + w > vw ? x - w : x}px`,
    top: `${y + h > vh ? y - h : y}px`,
  };
});

const hasDivider = (idx: number) => idx > 0 && items.value[idx]?.divider;

function onAction(item: CaaContextMenuItem) {
  item.action();
  ctx?.hideContextMenu();
}

/** 点击外部关闭 */
function onWindowClick() {
  if (!visible.value) return;
  ctx?.hideContextMenu();
}
/** Escape 关闭 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") ctx?.hideContextMenu();
}

watch(visible, (on) => {
  if (on) {
    setTimeout(() => {
      window.addEventListener("click", onWindowClick, { once: true });
    }, 0);
  }
});

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="caa-ctxmenu" :style="popStyle" @click.stop>
      <div class="caa-ctxmenu-header mono muted">{{ targetId }}</div>
      <template v-for="(item, idx) in items" :key="idx">
        <div v-if="hasDivider(idx)" class="caa-ctxmenu-divider" />
        <button
          class="caa-ctxmenu-item"
          :class="{ 'caa-ctxmenu-item--disabled': item.disabled }"
          :disabled="item.disabled"
          @click="onAction(item)"
        >
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.caa-ctxmenu {
  position: fixed;
  z-index: 9999;
  min-width: 180px;
  max-width: 260px;
  background: #fff;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.14);
  padding: 4px 0;
  font-size: 0.78rem;
}

.caa-ctxmenu-header {
  padding: 3px 10px 5px;
  font-size: 0.68rem;
  border-bottom: 1px solid var(--border, #e2e8f0);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.caa-ctxmenu-divider {
  height: 0;
  border-top: 1px solid var(--border, #e2e8f0);
  margin: 3px 6px;
}

.caa-ctxmenu-item {
  display: block;
  width: 100%;
  padding: 5px 10px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-size: inherit;
  color: var(--text, #1e293b);
  border-radius: 0;
}

.caa-ctxmenu-item:hover:not(:disabled) {
  background: var(--accent-light, #eff6ff);
  color: var(--accent, #2563eb);
}

.caa-ctxmenu-item--disabled,
.caa-ctxmenu-item:disabled {
  color: var(--muted, #94a3b8);
  cursor: default;
}
</style>
