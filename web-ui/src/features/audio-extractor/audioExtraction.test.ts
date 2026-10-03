import { describe, expect, it } from "vitest";
import {
  encodeAudioBufferToMp3,
  formatAudioDuration,
  formatMediaBytes,
  isSupportedMediaFile,
  mp3FileName,
  type AudioBufferLike,
} from "./audioExtraction";

describe("audio extractor feature core", () => {
  it("accepts browser media MIME types and conservative filename fallbacks", () => {
    expect(isSupportedMediaFile({ name: "demo.mp4", type: "video/mp4" })).toBe(true);
    expect(isSupportedMediaFile({ name: "demo.MOV", type: "" })).toBe(true);
    expect(isSupportedMediaFile({ name: "demo.mkv", type: "" })).toBe(false);
    expect(isSupportedMediaFile({ name: "notes.txt", type: "text/plain" })).toBe(false);
  });

  it("formats output names, sizes, and durations", () => {
    expect(mp3FileName("demo.final.mp4")).toBe("demo.final.mp3");
    expect(mp3FileName(".mp4")).toBe("提取音频.mp3");
    expect(formatMediaBytes(1_572_864)).toBe("1.5 MB");
    expect(formatAudioDuration(65)).toBe("1:05");
    expect(formatAudioDuration(3_661)).toBe("1:01:01");
  });

  it("encodes decoded stereo PCM into a non-empty MP3 blob", async () => {
    const sampleRate = 44_100;
    const length = 4_410;
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      left[index] = Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 0.2;
      right[index] = Math.sin((index / sampleRate) * Math.PI * 2 * 660) * 0.2;
    }
    const buffer: AudioBufferLike = {
      duration: length / sampleRate,
      length,
      numberOfChannels: 2,
      sampleRate,
      getChannelData: (channel) => channel === 0 ? left : right,
    };

    const progress: number[] = [];
    const blob = await encodeAudioBufferToMp3(buffer, {
      onProgress: ({ ratio }) => progress.push(ratio),
    });

    expect(blob.type).toBe("audio/mpeg");
    expect(blob.size).toBeGreaterThan(100);
    expect(progress.at(-1)).toBe(1);
  });
});
