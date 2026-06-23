<script setup lang="ts">
import SidebarBlockHead from "./SidebarBlockHead.vue";

const expanded = defineModel<boolean>("expanded", { default: true });

const props = withDefaults(
  defineProps<{
    title: string;
    /** strip：侧栏条带（日志/Git 提交）；card：带外框的属性块 */
    variant?: "strip" | "card";
    /** 内容区超出时在 block 内滚动（标题/底栏固定） */
    bodyScroll?: boolean;
    /** 标题行可点击折叠 */
    collapsible?: boolean;
    ariaLabel?: string;
  }>(),
  {
    variant: "strip",
    bodyScroll: false,
    collapsible: true,
  },
);

const emit = defineEmits<{
  toggle: [expanded: boolean];
}>();

function onHeadToggle() {
  if (!props.collapsible) return;
  expanded.value = !expanded.value;
  emit("toggle", expanded.value);
}
</script>

<template>
  <section
    class="sidebar-block"
    :class="[
      `sidebar-block--${variant}`,
      {
        'sidebar-block--body-scroll': bodyScroll,
        'sidebar-block--collapsed': collapsible && !expanded,
      },
    ]"
    :aria-label="ariaLabel ?? title"
  >
    <SidebarBlockHead
      class="sidebar-block-head-wrap"
      :expanded="expanded"
      :collapsible="collapsible"
      @toggle="onHeadToggle"
    >
      <template #title>
        <slot name="title">{{ title }}</slot>
      </template>
      <template v-if="$slots.suffix" #suffix>
        <slot name="suffix" />
      </template>
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </SidebarBlockHead>
    <div v-show="!collapsible || expanded" class="sidebar-block-body">
      <slot />
    </div>
    <footer v-show="$slots.footer && (!collapsible || expanded)" class="sidebar-block-foot">
      <slot name="footer" />
    </footer>
  </section>
</template>

<style scoped>
.sidebar-block {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
  background: var(--sidebar-bg);
}

.sidebar-block--strip .sidebar-block-head-wrap {
  width: 100%;
  border-bottom: 1px solid var(--border);
  background: var(--panel-head-bg);
}

.sidebar-block--card {
  margin: 0 0 4px;
  border: none;
  border-top: 2px solid var(--border-strong);
  border-bottom: 2px solid var(--border-strong);
  border-radius: 0;
  background: var(--phoenix-bg-elevated);
  box-shadow: none;
}

.sidebar-block--card .sidebar-block-head-wrap {
  width: 100%;
  border-bottom: 1px solid var(--border);
  background: var(--panel-head-bg);
  border-radius: 0;
}

.sidebar-block--card.sidebar-block--collapsed .sidebar-block-head-wrap {
  border-bottom: none;
}

.sidebar-block-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-block--strip:not(.sidebar-block--collapsed) .sidebar-block-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 8px 10px;
}

.sidebar-block--body-scroll .sidebar-block-body {
  overflow: auto;
  overscroll-behavior: contain;
}

.sidebar-block--collapsed {
  flex: 0 0 auto !important;
  height: auto !important;
  min-height: 0;
}

.sidebar-block:not(.sidebar-block--collapsed) {
  flex: 1 1 auto;
  min-height: 0;
}

.sidebar-block-foot {
  flex-shrink: 0;
  padding: 8px 10px;
  border-top: 1px solid var(--el-border-color-extra-light);
}
</style>
