<script setup lang="ts">
import { toRef } from "vue";
import SidebarBlock from "phoenix-wing/layout/PnwSidebarBlock.vue";
import { useCadIndexSearch } from "./useCadIndexSearch";

const props = defineProps<{ workspace: string; canUpdate: boolean; refreshToken?: string }>();
const emit = defineEmits<{ open: [rel: string]; update: []; refresh: [] }>();
const { query, result, error, errorCode, busy, canOpenResults, search } = useCadIndexSearch(toRef(props, "workspace"), toRef(props, "refreshToken"));
</script>

<template>
  <SidebarBlock title="文件资产检索" variant="card">
    <p class="search-description">单一关键词跨文件名、路径、编号、版本、名称、标签查询（六字段 OR）；按索引路径排序，最多 200 个 present 文件，不合并同一零件的多个文件。留空列出前 200 项。</p>
    <form class="search-form" @submit.prevent="search">
      <el-input v-model="query" aria-label="索引关键词" placeholder="文件名 / 路径 / 编号 / 版本 / 名称 / 标签" clearable />
      <el-button native-type="submit" type="primary" :loading="busy" :disabled="!workspace">搜索索引</el-button>
    </form>
    <p class="search-hint">这是只读 SQLite 检索，不扫描磁盘或读取模型；与工作空间树的“多词 AND 路径筛选”不同。% 和 _ 保留 SQLite LIKE 通配含义。此处没有可用内存扫描缓存，索引不可读时不会自动回退或隐式更新。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" role="alert" />
    <p v-else-if="busy" role="status">正在查询索引…</p>
    <template v-else-if="result">
      <p role="status">来源：{{ result.source }}（SQLite 文件资产索引） · {{ result.rows.length }} 项<span v-if="result.limitReached"> · 已达到 200 项上限，请缩小关键词</span></p>
      <el-alert v-if="result.diagnostics.state !== 'ready'" :title="result.diagnostics.message" type="warning" :closable="false" />
      <p v-if="!result.rows.length">索引没有匹配项。若文件新增或属性已改变，请手动「更新索引」；零命中不代表没有磁盘文件。</p>
      <el-table v-else :data="result.rows" size="small" aria-label="CAD 文件资产搜索结果">
        <el-table-column prop="filename" label="文件名" min-width="170" />
        <el-table-column prop="repo_rel_path" label="路径" min-width="220" />
        <el-table-column prop="part_number" label="编号" min-width="110" />
        <el-table-column prop="part_version" label="版本" min-width="80" />
        <el-table-column prop="part_name" label="名称" min-width="120" />
        <el-table-column prop="label" label="标签" min-width="120" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }"><el-button size="small" link type="primary" :disabled="!canOpenResults" @click="emit('open', row.repo_rel_path)">打开详情</el-button></template>
        </el-table-column>
      </el-table>
    </template>
    <p v-else>输入关键词后点击「搜索索引」。</p>
    <el-button v-if="errorCode === 'index_missing' || (result && (!result.rows.length || result.diagnostics.state !== 'ready'))" size="small" :disabled="!canUpdate" @click="emit('update')">更新索引</el-button>
    <el-button v-if="error && errorCode !== 'index_missing'" size="small" @click="emit('refresh')">刷新诊断</el-button>
  </SidebarBlock>
</template>

<style scoped>
.search-form { display: flex; gap: 8px; margin: 12px 0; }
.search-description, .search-hint { color: var(--muted); line-height: 1.65; font-size: 0.85rem; }
.search-hint { font-size: 0.78rem; }
@media (max-width: 600px) { .search-form { flex-direction: column; } }
</style>
