<script setup lang="ts">
import { computed, toValue } from "vue";
import SidebarBlock from "phoenix-wing/layout/PnwSidebarBlock.vue";
import { useAppShell } from "../../composables/useAppShell";
import {
  useRegisteredPagePrimaryContribution,
  type PagePrimaryAction,
  type PagePrimaryOption,
  type PagePrimaryResolvable,
} from "../../composables/usePagePrimaryContribution";

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
const viewTitle = computed(() => activeTab.value?.title || pageLabel.value);
const viewContext = computed(() => activeTab.value?.subtitle
  || activeTab.value?.contextKey
  || "当前页面没有独立文档上下文");
const moduleLabel = computed(() => {
  if (navItem.value?.module === "cad") return "CAD";
  if (navItem.value?.module === "code") return "Code";
  return "系统";
});
const workspaceLabel = computed(() => {
  const path = shell.workspacePath.value.replace(/\\/g, "/").replace(/\/+$/, "");
  return path.split("/").filter(Boolean).pop() || "尚未选择工作空间";
});
const pageDescription = computed(() => navItem.value?.description
  || "此页面尚未提供独立说明。中央 View 保留主要内容与操作结果。");

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
  <SidebarBlock
    v-else
    :title="pageLabel"
    variant="strip"
    :collapsible="false"
    body-scroll
    class="generic-primary-block"
    :aria-label="`${pageLabel} Primary`"
  >
    <template #suffix><span class="primary-badge">Primary</span></template>

    <section class="primary-section current-view">
      <span class="section-kicker">当前 View</span>
      <strong :title="viewTitle">{{ viewTitle }}</strong>
      <p :title="viewContext">{{ viewContext }}</p>
      <dl class="context-grid">
        <dt>模块</dt><dd>{{ moduleLabel }}</dd>
        <dt>工作空间</dt><dd :title="shell.workspacePath.value">{{ workspaceLabel }}</dd>
      </dl>
    </section>

    <section class="primary-section">
      <h3>页面用途</h3>
      <p>{{ pageDescription }}</p>
    </section>

    <section
      v-for="section in primarySections"
      :key="section.id"
      class="primary-section contributed-section"
    >
      <h3>{{ section.title }}</h3>
      <p v-if="section.description" class="section-description">
        {{ textValue(section.description) }}
      </p>

      <div v-if="section.controls?.length" class="primary-controls">
        <template v-for="control in section.controls" :key="control.id">
          <label
            v-if="control.kind === 'text'"
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
            <dd :class="{ mono: control.mono }">{{ displayValue(control.value) }}</dd>
          </dl>
        </template>
      </div>

      <div v-if="section.actions?.length" class="primary-actions">
        <el-button
          v-for="action in section.actions"
          :key="action.id"
          size="small"
          :type="actionType(action)"
          :plain="action.plain"
          :title="action.title"
          :disabled="booleanValue(action.disabled)"
          :loading="booleanValue(action.loading)"
          @click="action.run"
        >
          {{ textValue(action.label) }}
        </el-button>
      </div>
    </section>

    <section v-if="!primarySections.length" class="primary-section empty-primary-note">
      <h3>Primary 面板</h3>
      <p>
        此页面暂时没有独立的 Primary 控件。后续会把范围、过滤、选择和运行上下文逐步迁入这里；
        中央 View 只保留主要编辑内容与结果。
      </p>
    </section>

    <section v-if="primarySummary || shell.pageSummary.value" class="primary-section live-summary" aria-live="polite">
      <h3>当前摘要</h3>
      <p>{{ primarySummary || shell.pageSummary.value }}</p>
    </section>
  </SidebarBlock>
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
.primary-section { padding: 10px 2px; border-bottom: 1px solid var(--border); }
.primary-section:last-child { border-bottom: 0; }
.primary-section h3,
.primary-section p { margin: 0; }
.primary-section h3 { margin-bottom: 5px; color: var(--text); font-size: 0.7rem; }
.primary-section p { color: var(--muted); font-size: 0.68rem; line-height: 1.55; }
.current-view { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.current-view strong,
.current-view > p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.current-view strong { color: var(--text); font-size: 0.77rem; }
.section-kicker { color: var(--muted); font-size: 0.59rem; letter-spacing: 0.04em; text-transform: uppercase; }
.context-grid {
  display: grid;
  margin: 7px 0 0;
  grid-template-columns: 64px minmax(0, 1fr);
  color: var(--muted);
  font-size: 0.64rem;
}
.context-grid dt,
.context-grid dd { min-width: 0; margin: 0; padding: 3px 0; border-top: 1px solid var(--border); }
.context-grid dd { overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.empty-primary-note { background: color-mix(in srgb, var(--panel-head-bg) 58%, transparent); }
.live-summary p { color: var(--text); }
.section-description { margin-bottom: 8px !important; }
.primary-controls { display: flex; flex-direction: column; gap: 9px; }
.primary-control { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
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
.readonly-control dt,
.readonly-control dd { min-width: 0; margin: 0; padding: 3px 0; border-top: 1px solid var(--border); }
.readonly-control dt { color: var(--muted); }
.readonly-control dd { overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.primary-actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
.primary-actions :deep(.el-button) { min-height: 26px; margin-left: 0; font-size: 0.66rem; }
</style>
