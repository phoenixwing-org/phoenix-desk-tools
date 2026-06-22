<script setup lang="ts">
import { unref } from "vue";
import type { PagePropertyField } from "../types/pageProperties";

defineProps<{
  field: PagePropertyField;
  stripe?: boolean;
}>();

function isHidden(field: PagePropertyField) {
  return field.hidden ? Boolean(unref(field.hidden)) : false;
}

function isDisabled(field: PagePropertyField) {
  return field.disabled ? Boolean(unref(field.disabled)) : false;
}

function formatInfoValue(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  if (typeof raw === "boolean") return raw ? "是" : "否";
  return String(raw);
}

function onBoolChange(field: PagePropertyField & { kind: "boolean" }, checked: boolean) {
  field.onChange?.(checked);
}
</script>

<template>
  <template v-if="!isHidden(field)">
    <tr class="prop-field-row" :class="{ stripe, 'label-emphasis': field.labelTone === 'emphasis' }">
      <td class="prop-name" :class="{ emphasis: field.labelTone === 'emphasis' }" :title="field.hint || field.label">
        {{ field.label }}
      </td>
      <td class="prop-value">
        <label v-if="field.kind === 'boolean'" class="prop-bool-cell">
          <el-checkbox
            :model-value="Boolean(unref(field.value))"
            :disabled="isDisabled(field)"
            size="small"
            @change="onBoolChange(field, Boolean($event))"
          />
          <span class="prop-bool-text">{{ Boolean(unref(field.value)) ? "是" : "否" }}</span>
        </label>

        <el-input
          v-else-if="field.kind === 'string'"
          :model-value="String(unref(field.value))"
          :disabled="isDisabled(field)"
          :placeholder="field.placeholder"
          size="small"
          class="prop-input"
          :class="{ mono: field.mono }"
          @update:model-value="field.onChange?.(String($event))"
        />

        <el-input-number
          v-else-if="field.kind === 'number'"
          :model-value="Number(unref(field.value))"
          :disabled="isDisabled(field)"
          :min="field.min"
          :max="field.max"
          :step="field.step ?? 1"
          size="small"
          controls-position="right"
          class="prop-number"
          @update:model-value="field.onChange?.(Number($event))"
        />

        <el-select
          v-else-if="field.kind === 'select'"
          :model-value="String(unref(field.value))"
          :disabled="isDisabled(field)"
          size="small"
          class="prop-select"
          :title="field.hint"
          @update:model-value="field.onChange?.(String($event))"
        >
          <el-option
            v-for="opt in field.options"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>

        <span v-else-if="field.kind === 'info'" class="prop-info" :class="{ mono: field.mono }">
          {{ formatInfoValue(unref(field.value)) }}
        </span>
      </td>
    </tr>
  </template>
</template>

<style scoped>
.prop-field-row .prop-name,
.prop-field-row .prop-value {
  background: var(--prop-row-bg);
}

.prop-field-row.stripe .prop-name,
.prop-field-row.stripe .prop-value {
  background: var(--prop-row-stripe-bg);
}

.prop-name {
  padding: 3px 8px;
  font-size: 0.72rem;
  line-height: 1.35;
  color: var(--text);
  border-right: 1px solid var(--border);
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prop-name.emphasis {
  color: #1a8c1a;
  font-weight: 500;
}

.prop-value {
  padding: 2px 6px;
  vertical-align: middle;
  font-size: 0.72rem;
  line-height: 1.35;
}

.prop-field-row:has(.prop-info) .prop-name,
.prop-field-row:has(.prop-info) .prop-value {
  vertical-align: top;
  padding-top: 4px;
  padding-bottom: 4px;
}

.prop-bool-cell {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  margin: 0;
}

.prop-bool-text {
  color: var(--text);
  user-select: none;
}

.prop-value :deep(.el-checkbox) {
  height: auto;
  margin-right: 0;
}

.prop-input,
.prop-select,
.prop-number {
  width: 100%;
}

.prop-input.mono,
.prop-info.mono {
  font-family: var(--mono-font, ui-monospace, monospace);
  font-size: 0.68rem;
}

.prop-info {
  display: block;
  font-size: 0.72rem;
  line-height: 1.35;
  word-break: break-word;
}
</style>
