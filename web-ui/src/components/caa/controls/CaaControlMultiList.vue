<script setup lang="ts">
import { computed } from "vue";
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import CaaInlineNlsText from "../CaaInlineNlsText.vue";
import { useCaaControl } from "./useCaaControl";

const props = defineProps<{
  node: CaaDialogNode;
  fillParent?: boolean;
  widthStyle?: Record<string, string>;
}>();

const widthOverride = computed(() => props.widthStyle);
const { isSelected, onClick, onContextmenu, columnTitleBindings, widthStyle: resolvedWidth } = useCaaControl(props, { widthOverride });

const controlRows = props.node.size?.textHeight ?? 3;
</script>

<template>
  <div
    class="caa-multilist"
    :class="{ 'caa-multilist--selected': isSelected }"
    :style="resolvedWidth"
    @click="onClick"
    @contextmenu="onContextmenu($event)"
  >
    <table>
      <thead>
        <tr>
          <th v-for="col in columnTitleBindings" :key="col.key">
            <CaaInlineNlsText
              :text="col.text"
              :nls-key="col.key"
              :node-id="node.id"
              prop="title"
              :column-index="col.index"
            />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in controlRows" :key="r">
          <td v-for="col in columnTitleBindings" :key="`${r}-${col.index}`">&nbsp;</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.caa-multilist {
  width: auto;
  max-width: 100%;
  overflow: auto;
  font-size: 0.75rem;
  cursor: pointer;
}

.caa-multilist--selected {
  outline: 2px solid var(--accent, #3b82f6);
  outline-offset: 1px;
}

.caa-multilist table {
  width: auto;
  table-layout: fixed;
  border-collapse: collapse;
}

.caa-multilist table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}

.caa-multilist th,
.caa-multilist td {
  border: 1px solid var(--border, #e2e8f0);
  padding: 2px 6px;
}

.caa-multilist th {
  background: #f1f5f9;
  text-align: left;
}

</style>
