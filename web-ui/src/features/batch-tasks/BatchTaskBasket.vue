<script setup lang="ts">
import { computed } from "vue";
import { useBatchTaskCollection } from "./collection";

const props = defineProps<{ workspace: string; disabled?: boolean }>();
const emit = defineEmits<{ import: [paths: readonly string[]] }>();
const collection = useBatchTaskCollection();
const paths = computed(() => collection.pathsFor(props.workspace));
const warning = computed(() => collection.warningFor(props.workspace));
function importPaths() {
  if (props.disabled || !paths.value.length) return;
  emit("import", [...paths.value]);
}
</script>

<template>
  <section class="batch-basket" aria-label="批次待选文件">
    <div class="basket-header">
      <span>待选 {{ paths.length }} 个文件 <span class="muted">· 尚未保存为任务</span></span>
      <div class="basket-actions">
        <button type="button" :disabled="disabled || !paths.length" @click="collection.clear(workspace)">清空待选</button>
        <button type="button" :disabled="disabled || !paths.length" @click="importPaths">追加到当前草稿（{{ paths.length }}）</button>
      </div>
    </div>
    <p class="muted">从树、图册或文件详情点击「加入批次」。只收集明确文件，不展开目录、不自动运行；追加不会替换草稿中的文件。</p>
    <p v-if="warning" role="alert" class="basket-warning">{{ warning }}</p>
    <ul v-if="paths.length" class="basket-files">
      <li v-for="rel in paths" :key="rel"><span>{{ rel }}</span><button type="button" :disabled="disabled" :aria-label="`移除待选 ${rel}`" @click="collection.remove(workspace, rel)">移除</button></li>
    </ul>
  </section>
</template>

<style scoped>
.batch-basket{font-size:.82rem}.basket-header,.basket-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.basket-header{justify-content:space-between}.muted{color:var(--muted)}p{margin:8px 0;line-height:1.5}.basket-warning{color:var(--phoenix-danger-text)}button{border:1px solid var(--border);border-radius:4px;padding:4px 8px;background:var(--panel-bg);color:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}.basket-files{padding:0;margin:8px 0;list-style:none;max-height:200px;overflow:auto}.basket-files li{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--border);padding:5px 0}.basket-files span{overflow-wrap:anywhere;min-width:0}.basket-files button{flex-shrink:0}
</style>
