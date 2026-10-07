import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import PrimaryTaskProgress from "./PrimaryTaskProgress.vue";
import { cadIndexProgress } from "../../models/cadIndexProgress";

it("does not fabricate percentage before CAD discovery has a total", async () => {
  const html = await renderToString(createSSRApp(PrimaryTaskProgress, { progress: cadIndexProgress({ state: "running", phase: "checking", scanned: 25, message: "checking" }) }));
  expect(html).toContain("已处理 25 个文件");
  expect(html).toContain('aria-current="step"');
  expect(html.match(/<progress[^>]*>/)?.[0]).not.toMatch(/\svalue=/);
});
it("shows actual batch counts and only marks success on completion", async () => {
  const html = await renderToString(createSSRApp(PrimaryTaskProgress, { progress: { label: "改名", state: "running", completed: 2, total: 4 } }));
  expect(html).toContain('value="50"'); expect(html).toContain("2 / 4 项");
  const done = await renderToString(createSSRApp(PrimaryTaskProgress, { progress: cadIndexProgress({ state: "done", phase: "committing", scanned: 25, message: "done" }) }));
  expect(done).toContain('value="100"'); expect(done).toContain("已完成");
});

it("stops the indeterminate indicator after an index failure", async () => {
  const html = await renderToString(createSSRApp(PrimaryTaskProgress, { progress: { label: "CAD 索引", state: "failed", completed: 3 } }));
  expect(html.match(/<progress[^>]*>/)?.[0]).toContain('value="0"');
  expect(html).toContain("未完成");
  expect(html).not.toContain("总量统计中");
  expect(html).not.toContain("0%");
});
