<script setup lang="ts">
/**
 * Grid 设置弹窗 —— 显示容器 Grid 的行列伸缩开关。
 * 点击行/列切换伸缩状态，即时反映到画布预览。
 */
import { inject } from "vue";
import { CAA_CONTROL_KEY } from "../../composables/useCaaControlContext";

const props = defineProps<{
  open: boolean;
  containerId: string;
  containerType: string;
  rows: number;
  cols: number;
  rowResizable: number[];
  colResizable: number[];
}>();

const emit = defineEmits<{ close: [] }>();

const ctx = inject(CAA_CONTROL_KEY, null);

function typeLabel(t: string): string {
  return t.replace(/^CATDlg/, "");
}

function toggleRow(idx: number) {
  if (!ctx) return;
  ctx.toggleGridRowResize(props.containerId, idx);
}

function toggleCol(idx: number) {
  if (!ctx) return;
  ctx.toggleGridColResize(props.containerId, idx);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="caa-gs-backdrop" @click.self="emit('close')">
      <div class="caa-gs-popover" @click.stop>
        <div class="caa-gs-head">
          <span class="caa-gs-title">Grid 设置</span>
          <span class="caa-gs-sub mono">{{ containerId }}</span>
          <span class="caa-gs-type">{{ typeLabel(containerType) }}</span>
          <button class="caa-gs-close" @click="emit('close')">&times;</button>
        </div>

        <!-- rows -->
        <div class="caa-gs-section">
          <div class="caa-gs-section-title">
            行 (Rows) · {{ rows }} 行 · 伸缩={{ rowResizable.length > 0 ? rowResizable.join(",") : "无" }}
          </div>
          <div class="caa-gs-toggles">
            <button
              v-for="r in rows"
              :key="'r' + r"
              class="caa-gs-toggle"
              :class="{ 'caa-gs-toggle--on': rowResizable.includes(r) }"
              @click="toggleRow(r)"
            >
              <span class="caa-gs-toggle-idx">r{{ r }}</span>
              <span class="caa-gs-toggle-icon">{{ rowResizable.includes(r) ? "↕" : "·" }}</span>
              <span class="caa-gs-toggle-label">{{ rowResizable.includes(r) ? "伸缩" : "固定" }}</span>
            </button>
          </div>
        </div>

        <!-- cols -->
        <div class="caa-gs-section">
          <div class="caa-gs-section-title">
            列 (Cols) · {{ cols }} 列 · 伸缩={{ colResizable.length > 0 ? colResizable.join(",") : "无" }}
          </div>
          <div class="caa-gs-toggles">
            <button
              v-for="c in cols"
              :key="'c' + c"
              class="caa-gs-toggle"
              :class="{ 'caa-gs-toggle--on': colResizable.includes(c) }"
              @click="toggleCol(c)"
            >
              <span class="caa-gs-toggle-idx">c{{ c }}</span>
              <span class="caa-gs-toggle-icon">{{ colResizable.includes(c) ? "↔" : "·" }}</span>
              <span class="caa-gs-toggle-label">{{ colResizable.includes(c) ? "伸缩" : "固定" }}</span>
            </button>
          </div>
        </div>

        <div class="caa-gs-hint">
          <strong>伸缩</strong>行/列用 <code>fr</code> 填满剩余空间；
          <strong>固定</strong>行/列以内容最小尺寸显示。<br />
          与 CATDlg 中 <code>ROWRES</code>/<code>COLRES</code> 语义一致。
        </div>

        <div class="caa-gs-actions">
          <el-button size="small" @click="emit('close')">完成</el-button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.caa-gs-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9990;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.18);
}

.caa-gs-popover {
  background: #fff;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 8px;
  box-shadow: 0 8px 30px rgba(15, 23, 42, 0.16);
  padding: 14px 16px;
  min-width: 260px;
  max-width: 420px;
  width: fit-content;
  font-size: 0.78rem;
}

.caa-gs-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 12px;
}

.caa-gs-title {
  font-weight: 700;
  font-size: 0.88rem;
}

.caa-gs-sub {
  font-size: 0.72rem;
  color: var(--muted, #64748b);
}

.caa-gs-type {
  font-size: 0.68rem;
  color: #94a3b8;
}

.caa-gs-close {
  margin-left: auto;
  border: none;
  background: transparent;
  font-size: 1rem;
  cursor: pointer;
  color: var(--muted, #64748b);
  padding: 0 4px;
}

.caa-gs-section {
  margin-bottom: 10px;
}

.caa-gs-section-title {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--muted, #64748b);
  margin-bottom: 6px;
}

.caa-gs-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.caa-gs-toggle {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 4px;
  background: #f8fafc;
  cursor: pointer;
  font-size: 0.72rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  transition: all 0.15s;
}

.caa-gs-toggle:hover {
  border-color: var(--accent, #3b82f6);
  background: #eff6ff;
}

.caa-gs-toggle--on {
  background: #eff6ff;
  border-color: var(--accent, #3b82f6);
  color: var(--accent, #2563eb);
  font-weight: 600;
}

.caa-gs-toggle-idx {
  font-size: 0.68rem;
}

.caa-gs-toggle-icon {
  font-size: 0.75rem;
}

.caa-gs-toggle-label {
  font-size: 0.65rem;
  color: inherit;
}

.caa-gs-hint {
  margin: 10px 0 12px;
  padding: 8px 10px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 4px;
  font-size: 0.68rem;
  line-height: 1.5;
  color: #92400e;
}

.caa-gs-hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.65rem;
  background: rgba(0, 0, 0, 0.05);
  padding: 0 2px;
  border-radius: 2px;
}

.caa-gs-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
