<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import {
  CircleCheck,
  Close,
  Download,
  Headset,
  Loading,
  UploadFilled,
  VideoPlay,
  Warning,
} from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useAppShell } from "../../composables/useAppShell";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../../composables/usePagePrimaryContribution";
import {
  AUDIO_EXTRACT_BITRATE_KBPS,
  AUDIO_EXTRACT_OUTPUT_SAMPLE_RATE,
  decodeMediaFile,
  encodeAudioBufferToMp3,
  formatAudioDuration,
  formatMediaBytes,
  isSupportedMediaFile,
  mp3FileName,
} from "./audioExtraction";

type ExtractPhase = "idle" | "ready" | "decoding" | "encoding" | "done" | "error";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const decodedDuration = ref(0);
const decodedChannels = ref(0);
const decodedSampleRate = ref(0);
const outputBlob = ref<Blob | null>(null);
const outputUrl = ref("");
const phase = ref<ExtractPhase>("idle");
const progress = ref(0);
const statusDetail = ref("选择或拖入一个包含音频轨道的视频文件");
const dragActive = ref(false);
let activeController: AbortController | null = null;
let extractionRun = 0;

const busy = computed(() => phase.value === "decoding" || phase.value === "encoding");
const canExtract = computed(() => Boolean(selectedFile.value) && !busy.value);
const canDownload = computed(() => Boolean(outputBlob.value && outputUrl.value) && !busy.value);
const outputName = computed(() => mp3FileName(selectedFile.value?.name ?? ""));
const progressLabel = computed(() => `${Math.round(progress.value)}%`);
const phaseLabel = computed(() => {
  if (phase.value === "ready") return "已选择";
  if (phase.value === "decoding") return "正在解码媒体";
  if (phase.value === "encoding") return "正在编码 MP3";
  if (phase.value === "done") return "提取完成";
  if (phase.value === "error") return "提取失败";
  return "等待选择文件";
});
const phaseIcon = computed(() => {
  if (busy.value) return Loading;
  if (phase.value === "done") return CircleCheck;
  if (phase.value === "error") return Warning;
  if (phase.value === "ready") return VideoPlay;
  return Headset;
});

function revokeOutputUrl(): void {
  if (outputUrl.value) URL.revokeObjectURL(outputUrl.value);
  outputUrl.value = "";
  outputBlob.value = null;
}

function cancelExtraction(): void {
  extractionRun += 1;
  activeController?.abort();
  activeController = null;
  if (selectedFile.value) {
    phase.value = "ready";
    statusDetail.value = "提取已取消，可以重新开始";
  } else {
    phase.value = "idle";
    statusDetail.value = "选择或拖入一个包含音频轨道的视频文件";
  }
  progress.value = 0;
}

function clearSelection(): void {
  cancelExtraction();
  revokeOutputUrl();
  selectedFile.value = null;
  decodedDuration.value = 0;
  decodedChannels.value = 0;
  decodedSampleRate.value = 0;
  phase.value = "idle";
  progress.value = 0;
  statusDetail.value = "已清除，等待选择视频文件";
  dragActive.value = false;
  if (fileInput.value) fileInput.value.value = "";
}

function selectFile(file: File | null): void {
  if (!file) return;
  if (!isSupportedMediaFile(file)) {
    ElMessage.warning("请选择浏览器可解码的 MP4、WebM、MOV 或音频文件");
    return;
  }
  cancelExtraction();
  revokeOutputUrl();
  selectedFile.value = file;
  decodedDuration.value = 0;
  decodedChannels.value = 0;
  decodedSampleRate.value = 0;
  phase.value = "ready";
  progress.value = 0;
  statusDetail.value = `${file.name} · ${formatMediaBytes(file.size)}`;
  shell.setStatus(`已选择媒体文件：${file.name}`);
}

function openFilePicker(): void {
  if (!busy.value) fileInput.value?.click();
}

function onInputChange(event: Event): void {
  const input = event.currentTarget;
  if (input instanceof HTMLInputElement) selectFile(input.files?.[0] ?? null);
}

function onDragOver(event: DragEvent): void {
  event.preventDefault();
  if (!busy.value) dragActive.value = true;
}

function onDragLeave(event: DragEvent): void {
  event.preventDefault();
  dragActive.value = false;
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  dragActive.value = false;
  if (!busy.value) selectFile(event.dataTransfer?.files?.[0] ?? null);
}

async function extractAudio(): Promise<void> {
  const file = selectedFile.value;
  if (!file || busy.value) return;
  const run = ++extractionRun;
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  revokeOutputUrl();
  decodedDuration.value = 0;
  decodedChannels.value = 0;
  decodedSampleRate.value = 0;
  phase.value = "decoding";
  progress.value = 4;
  statusDetail.value = "正在用 Web Audio 解码媒体中的音频轨道…";
  shell.appendLog(`[音频提取] 解码 ${file.name}`, { source: "audio_extract", open: true });

  try {
    const decoded = await decodeMediaFile(file);
    if (run !== extractionRun || controller.signal.aborted) return;
    decodedDuration.value = decoded.duration;
    decodedChannels.value = decoded.numberOfChannels;
    decodedSampleRate.value = decoded.sampleRate;
    phase.value = "encoding";
    progress.value = 10;
    statusDetail.value = `已解码 ${formatAudioDuration(decoded.duration)}，正在编码 128 kbps MP3…`;
    const blob = await encodeAudioBufferToMp3(decoded, {
      signal: controller.signal,
      onProgress: ({ ratio }) => {
        if (run === extractionRun) progress.value = 10 + ratio * 90;
      },
    });
    if (run !== extractionRun || controller.signal.aborted) return;
    outputBlob.value = blob;
    outputUrl.value = URL.createObjectURL(blob);
    phase.value = "done";
    progress.value = 100;
    statusDetail.value = `${outputName.value} · ${formatMediaBytes(blob.size)} · ${formatAudioDuration(decoded.duration)}`;
    shell.appendLog(`[音频提取] 完成 ${outputName.value}（${formatMediaBytes(blob.size)}）`, { source: "audio_extract" });
    shell.setStatus(`音频提取完成：${outputName.value}`);
    ElMessage.success("MP3 提取完成");
  } catch (error) {
    if (run !== extractionRun || controller.signal.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    phase.value = "error";
    progress.value = 0;
    statusDetail.value = message;
    shell.appendLog(`[音频提取] ${message}`, { source: "audio_extract", open: true });
    shell.setStatus(message);
    ElMessage.error(message);
  } finally {
    if (run === extractionRun) activeController = null;
  }
}

function downloadMp3(): void {
  if (!outputUrl.value || !outputBlob.value) return;
  const link = document.createElement("a");
  link.href = outputUrl.value;
  link.download = outputName.value;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  shell.setStatus(`已开始下载：${outputName.value}`);
}

usePagePrimaryContribution("audio_extract", props.workbenchTabId, {
  summary: computed(() => `${phaseLabel.value} · ${statusDetail.value}`),
  sections: computed<PagePrimarySection[]>(() => [
    {
      id: "source",
      title: "媒体文件",
      description: "仅在当前浏览器或 Tauri WebView 内解码，不上传文件。",
      controls: [
        { id: "name", kind: "readonly", label: "文件", value: computed(() => selectedFile.value?.name ?? "未选择") },
        { id: "size", kind: "readonly", label: "大小", value: computed(() => selectedFile.value ? formatMediaBytes(selectedFile.value.size) : "—") },
        { id: "duration", kind: "readonly", label: "时长", value: computed(() => decodedDuration.value ? formatAudioDuration(decodedDuration.value) : "—") },
        { id: "channels", kind: "readonly", label: "声道", value: computed(() => decodedChannels.value || "—") },
      ],
      actions: [
        { id: "choose", label: "选择视频", run: openFilePicker, disabled: busy },
        { id: "extract", label: "提取 MP3", tone: "primary", run: extractAudio, disabled: computed(() => !canExtract.value), loading: busy },
        { id: "download", label: "下载 MP3", run: downloadMp3, disabled: computed(() => !canDownload.value) },
        { id: "clear", label: "清除", run: clearSelection, disabled: computed(() => !selectedFile.value && !busy.value) },
      ],
    },
    {
      id: "output",
      title: "输出",
      controls: [
        { id: "format", kind: "readonly", label: "格式", value: "MP3" },
        { id: "bitrate", kind: "readonly", label: "码率", value: `${AUDIO_EXTRACT_BITRATE_KBPS} kbps` },
        { id: "sample-rate", kind: "readonly", label: "采样率", value: `${AUDIO_EXTRACT_OUTPUT_SAMPLE_RATE / 1_000} kHz` },
        { id: "output-size", kind: "readonly", label: "输出大小", value: computed(() => outputBlob.value ? formatMediaBytes(outputBlob.value.size) : "—") },
      ],
    },
  ]),
});

onBeforeUnmount(() => {
  activeController?.abort();
  revokeOutputUrl();
});
</script>

<template>
  <div class="page tool-page audio-extract-page">
    <PageHeader title="视频音频提取" page-id="audio_extract">
      <template #actions>
        <div class="head-actions-inner">
          <el-button size="small" :icon="UploadFilled" :disabled="busy" @click="openFilePicker">
            选择视频
          </el-button>
          <el-button type="primary" size="small" :icon="Headset" :loading="busy" :disabled="!canExtract" @click="extractAudio">
            提取 MP3
          </el-button>
          <el-button size="small" :icon="Download" :disabled="!canDownload" @click="downloadMp3">
            下载 MP3
          </el-button>
        </div>
      </template>
    </PageHeader>

    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      accept="video/mp4,video/webm,video/quicktime,audio/*,.mp4,.m4v,.mov,.webm,.m4a,.mp3,.wav,.ogg,.aac,.flac"
      @change="onInputChange"
    />

    <main class="extract-workspace">
      <button
        type="button"
        class="drop-zone"
        :class="{ 'is-drag-active': dragActive, 'has-file': selectedFile }"
        :disabled="busy"
        aria-label="选择或拖入视频文件"
        @click="openFilePicker"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <el-icon class="drop-icon" aria-hidden="true"><UploadFilled /></el-icon>
        <strong>{{ selectedFile ? selectedFile.name : "拖入视频，或点击选择文件" }}</strong>
        <span v-if="selectedFile">{{ formatMediaBytes(selectedFile.size) }} · 点击可更换文件</span>
        <span v-else>支持浏览器可解码的 MP4、WebM、MOV 及常见音频格式</span>
      </button>

      <section class="status-card" aria-live="polite">
        <div class="status-heading">
          <span class="status-icon" :class="`is-${phase}`">
            <el-icon :class="{ 'is-loading': busy }"><component :is="phaseIcon" /></el-icon>
          </span>
          <div>
            <strong>{{ phaseLabel }}</strong>
            <p>{{ statusDetail }}</p>
          </div>
          <span v-if="busy" class="progress-label">{{ progressLabel }}</span>
        </div>
        <el-progress
          v-if="busy || phase === 'done'"
          :percentage="Math.round(progress)"
          :status="phase === 'done' ? 'success' : undefined"
          :show-text="false"
        />

        <dl v-if="decodedDuration" class="audio-meta">
          <div><dt>时长</dt><dd>{{ formatAudioDuration(decodedDuration) }}</dd></div>
          <div><dt>源采样率</dt><dd>{{ (decodedSampleRate / 1000).toFixed(1) }} kHz</dd></div>
          <div><dt>源声道</dt><dd>{{ decodedChannels }}</dd></div>
          <div><dt>输出</dt><dd>MP3 · 128 kbps</dd></div>
        </dl>

        <audio v-if="outputUrl" class="audio-preview" :src="outputUrl" controls preload="metadata">
          当前环境不支持音频预览。
        </audio>
      </section>

      <div class="view-actions">
        <el-button v-if="busy" :icon="Close" @click="cancelExtraction">取消</el-button>
        <el-button v-else :disabled="!selectedFile" :icon="Close" @click="clearSelection">清除</el-button>
        <el-button type="primary" :icon="Headset" :loading="busy" :disabled="!canExtract" @click="extractAudio">
          提取音频
        </el-button>
        <el-button type="success" :icon="Download" :disabled="!canDownload" @click="downloadMp3">
          下载 {{ outputName }}
        </el-button>
      </div>

      <aside class="privacy-note">
        <el-icon aria-hidden="true"><CircleCheck /></el-icon>
        <span>文件只在本机内存中处理，不经过 Desk API，也不会上传。AVI、MKV 等容器需先转换为浏览器可解码格式。</span>
      </aside>
    </main>
  </div>
</template>

<style scoped>
@import "../../pages/page-shared.css";

.audio-extract-page {
  min-height: 100%;
  color: var(--phoenix-text);
}

.extract-workspace {
  display: grid;
  gap: 14px;
  width: min(820px, 100%);
  margin: 0 auto;
}

.drop-zone {
  display: grid;
  justify-items: center;
  gap: 9px;
  width: 100%;
  min-height: 210px;
  padding: 30px 24px;
  border: 2px dashed var(--phoenix-border-strong);
  border-radius: var(--phoenix-radius-lg);
  background: var(--phoenix-bg-elevated);
  color: var(--phoenix-text);
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
}

.drop-zone:hover:not(:disabled),
.drop-zone:focus-visible,
.drop-zone.is-drag-active {
  border-color: var(--phoenix-accent);
  background: var(--phoenix-accent-soft);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--phoenix-focus-ring) 28%, transparent);
  outline: none;
}

.drop-zone:disabled {
  cursor: wait;
  opacity: 0.72;
}

.drop-zone strong {
  max-width: 100%;
  overflow: hidden;
  font-size: 1.02rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drop-zone span {
  color: var(--phoenix-text-muted);
  font-size: 0.82rem;
}

.drop-icon {
  width: 48px;
  height: 48px;
  color: var(--phoenix-accent);
  font-size: 48px;
}

.status-card {
  display: grid;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid var(--phoenix-border);
  border-radius: var(--phoenix-radius-md);
  background: var(--phoenix-bg-elevated);
  box-shadow: var(--phoenix-shadow-sm);
}

.status-heading {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.status-heading p {
  margin: 3px 0 0;
  color: var(--phoenix-text-muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.status-icon {
  display: inline-grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 50%;
  background: var(--phoenix-accent-soft);
  color: var(--phoenix-accent);
  font-size: 18px;
}

.status-icon.is-done {
  color: var(--el-color-success);
}

.status-icon.is-error {
  color: var(--phoenix-danger);
}

.progress-label {
  color: var(--phoenix-text-muted);
  font-variant-numeric: tabular-nums;
  font-size: 0.78rem;
}

.audio-meta {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--phoenix-border);
  border-radius: var(--phoenix-radius-sm);
}

.audio-meta > div {
  min-width: 0;
  padding: 9px 11px;
  border-right: 1px solid var(--phoenix-border);
}

.audio-meta > div:last-child {
  border-right: 0;
}

.audio-meta dt {
  color: var(--phoenix-text-muted);
  font-size: 0.72rem;
}

.audio-meta dd {
  margin: 3px 0 0;
  font-size: 0.84rem;
  font-weight: 600;
}

.audio-preview {
  width: 100%;
  height: 36px;
}

.view-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.privacy-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--phoenix-border-subtle);
  border-radius: var(--phoenix-radius-sm);
  background: var(--phoenix-bg-muted);
  color: var(--phoenix-text-muted);
  font-size: 0.78rem;
  line-height: 1.5;
}

.privacy-note .el-icon {
  margin-top: 2px;
  color: var(--el-color-success);
}

.visually-hidden {
  position: fixed;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .tool-page {
    padding: 14px 12px 24px;
  }

  .drop-zone {
    min-height: 175px;
    padding: 24px 14px;
  }

  .audio-meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .audio-meta > div:nth-child(2) {
    border-right: 0;
  }

  .audio-meta > div:nth-child(-n + 2) {
    border-bottom: 1px solid var(--phoenix-border);
  }

  .view-actions .el-button {
    flex: 1 1 140px;
    margin-left: 0;
  }
}
</style>
