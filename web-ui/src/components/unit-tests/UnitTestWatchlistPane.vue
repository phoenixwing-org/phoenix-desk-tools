<script setup lang="ts">
import { computed } from "vue";
import type { UnitTestWatchlistRowView } from "../../models/unitTestsViewModel";

type WatchlistSortBy = "fail_count" | "last_seen_at";

const props = defineProps<{
  rows: readonly UnitTestWatchlistRowView[];
  running: boolean;
  sortBy: WatchlistSortBy;
  defaultRunOnFull: boolean;
  rerunningId: string | null;
}>();

const emit = defineEmits<{
  sort: [sortBy: WatchlistSortBy];
  defaultRunOnFull: [checked: boolean];
  allChecked: [checked: boolean];
  checked: [id: string, checked: boolean];
  runOnFull: [id: string, checked: boolean];
  runSelected: [];
  runWatchlist: [];
  rerun: [row: UnitTestWatchlistRowView];
  removeRequest: [row: UnitTestWatchlistRowView];
  clearRequest: [];
}>();

const selectedCount = computed(() => props.rows.filter((row) => row.selected).length);
const totalFails = computed(() => props.rows.reduce((sum, row) => sum + row.failCount, 0));
const allChecked = computed(() => props.rows.length > 0 && selectedCount.value === props.rows.length);
</script>

<template>
  <section
    class="card watchlist-card unit-test-watchlist-pane"
    data-testid="unit-test-watchlist-pane"
  >
    <div class="watchlist-head">
      <p class="watchlist-desc muted">
        失败/错误用例记入本机（localStorage），<strong>累计失败次数</strong>；通过不会自动移出，可逐条「移除」或「全部移除」。勾选后点「复测勾选」，或行内「复测」；需跑全部时点「全部复测」。
      </p>
      <div class="watchlist-actions">
        <span v-if="rows.length" class="watchlist-stats muted small">
          {{ rows.length }} 条 · 累计失败 {{ totalFails }} 次
          <template v-if="selectedCount"> · 已勾选 {{ selectedCount }}</template>
        </span>
        <el-radio-group
          v-if="rows.length"
          :model-value="sortBy"
          size="small"
          @change="emit('sort', $event as WatchlistSortBy)"
        >
          <el-radio-button value="last_seen_at">最近失败</el-radio-button>
          <el-radio-button value="fail_count">失败次数</el-radio-button>
        </el-radio-group>
        <el-checkbox
          :model-value="defaultRunOnFull"
          @change="emit('defaultRunOnFull', Boolean($event))"
        >
          新失败默认全量时运行
        </el-checkbox>
        <div class="watchlist-run-actions">
          <el-button
            type="primary"
            size="small"
            :disabled="running || !selectedCount"
            @click="emit('runSelected')"
          >
            复测勾选（{{ selectedCount }}）
          </el-button>
          <el-button
            link
            size="small"
            :disabled="running || !rows.length"
            @click="emit('runWatchlist')"
          >
            全部复测
          </el-button>
          <el-button
            link
            size="small"
            :disabled="running || !rows.length"
            @click="emit('clearRequest')"
          >
            全部移除
          </el-button>
        </div>
      </div>
    </div>

    <p v-if="!rows.length" class="muted empty-hint">
      暂无失败关注；运行测试后失败项会自动出现。
    </p>
    <div v-else class="watchlist-table-wrap" data-testid="unit-test-watchlist-scroll">
      <table class="data-table compact watchlist-table">
        <colgroup>
          <col class="col-check" />
          <col class="col-case" />
          <col class="col-intro" />
          <col class="col-suite" />
          <col class="col-num" />
          <col class="col-time" />
          <col class="col-full" />
          <col class="col-run" />
          <col class="col-action" />
        </colgroup>
        <thead>
          <tr>
            <th class="col-check">
              <el-checkbox
                :model-value="allChecked"
                :disabled="running || !rows.length"
                aria-label="全选失败关注"
                @change="emit('allChecked', Boolean($event))"
              />
            </th>
            <th class="col-case">用例</th>
            <th class="col-intro">简介</th>
            <th class="col-suite">套件</th>
            <th class="col-num">累计</th>
            <th class="col-time">最近失败</th>
            <th class="col-full">全量</th>
            <th class="col-run"></th>
            <th class="col-action"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            class="watchlist-row"
            :class="[
              row.statusClass,
              {
                'watchlist-row-running': rerunningId === row.id,
                'watchlist-row-disabled': running && rerunningId !== row.id,
              },
            ]"
          >
            <td class="col-check">
              <el-checkbox
                :model-value="row.selected"
                :disabled="running"
                :aria-label="`选择关注用例 ${row.method}`"
                @change="emit('checked', row.id, Boolean($event))"
              />
            </td>
            <td class="mono watchlist-case" :title="`${row.moduleLabel}\n${row.message}`">
              <span class="watchlist-method">{{ row.method }}</span>
              <span class="watchlist-msg">{{ row.message }}</span>
            </td>
            <td class="watchlist-intro" :title="row.description">
              {{ row.descriptionBrief }}
            </td>
            <td class="col-suite" :title="row.suiteLabel">{{ row.suiteLabel }}</td>
            <td class="col-num">{{ row.failCount }}</td>
            <td class="col-time" :title="row.lastSeenAt">{{ row.lastSeenLabel }}</td>
            <td class="col-full">
              <el-checkbox
                :model-value="row.runOnFull"
                :disabled="running"
                :aria-label="`${row.method} 全量时运行`"
                @change="emit('runOnFull', row.id, Boolean($event))"
              />
            </td>
            <td class="col-run">
              <el-button
                type="primary"
                plain
                size="small"
                :loading="rerunningId === row.id"
                :disabled="running && rerunningId !== row.id"
                @click="emit('rerun', row)"
              >
                复测
              </el-button>
            </td>
            <td class="col-action">
              <el-button
                link
                size="small"
                :disabled="running"
                @click="emit('removeRequest', row)"
              >
                移除
              </el-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.watchlist-card {
  box-sizing: border-box;
  max-width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  margin-bottom: 10px;
}

.watchlist-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 12px;
  margin-bottom: 10px;
}

.watchlist-desc {
  flex: 1;
  min-width: 220px;
  margin: 0;
  font-size: 0.76rem;
}

.watchlist-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.watchlist-run-actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.watchlist-stats {
  font-variant-numeric: tabular-nums;
}

.mono {
  font-family: ui-monospace, monospace;
  font-size: 0.78rem;
}

.muted {
  color: var(--muted);
}

.small {
  font-size: 0.76rem;
}

.watchlist-table-wrap {
  max-width: 100%;
  overflow-x: auto;
}

.watchlist-table {
  table-layout: fixed;
  width: 100%;
  min-width: 680px;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.watchlist-table col.col-check { width: 36px; }
.watchlist-table col.col-case { width: 24%; }
.watchlist-table col.col-intro { width: 32%; }
.watchlist-table col.col-suite { width: 72px; }
.watchlist-table col.col-num { width: 40px; }
.watchlist-table col.col-time { width: 88px; }
.watchlist-table col.col-full { width: 44px; }
.watchlist-table col.col-run { width: 52px; }
.watchlist-table col.col-action { width: 44px; }

.watchlist-table th,
.watchlist-table td {
  overflow: hidden;
  border: 1px solid var(--border);
  padding: 6px 8px;
  text-align: left;
  vertical-align: middle;
}

.watchlist-table th {
  background: #f9fafb;
  font-weight: 600;
}

.watchlist-table .col-num,
.watchlist-table td.col-num {
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.watchlist-table .col-time,
.watchlist-table td.col-time {
  white-space: nowrap;
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
}

.watchlist-table .col-check,
.watchlist-table td.col-check,
.watchlist-table .col-full,
.watchlist-table td.col-full,
.watchlist-table .col-run,
.watchlist-table td.col-run {
  text-align: center;
}

.watchlist-table .col-suite,
.watchlist-table td.col-suite {
  overflow: hidden;
  font-size: 0.72rem;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.watchlist-table .col-action,
.watchlist-table td.col-action {
  text-align: center;
  white-space: nowrap;
}

.watchlist-table th.col-full,
.watchlist-table th.col-time {
  font-size: 0.72rem;
  white-space: nowrap;
}

.watchlist-row:hover { background: transparent; }
.watchlist-row-running { background: #eff6ff; }
.watchlist-row-disabled { opacity: 0.65; }
.watchlist-table .watchlist-case { max-width: 0; }

.watchlist-method {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
}

.watchlist-table .watchlist-intro {
  max-width: 0;
  overflow: hidden;
  color: #475569;
  font-size: 0.72rem;
  line-height: 1.35;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.watchlist-msg {
  display: block;
  margin-top: 2px;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-hint {
  margin: 10px 0;
  text-align: center;
}
</style>
