<script setup lang="ts">
import { computed } from "vue";
import PrimarySection from "phoenix-wing/layout/PnwPrimarySection.vue";
import { useCaaDialogPageStore } from "../../stores/caaDialogPage";
import { toCaaElTreeRoots, type CaaElTreeNode } from "../../utils/caaDialogTree";
import { CONTROL_ICONS } from "../../assets/caa/controlIcons";

const store = useCaaDialogPageStore();

const expanded = defineModel<boolean>("expanded", { default: true });

const treeData = computed(() => toCaaElTreeRoots(store.ir));

const currentNodeKey = computed(() => store.selectedId ?? store.ir?.dialogName ?? undefined);

function onNodeClick(data: CaaElTreeNode) {
  store.setSelectedId(data.id);
}

const ICON_FALLBACK = CONTROL_ICONS.Dialog;

function iconSrc(name?: string) {
  return (name && CONTROL_ICONS[name]) || ICON_FALLBACK;
}
</script>

<template>
  <PrimarySection
    v-model:expanded="expanded"
    class="caa-dialog-tree-panel"
    title="控件树"
    aria-label="CAA 对话框控件树"
  >
    <div class="caa-tree-body">
      <el-tree
        v-if="store.ir"
        class="caa-tree"
        :data="treeData"
        node-key="id"
        default-expand-all
        highlight-current
        :current-node-key="currentNodeKey"
        @node-click="onNodeClick"
      >
        <template #default="{ data }">
          <span class="caa-tree-node">
            <img :src="iconSrc(data.icon)" class="caa-tree-icon" alt="" />
            <span>{{ data.label }}</span>
          </span>
        </template>
      </el-tree>
      <p v-else class="muted small caa-tree-empty">加载对话框后显示控件层次</p>
    </div>
  </PrimarySection>
</template>

<style scoped>
.caa-tree-body {
  min-width: 0;
  padding: 8px;
  box-sizing: border-box;
  overflow: auto;
}

.caa-tree {
  font-size: 0.78rem;
  background: transparent;
}

.caa-tree-empty {
  margin: 0;
}

.caa-tree-node {
  display: flex;
  align-items: center;
  gap: 3px;
}

.caa-tree-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0.7;
}
</style>
