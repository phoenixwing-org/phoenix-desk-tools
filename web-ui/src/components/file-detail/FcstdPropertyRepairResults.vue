<script setup lang="ts">
import type { FcstdPropertyAnalysis, FcstdPropertyRepairResult } from "../../api";
defineProps<{ analysis: FcstdPropertyAnalysis | null; result: FcstdPropertyRepairResult | null; error: string; busy: boolean }>();
const selected = defineModel<string[]>("selected", { required: true });
const emit = defineEmits<{ open: [rel: string] }>();
</script>

<template>
  <section class="property-repair-results" aria-label="属性计数检查结果">
    <h2>属性修正 · 计数检查</h2>
    <p>只核对并修正 <code>Properties Count</code>，不改字段值、分组、Label 或 XLink。覆盖目录及其子目录，不依赖 CAD 索引。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="analysis">
      <p>已检查 {{ analysis.scanned }} 个 FCStd · 异常 {{ analysis.files.length }} 个文件 · 读取失败/跳过 {{ analysis.errors.length }} 项</p>
      <div v-if="analysis.files.length" class="table-wrap">
        <table>
          <thead><tr><th>写入</th><th>文件 / 根对象或内部对象</th><th>声明计数 → 实际计数</th></tr></thead>
          <tbody>
            <tr v-for="file in analysis.files" :key="file.rel">
              <td><input v-model="selected" type="checkbox" :value="file.rel" :aria-label="`修正 ${file.rel}`" :disabled="busy || !!result" /></td>
              <td><button type="button" class="file-link" @click="emit('open', file.rel)">{{ file.rel }}</button></td>
              <td><div v-for="(issue, index) in file.issues" :key="index"><code>{{ issue.object_name }}</code>：{{ issue.declared_count ?? '缺失' }} → {{ issue.actual_count }}</div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <el-alert v-else :title="analysis.errors.length ? '已读文件未发现计数错误，但检查不完整，请处理下列读取问题。' : '本范围未发现属性计数错误（不代表字段值或其他属性规则均正确）。'" :type="analysis.errors.length ? 'warning' : 'success'" :closable="false" />
      <ul v-if="analysis.errors.length"><li v-for="item in analysis.errors" :key="item.rel">{{ item.rel }}：{{ item.message }}</li></ul>
    </template>
    <p v-else-if="!error">勾选「属性修正」后点击上方「分析」。</p>
    <ul v-if="result" aria-label="属性修正执行结果"><li v-for="item in result.results" :key="item.rel">{{ item.status === 'fixed' ? '已修正' : '未写入' }} · {{ item.rel }}：{{ item.message }}</li></ul>
  </section>
</template>

<style scoped>
.property-repair-results { padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-bg, var(--bg)); margin-bottom: 14px; }
h2 { font-size: .95rem; margin: 0 0 8px; }
p { font-size: .85rem; color: var(--muted); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; text-align: left; font-size: .85rem; }
td, th { padding: 8px; border-bottom: 1px solid var(--border); }
.file-link { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; text-align: left; overflow-wrap: anywhere; }
li { font-size: .85rem; overflow-wrap: anywhere; }
</style>
