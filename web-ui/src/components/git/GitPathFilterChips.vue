<script setup lang="ts">
import { Search } from "@element-plus/icons-vue";
import { computed, ref } from "vue";
import { pushGitPathFilterTagSuggestion } from "../../utils/gitPathFilterPrefs";

const props = defineProps<{
  workspacePath: string;
  history?: string[][];
  suggestions?: string[];
}>();

const tags = defineModel<string[]>({ default: () => [] });

const emit = defineEmits<{
  "apply-set": [tags: string[]];
  remember: [];
}>();

const draft = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const dropdownOpen = ref(false);

const hasFilters = computed(() => tags.value.length > 0);
const hasDropdown = computed(
  () => (props.history?.length ?? 0) > 0 || (props.suggestions?.length ?? 0) > 0,
);

const draftSuggestions = computed(() => {
  const q = draft.value.trim().toLowerCase();
  const pool = props.suggestions ?? [];
  if (!q) return pool.slice(0, 8);
  return pool.filter((t) => t.toLowerCase().includes(q)).slice(0, 8);
});

function focusInput() {
  inputRef.value?.focus();
}

function addTag(raw: string) {
  const text = raw.trim();
  if (!text) return;
  const key = text.toLowerCase();
  if (tags.value.some((t) => t.toLowerCase() === key)) return;
  tags.value = [...tags.value, text];
  pushGitPathFilterTagSuggestion(props.workspacePath, text);
}

function onEnter() {
  addTag(draft.value);
  draft.value = "";
}

function removeTag(index: number) {
  tags.value = tags.value.filter((_, i) => i !== index);
}

function onBackspace() {
  if (draft.value !== "" || !tags.value.length) return;
  tags.value = tags.value.slice(0, -1);
}

function clearAll() {
  tags.value = [];
  draft.value = "";
}

function applySet(set: string[]) {
  emit("apply-set", set);
  dropdownOpen.value = false;
}

function applySuggestion(tag: string) {
  addTag(tag);
  draft.value = "";
  dropdownOpen.value = false;
}

function rememberCurrent() {
  emit("remember");
}

function formatSet(set: string[]) {
  return set.join(" · ");
}
</script>

<template>
  <div class="git-filter-wrap">
    <div class="git-filter-field" @click="focusInput">
      <el-icon class="git-filter-icon"><Search /></el-icon>
      <el-tag
        v-for="(tag, index) in tags"
        :key="`${tag}-${index}`"
        size="small"
        closable
        disable-transitions
        class="git-filter-tag"
        @close="removeTag(index)"
      >
        {{ tag }}
      </el-tag>
      <input
        ref="inputRef"
        v-model="draft"
        class="git-filter-input"
        type="search"
        spellcheck="false"
        placeholder="筛选路径，回车添加"
        @keydown.enter.prevent="onEnter"
        @keydown.backspace="onBackspace"
        @focus="dropdownOpen = hasDropdown"
      />
      <button
        v-if="hasFilters"
        type="button"
        class="git-filter-clear"
        title="清除全部筛选"
        @click.stop="clearAll"
      >
        清空
      </button>
    </div>
    <el-dropdown
      v-if="hasDropdown"
      trigger="click"
      placement="bottom-end"
      @visible-change="(v: boolean) => (dropdownOpen = v)"
    >
      <button
        type="button"
        class="git-filter-dropdown-btn"
        :class="{ open: dropdownOpen }"
        title="筛选历史与建议"
        @click.stop
      >
        历史
      </button>
      <template #dropdown>
        <el-dropdown-menu class="git-filter-menu">
          <el-dropdown-item v-if="hasFilters" @click="rememberCurrent">
            记住当前筛选
          </el-dropdown-item>
          <template v-if="history?.length">
            <li class="git-filter-menu-label" role="presentation">最近组合</li>
            <el-dropdown-item
              v-for="(set, index) in history"
              :key="`set-${index}-${formatSet(set)}`"
              @click="applySet(set)"
            >
              {{ formatSet(set) }}
            </el-dropdown-item>
          </template>
          <template v-if="draftSuggestions.length">
            <li class="git-filter-menu-label" role="presentation">标签建议</li>
            <el-dropdown-item
              v-for="tag in draftSuggestions"
              :key="`tag-${tag}`"
              @click="applySuggestion(tag)"
            >
              {{ tag }}
            </el-dropdown-item>
          </template>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<style scoped>
.git-filter-wrap {
  display: flex;
  align-items: center;
  gap: 2px;
  max-width: min(360px, 42vw);
}

.git-filter-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 140px;
  min-height: 24px;
  padding: 2px 6px;
  box-sizing: border-box;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-blank);
  cursor: text;
}

.git-filter-field:focus-within {
  border-color: var(--el-color-primary);
}

.git-filter-icon {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--el-text-color-placeholder);
}

.git-filter-tag {
  max-width: 140px;
}

.git-filter-tag :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-filter-input {
  flex: 1 1 72px;
  min-width: 72px;
  border: none;
  outline: none;
  padding: 2px 0;
  font-size: 12px;
  line-height: 20px;
  background: transparent;
  color: var(--el-text-color-primary);
}

.git-filter-input::placeholder {
  color: var(--el-text-color-placeholder);
}

.git-filter-clear {
  flex-shrink: 0;
  min-width: 36px;
  height: 24px;
  padding: 2px 4px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.git-filter-clear:hover {
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
}

.git-filter-dropdown-btn {
  flex-shrink: 0;
  min-width: 40px;
  height: 24px;
  padding: 2px 6px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.git-filter-dropdown-btn:hover,
.git-filter-dropdown-btn.open {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}

.git-filter-menu-label {
  list-style: none;
  margin: 0;
  padding: 4px 12px 2px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
  pointer-events: none;
}
</style>

<style>
.git-filter-menu {
  max-width: min(360px, 80vw);
}

.git-filter-menu .el-dropdown-menu__item {
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
