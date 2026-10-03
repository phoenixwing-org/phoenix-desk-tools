import { createMp3Encoder } from "wasm-media-encoders";

/** Browser-only media extraction core; intentionally independent from Desk API. */

export const AUDIO_EXTRACT_BITRATE_KBPS = 128 as const;
export const AUDIO_EXTRACT_OUTPUT_SAMPLE_RATE = 44_100 as const;

const MEDIA_EXTENSION_RE = /\.(?:mp4|m4v|mov|webm|m4a|mp3|wav|ogg|aac|flac)$/iu;
const ENCODE_CHUNK_FRAMES = 4_608;

export type AudioBufferLike = Pick<
  AudioBuffer,
  "duration" | "length" | "numberOfChannels" | "sampleRate" | "getChannelData"
>;

export type Mp3EncodeProgress = {
  processedFrames: number;
  totalFrames: number;
  ratio: number;
};

export function isSupportedMediaFile(file: Pick<File, "name" | "type">): boolean {
  const mimeType = file.type.trim().toLowerCase();
  return mimeType.startsWith("video/")
    || mimeType.startsWith("audio/")
    || MEDIA_EXTENSION_RE.test(file.name.trim());
}

export function mp3FileName(sourceName: string): string {
  const trimmed = sourceName.trim();
  const base = trimmed.replace(/\.[^.]+$/u, "").trim();
  return `${base || "提取音频"}.mp3`;
}

export function formatMediaBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

export function formatAudioDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const rest = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function abortIfRequested(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("音频提取已取消", "AbortError");
}

async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function stereoChunk(buffer: AudioBufferLike, offset: number, end: number): readonly Float32Array[] {
  if (buffer.numberOfChannels === 1) {
    return [buffer.getChannelData(0).subarray(offset, end)];
  }
  if (buffer.numberOfChannels === 2) {
    return [
      buffer.getChannelData(0).subarray(offset, end),
      buffer.getChannelData(1).subarray(offset, end),
    ];
  }

  const frameCount = end - offset;
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  let leftChannels = 0;
  let rightChannels = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = channel % 2 === 0 ? left : right;
    if (channel % 2 === 0) leftChannels += 1;
    else rightChannels += 1;
    for (let index = 0; index < frameCount; index += 1) {
      target[index] += source[offset + index] ?? 0;
    }
  }
  for (let index = 0; index < frameCount; index += 1) {
    left[index] /= leftChannels || 1;
    right[index] /= rightChannels || leftChannels || 1;
  }
  return [left, rightChannels ? right : left];
}

/** Encode a decoded browser AudioBuffer without uploading source data. */
export async function encodeAudioBufferToMp3(
  buffer: AudioBufferLike,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: Mp3EncodeProgress) => void;
  } = {},
): Promise<Blob> {
  if (buffer.numberOfChannels < 1 || buffer.length < 1 || buffer.sampleRate < 1) {
    throw new Error("媒体文件中没有可编码的音频轨道");
  }

  abortIfRequested(options.signal);
  const outputChannels = buffer.numberOfChannels === 1 ? 1 : 2;
  const encoder = await createMp3Encoder();
  encoder.configure({
    channels: outputChannels,
    sampleRate: buffer.sampleRate,
    bitrate: AUDIO_EXTRACT_BITRATE_KBPS,
    outputSampleRate: AUDIO_EXTRACT_OUTPUT_SAMPLE_RATE,
  });

  const chunks: BlobPart[] = [];
  for (let offset = 0; offset < buffer.length; offset += ENCODE_CHUNK_FRAMES) {
    abortIfRequested(options.signal);
    const end = Math.min(offset + ENCODE_CHUNK_FRAMES, buffer.length);
    const encoded = encoder.encode(stereoChunk(buffer, offset, end));
    if (encoded.length) chunks.push(Uint8Array.from(encoded).buffer);
    const processedFrames = end;
    options.onProgress?.({
      processedFrames,
      totalFrames: buffer.length,
      ratio: processedFrames / buffer.length,
    });
    if ((offset / ENCODE_CHUNK_FRAMES) % 24 === 23) await yieldToBrowser();
  }

  abortIfRequested(options.signal);
  const finalChunk = encoder.finalize();
  if (finalChunk.length) chunks.push(Uint8Array.from(finalChunk).buffer);
  const blob = new Blob(chunks, { type: "audio/mpeg" });
  if (!blob.size) throw new Error("MP3 编码器没有产生输出");
  return blob;
}

export async function decodeMediaFile(file: File): Promise<AudioBuffer> {
  const AudioContextClass = globalThis.AudioContext;
  if (!AudioContextClass) throw new Error("当前 WebView 不支持 Web Audio 解码");
  const context = new AudioContextClass();
  try {
    return await context.decodeAudioData(await file.arrayBuffer());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法解码该媒体文件；请改用浏览器支持的 MP4、WebM、MOV 或音频格式。${detail ? ` ${detail}` : ""}`);
  } finally {
    await context.close().catch(() => undefined);
  }
}
