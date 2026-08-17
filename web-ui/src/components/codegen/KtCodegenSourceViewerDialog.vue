<script setup lang="ts">
import type { KtCodegenSourcePreviewPayload } from "../../api";

withDefaults(defineProps<{
  preview: KtCodegenSourcePreviewPayload | null;
  loading?: boolean;
  error?: string;
  title?: string;
}>(), {
  loading: false,
  error: "",
  title: "源码查看",
});

const open = defineModel<boolean>({ default: false });
</script>

<template>
  <el-dialog
    v-model="open"
    class="codegen-source-dialog"
    width="min(920px, 92vw)"
    append-to-body
    destroy-on-close
  >
    <template #header>
      <div class="source-dialog-head">
        <strong>{{ title }}</strong>
        <span v-if="preview">{{ preview.path }}:{{ preview.focus_start_line + 1 }}</span>
      </div>
    </template>
    <div v-if="loading" class="source-dialog-state">正在读取源码…</div>
    <div v-else-if="error" class="source-dialog-state error">{{ error }}</div>
    <template v-else-if="preview">
      <div class="source-dialog-meta">
        <span>{{ preview.encoding }}</span>
        <span>{{ preview.eol.toUpperCase() }}</span>
        <span>第 {{ preview.from_line + 1 }}–{{ preview.to_line + 1 }} 行</span>
        <span v-if="preview.stale" class="stale">源码已变化</span>
        <span class="readonly">只读</span>
      </div>
      <div class="source-code" role="region" aria-label="带行号源码" tabindex="0">
        <div
          v-for="line in preview.lines"
          :key="line.number"
          class="source-line"
          :class="{
            'focus-range': line.focus,
            'focus-anchor': line.number === preview.focus_start_line,
          }"
        >
          <span class="line-number">{{ line.number + 1 }}</span>
          <code>{{ line.text || " " }}</code>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.source-dialog-head { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.source-dialog-head strong { color: var(--text); font-size: 0.95rem; }
.source-dialog-head span { overflow: hidden; color: var(--muted); font: 0.75rem/1.3 ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
.source-dialog-state { padding: 30px; color: var(--muted); text-align: center; }
.source-dialog-state.error { color: var(--danger, #dc2626); }
.source-dialog-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; color: var(--muted); font-size: 0.72rem; }
.source-dialog-meta span { padding: 2px 7px; border: 1px solid var(--border); border-radius: 999px; }
.source-dialog-meta .stale { color: var(--warning, #b45309); border-color: currentColor; }
.source-dialog-meta .readonly { margin-left: auto; }
.source-code {
  --source-bg: var(--vscode-editor-background, #1e1e1e);
  --source-fg: var(--vscode-editor-foreground, #d4d4d4);
  --source-gutter-bg: var(--vscode-editorGutter-background, #181818);
  --source-gutter-fg: var(--vscode-editorLineNumber-foreground, #858585);
  --source-border: var(--vscode-panel-border, #3a3a3a);
  max-height: min(66vh, 680px);
  overflow: auto;
  color: var(--source-fg);
  color-scheme: dark;
  background: var(--source-bg);
  border: 1px solid var(--source-border);
  border-radius: 5px;
  font: 0.78rem/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  scrollbar-color: #5a5a5a var(--source-bg);
}
.source-line { display: grid; grid-template-columns: 58px minmax(max-content, 1fr); min-height: 1.55em; }
.source-line:hover { background: rgba(255, 255, 255, 0.035); }
.source-line.focus-range { background: var(--vscode-editor-rangeHighlightBackground, rgba(255, 255, 255, 0.055)); }
.source-line.focus-anchor {
  background: var(--vscode-editor-lineHighlightBackground, rgba(0, 122, 204, 0.24));
  box-shadow: inset 3px 0 0 var(--vscode-focusBorder, #007acc);
}
.line-number {
  padding: 0 10px 0 6px;
  color: var(--source-gutter-fg);
  background: var(--source-gutter-bg);
  border-right: 1px solid var(--source-border);
  text-align: right;
  user-select: none;
}
.source-line.focus-anchor .line-number { color: var(--vscode-editorLineNumber-activeForeground, #c6c6c6); }
.source-line code { display: block; padding: 0 10px; color: inherit; white-space: pre; }
.source-line code::selection { color: #fff; background: var(--vscode-editor-selectionBackground, #264f78); }
.source-code:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007acc); outline-offset: 1px; }
</style>
