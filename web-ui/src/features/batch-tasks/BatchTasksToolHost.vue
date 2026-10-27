<script setup lang="ts">
import { PnwDockablePrimarySection, PnwDockableToolWindow, type PnwColorScheme } from "phoenix-wing";
import { PDT_BATCH_TASKS_TOOL_DEFINITION } from "../../workbench/pdtBatchTasksDockableTool";
import { batchTasksToolState, updateBatchTasksToolState } from "./application";
import BatchTasksToolContent from "./BatchTasksToolContent.vue";
defineProps<{ location: "primary" | "floating"; colorScheme?: PnwColorScheme }>();
</script>
<template>
  <PnwDockablePrimarySection v-if="location === 'primary'" :definition="PDT_BATCH_TASKS_TOOL_DEFINITION" :state="batchTasksToolState" @update:state="updateBatchTasksToolState"><BatchTasksToolContent /></PnwDockablePrimarySection>
  <PnwDockableToolWindow v-else :definition="PDT_BATCH_TASKS_TOOL_DEFINITION" :state="batchTasksToolState" :color-scheme="colorScheme" :constrain-insets="{ top: 48, bottom: 24 }" @update:state="updateBatchTasksToolState"><BatchTasksToolContent /></PnwDockableToolWindow>
</template>
