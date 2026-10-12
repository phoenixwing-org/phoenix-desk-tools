<script setup lang="ts">
import { computed, reactive, toValue } from "vue";
import PrimaryPanel from "phoenix-wing/layout/PnwPrimaryPanel.vue";
import PrimarySection from "phoenix-wing/layout/PnwPrimarySection.vue";
import PrimaryDirectoryControl from "./PrimaryDirectoryControl.vue";
import PrimaryTaskProgress from "./PrimaryTaskProgress.vue";
import PrimaryThumbnail from "./PrimaryThumbnail.vue";
import { useAppShell } from "../../composables/useAppShell";
import {
  useRegisteredPagePrimaryContribution,
  type PagePrimaryAction,
  type PagePrimaryOption,
  type PagePrimaryResolvable,
} from "../../composables/usePagePrimaryContribution";
import {
  primaryPanelBlocks,
  primarySectionCountLabel,
  primarySectionLayout,
  primarySectionStateKey,
} from "./primaryPanelViewModel";

const props = withDefaults(defineProps<{
  pageId?: string;
  workbenchTabId?: string;
}>(), {
  pageId: "",
  workbenchTabId: "",
});

const shell = useAppShell();
const primaryContribution = useRegisteredPagePrimaryContribution(
  () => props.pageId,
  () => props.workbenchTabId,
);
const primarySections = computed(() => {
  const contribution = primaryContribution.value;
  return contribution?.sections ? toValue(contribution.sections) : [];
});
const panelBlocks = computed(() => primaryPanelBlocks(primarySections.value));
const primaryContent = computed(() => primaryContribution.value?.content ?? null);
const primaryContentProps = computed(() => {
  const content = primaryContent.value;
  return content?.props ? toValue(content.props) : {};
});
const primarySummary = computed(() => {
  const contribution = primaryContribution.value;
  return contribution?.summary ? toValue(contribution.summary) : "";
});

const navItem = computed(() => shell.appConfig.value?.navigation.find((item) => item.page === props.pageId));
const activeTab = computed(() => props.workbenchTabId
  ? shell.getTab(props.workbenchTabId)
  : shell.activeTab());
const pageLabel = computed(() => navItem.value?.label || activeTab.value?.title || props.pageId || "页面");
const primaryLabel = computed(() => toValue(primaryContribution.value?.title) || pageLabel.value);
const viewTitle = computed(() => activeTab.value?.title || pageLabel.value);
const viewContext = computed(() => activeTab.value?.subtitle
  || activeTab.value?.contextKey
  || "当前页面没有独立文档上下文");
const moduleLabel = computed(() => {
  if (navItem.value?.module === "cad" || navItem.value?.module === "code" || props.pageId === "audio_extract") return "工具";
  return "系统";
});
const workspaceLabel = computed(() => {
  const path = shell.workspacePath.value.replace(/\\/g, "/").replace(/\/+$/, "");
  return path.split("/").filter(Boolean).pop() || "尚未选择工作空间";
});
const pageDescription = computed(() => navItem.value?.description
  || "此页面尚未提供独立说明。中央 View 保留主要内容与操作结果。");
const collapsedSections = reactive(new Set<string>());

function sectionStateKey(sectionId: string): string {
  return primarySectionStateKey(props.pageId, props.workbenchTabId, sectionId);
}

function isSectionExpanded(sectionId: string): boolean {
  return !collapsedSections.has(sectionStateKey(sectionId));
}

function setSectionExpanded(sectionId: string, expanded: boolean): void {
  const key = sectionStateKey(sectionId);
  if (expanded) collapsedSections.delete(key);
  else collapsedSections.add(key);
}

function textValue(value: PagePrimaryResolvable<string>): string {
  return toValue(value);
}

function booleanValue(value: PagePrimaryResolvable<boolean> | undefined): boolean {
  return value == null ? false : toValue(value);
}

function numberValue(value: PagePrimaryResolvable<number>): number {
  return toValue(value);
}

function optionsValue(value: PagePrimaryResolvable<readonly PagePrimaryOption[]>) {
  return toValue(value);
}

function displayValue(value: PagePrimaryResolvable<string | number>): string {
  return String(toValue(value));
}

function actionType(action: PagePrimaryAction): "primary" | "danger" | undefined {
  return action.tone === "primary" || action.tone === "danger" ? action.tone : undefined;
}
</script>

<template>
  <component
    :is="primaryContent.component"
    v-if="primaryContent"
    v-bind="primaryContentProps"
    :page-id="props.pageId"
    :workbench-tab-id="props.workbenchTabId"
    class="primary-custom-content"
  />
  <PrimaryPanel
    v-else
    :title="primaryLabel"
    body-scroll
    class="generic-primary-block"
    :aria-label="`${primaryLabel} Primary`"
  >
    <template #suffix><span class="primary-badge">Primary</span></template>

    <template v-for="block in panelBlocks" :key="block.key">
    <section v-if="block.kind === 'context' && primaryContribution?.showContext !== false" class="primary-context">
      <div class="context-title-row">
        <strong :title="viewTitle">{{ viewTitle }}</strong>
        <span class="module-chip">{{ moduleLabel }}</span>
      </div>
      <p class="context-path" :title="viewContext">{{ viewContext }}</p>
      <p class="context-description">{{ pageDescription }}</p>
      <div class="workspace-row" :title="shell.workspacePath.value">
        <span>工作空间</span>
        <strong>{{ workspaceLabel }}</strong>
      </div>
    </section>

    <PrimaryThumbnail v-if="block.kind === 'context' && toValue(primaryContribution?.thumbnail)" :image="toValue(primaryContribution!.thumbnail)!" :generation="toValue(primaryContribution?.thumbnailGeneration)" />

    <section v-else-if="block.kind === 'status' && (primarySummary || shell.pageSummary.value)" class="primary-status" aria-live="polite">
      <span class="status-dot" aria-hidden="true" />
      <p>{{ primarySummary || shell.pageSummary.value }}</p>
    </section>

    <PrimarySection
      v-else-if="block.kind === 'section'"
      :key="sectionStateKey(block.section.id)"
      :title="block.section.title"
      :expanded="isSectionExpanded(block.section.id)"
      :data-section-id="block.section.id"
      @update:expanded="setSectionExpanded(block.section.id, $event)"
    >
      <template #suffix>{{ primarySectionCountLabel(block.section) }}</template>
      <div class="contributed-section-body">
        <PrimaryTaskProgress v-if="block.section.progress" :progress="toValue(block.section.progress)" />
        <p v-if="block.section.description" class="section-description">
          {{ textValue(block.section.description) }}
        </p>

        <div
          v-if="block.section.controls?.length"
          class="primary-controls"
          :class="`is-${primarySectionLayout(block.section)}`"
        >
          <template v-for="control in block.section.controls" :key="control.id">
            <div v-if="control.kind === 'directory'" class="primary-control">
              <span class="control-label">{{ control.label }}</span>
              <PrimaryDirectoryControl :control="control" />
              <small v-if="control.description">{{ control.description }}</small>
            </div>
            <label
              v-else-if="control.kind === 'text'"
              class="primary-control"
              :class="{ 'is-disabled': booleanValue(control.disabled) }"
            >
              <span class="control-label">{{ control.label }}</span>
              <el-input
                :model-value="textValue(control.modelValue)"
                size="small"
                :placeholder="control.placeholder"
                :disabled="booleanValue(control.disabled)"
                :class="{ mono: control.mono }"
                @update:model-value="control.onUpdate(String($event ?? ''))"
              />
              <small v-if="control.description">{{ control.description }}</small>
            </label>

          <label
            v-else-if="control.kind === 'select'"
            class="primary-control"
            :class="{ 'is-disabled': booleanValue(control.disabled) }"
          >
            <span class="control-label">{{ control.label }}</span>
            <el-select
              :model-value="textValue(control.modelValue)"
              size="small"
              :placeholder="control.placeholder"
              :clearable="control.clearable"
              :disabled="booleanValue(control.disabled)"
              @update:model-value="control.onUpdate(String($event ?? ''))"
            >
              <el-option
                v-for="option in optionsValue(control.options)"
                :key="option.value"
                :value="option.value"
                :label="option.label"
              />
            </el-select>
            <small v-if="control.description">{{ control.description }}</small>
          </label>

          <label
            v-else-if="control.kind === 'number'"
            class="primary-control"
            :class="{ 'is-disabled': booleanValue(control.disabled) }"
          >
            <span class="control-label">{{ control.label }}</span>
            <el-input-number
              :model-value="numberValue(control.modelValue)"
              size="small"
              :min="control.min"
              :max="control.max"
              :step="control.step ?? 1"
              :disabled="booleanValue(control.disabled)"
              controls-position="right"
              @update:model-value="control.onUpdate(Number($event ?? 0))"
            />
            <small v-if="control.description">{{ control.description }}</small>
          </label>

          <label
            v-else-if="control.kind === 'textarea'"
            class="primary-control"
            :class="{ 'is-disabled': booleanValue(control.disabled) }"
          >
            <span class="control-label">{{ control.label }}</span>
            <el-input
              :model-value="textValue(control.modelValue)"
              type="textarea"
              :rows="control.rows ?? 7"
              resize="vertical"
              :placeholder="control.placeholder"
              :disabled="booleanValue(control.disabled)"
              :class="{ mono: control.mono }"
              @update:model-value="control.onUpdate(String($event ?? ''))"
            />
            <small v-if="control.description">{{ control.description }}</small>
          </label>

          <div v-else-if="control.kind === 'choice'" class="primary-control choice-control">
            <span class="control-label">{{ control.label }}</span>
            <el-radio-group
              :model-value="textValue(control.modelValue)"
              :disabled="booleanValue(control.disabled)"
              class="primary-choice-group"
              @update:model-value="control.onUpdate(String($event ?? ''))"
            >
              <el-radio
                v-for="option in optionsValue(control.options)"
                :key="option.value"
                :value="option.value"
                :title="option.description"
              >
                {{ option.label }}
              </el-radio>
            </el-radio-group>
            <small v-if="control.description">{{ control.description }}</small>
          </div>

          <label
            v-else-if="control.kind === 'boolean'"
            class="primary-control boolean-control"
            :class="{ warning: control.tone === 'warning', 'is-disabled': booleanValue(control.disabled) }"
          >
            <el-checkbox
              :model-value="booleanValue(control.modelValue)"
              :disabled="booleanValue(control.disabled)"
              @change="control.onUpdate(Boolean($event))"
            >
              {{ control.label }}
            </el-checkbox>
            <small v-if="control.description">{{ control.description }}</small>
          </label>

          <dl v-else class="readonly-control">
            <dt>{{ control.label }}</dt>
            <dd :class="{ mono: control.mono }" :title="displayValue(control.value)">{{ displayValue(control.value) }}</dd>
          </dl>
          </template>
        </div>

        <div v-if="block.section.actions?.length" class="primary-actions" :class="{ 'is-grid': block.section.actionLayout === 'grid' }">
          <el-button
            v-for="action in block.section.actions"
            :key="action.id"
            class="primary-action"
            size="small"
            :type="actionType(action)"
            :plain="action.plain"
            :title="action.title"
            :disabled="booleanValue(action.disabled)"
            :loading="booleanValue(action.loading)"
            @click="action.run"
          >
            <span class="primary-action-label">{{ textValue(action.label) }}</span>
          </el-button>
        </div>
      </div>
    </PrimarySection>
    </template>

    <section v-if="!primarySections.length" class="empty-primary-note">
      <strong>此 View 暂无可调参数</strong>
      <p>主要操作和结果位于中央编辑区。</p>
    </section>
  </PrimaryPanel>
</template>

<style scoped>
.generic-primary-block { width: 100%; height: 100%; }
.primary-custom-content { width: 100%; height: 100%; min-height: 0; }
.primary-badge {
  padding: 1px 6px;
  color: var(--muted);
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  font-size: 0.58rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.primary-context {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel-head-bg) 38%, transparent);
}
.context-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.context-title-row > strong {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.module-chip {
  flex: 0 0 auto;
  padding: 0 5px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  color: var(--muted);
  font-size: 0.56rem;
  line-height: 16px;
}
.primary-context p { margin: 0; }
.context-path {
  overflow: hidden;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 0.61rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.64rem;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.workspace-row {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px;
  color: var(--muted);
  font-size: 0.6rem;
}
.workspace-row > strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.primary-status {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  background: color-mix(in srgb, var(--el-color-primary) 5%, transparent);
}
.primary-status p { margin: 0; font-size: 0.64rem; line-height: 1.4; }
.status-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  margin-top: 4px;
  border-radius: 50%;
  background: var(--el-color-primary);
}
.contributed-section-body { padding: 8px; }
.section-description { margin: 0 0 7px; color: var(--muted); font-size: 0.62rem; line-height: 1.4; overflow-wrap: anywhere; white-space: pre-line; }
.primary-controls { display: flex; flex-direction: column; gap: 7px; }
.primary-controls.is-readonly-grid,
.primary-controls.is-boolean-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px 8px; }
.primary-control { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.control-label { color: var(--text); font-size: 0.66rem; font-weight: 600; }
.primary-control small { color: var(--muted); font-size: 0.61rem; line-height: 1.4; }
.primary-control.is-disabled { opacity: 0.65; }
.primary-control :deep(.el-input__wrapper),
.primary-control :deep(.el-select__wrapper),
.primary-control :deep(.el-input-number) { min-height: 26px; width: 100%; }
.primary-control :deep(.el-input__inner),
.primary-control :deep(.el-select__selected-item) { font-size: 0.68rem; }
.primary-control .mono :deep(.el-input__inner),
.primary-control .mono :deep(.el-textarea__inner),
.readonly-control .mono { font-family: var(--font-mono); }
.primary-control .mono :deep(.el-textarea__inner) { font-size: 0.66rem; line-height: 1.45; }
.boolean-control { gap: 1px; }
.boolean-control :deep(.el-checkbox) { height: auto; min-height: 22px; }
.boolean-control :deep(.el-checkbox__label) { color: var(--text); font-size: 0.67rem; white-space: normal; }
.boolean-control.warning :deep(.el-checkbox__label) { color: var(--phoenix-warning-text, #9a6700); }
.primary-choice-group { display: flex; align-items: flex-start; flex-direction: column; gap: 2px; }
.primary-choice-group :deep(.el-radio) { height: auto; min-height: 22px; margin-right: 0; }
.primary-choice-group :deep(.el-radio__label) { color: var(--text); font-size: 0.67rem; white-space: normal; }
.readonly-control {
  display: grid;
  margin: 0;
  grid-template-columns: 72px minmax(0, 1fr);
  font-size: 0.64rem;
}
.is-readonly-grid .readonly-control { display: flex; min-width: 0; flex-direction: column; padding: 3px 0; }
.readonly-control dt,
.readonly-control dd { min-width: 0; margin: 0; padding: 3px 0; border-top: 1px solid var(--border); }
.is-readonly-grid .readonly-control dt,
.is-readonly-grid .readonly-control dd { padding: 0; border: 0; }
.readonly-control dt { color: var(--muted); }
.is-readonly-grid .readonly-control dt { font-size: 0.58rem; }
.is-readonly-grid .readonly-control dd { font-size: 0.69rem; font-weight: 600; }
.readonly-control dd { overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.primary-controls.is-properties { gap: 0; }
.is-properties .readonly-control { grid-template-columns: minmax(86px, 32%) minmax(0, 1fr); column-gap: 8px; }
.is-properties .readonly-control dt,
.is-properties .readonly-control dd { padding-block: 6px; line-height: 1.5; }
.is-properties .readonly-control:first-child dt,
.is-properties .readonly-control:first-child dd { border-top: 0; }
.is-properties .readonly-control dd { white-space: normal; overflow-wrap: anywhere; }
.primary-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.primary-actions :deep(.el-button) { min-height: 25px; margin-left: 0; padding-inline: 8px; font-size: 0.64rem; }
.primary-actions.is-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr));
  grid-auto-rows: minmax(36px, auto);
  gap: 6px;
}
.primary-actions.is-grid .primary-action {
  width: 100%; min-width: 0; height: 100%; min-height: 36px;
  margin: 0; padding: 7px 10px; font-size: 0.72rem; line-height: 1.35;
}
.primary-actions.is-grid .primary-action-label { white-space: normal; overflow-wrap: anywhere; }
.empty-primary-note { display: grid; gap: 2px; padding: 12px 10px; color: var(--muted); }
.empty-primary-note strong { color: var(--text); font-size: 0.68rem; }
.empty-primary-note p { margin: 0; font-size: 0.62rem; line-height: 1.4; }
</style>
