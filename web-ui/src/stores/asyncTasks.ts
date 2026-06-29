/** 异步任务进度 Pinia store — 多任务持久化到 localStorage。

  任何页面调用 useAsyncProgress() 后自动注册任务到此 store。
  页面刷新后可通过 hydrate() 恢复 UI 状态。
*/

import { defineStore } from "pinia";
import type { AsyncTaskState } from "../utils/asyncProgressTypes";
import {
  filterActiveTasks,
  hasRunningTasks,
  sortTasksByTime,
} from "../utils/asyncProgress";

const STORAGE_KEY = "phoenix-async-tasks-v1";

/** 任务取消防函数注册表（不持久化） */
const _cancelFns: Record<string, () => Promise<unknown>> = {};

export const useAsyncTaskStore = defineStore("asyncTasks", {
  state: () => ({
    /** taskId → AsyncTaskState */
    tasks: {} as Record<string, AsyncTaskState>,
    /** 浮层面板是否最小化 */
    overlayMinimized: false,
    /** 是否全屏遮罩模式 */
    fullscreen: false,
    /** 已从 localStorage 恢复过 */
    hydrated: false,
  }),

  getters: {
    /** 运行中的任务列表 */
    activeTasks: (s) => filterActiveTasks(Object.values(s.tasks)),

    /** 全部任务按时间倒序 */
    taskList: (s) => sortTasksByTime(Object.values(s.tasks)),

    /** 是否有运行中的任务 */
    hasRunning: (s) => hasRunningTasks(Object.values(s.tasks)),
  },

  actions: {
    /** 从 localStorage 恢复上次会话的任务状态。上次遗留的 running 任务自动清理。 */
    hydrate() {
      if (this.hydrated) return;
      this.hydrated = true;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const data = JSON.parse(raw) as {
            tasks?: Record<string, AsyncTaskState>;
            overlayMinimized?: boolean;
            fullscreen?: boolean;
          };
          if (data.tasks && typeof data.tasks === "object") {
            for (const t of Object.values(data.tasks)) {
              if (t.status === "running") {
                // 上次会话遗留的 running 任务 → 标记为 orphaned，由 resume API 最终确认
                this.tasks[t.taskId] = { ...t, status: "orphaned", finishedAt: new Date().toISOString() };
              } else {
                this.tasks[t.taskId] = t;
              }
            }
          }
          if (typeof data.overlayMinimized === "boolean") {
            this.overlayMinimized = data.overlayMinimized;
          }
          if (typeof data.fullscreen === "boolean") {
            this.fullscreen = data.fullscreen;
          }
        }
      } catch {
        /* ignore corrupt storage */
      }
      // 清理上一次的残留 running 写入
      this._persist();
    },

    /** 持久化当前状态到 localStorage */
    _persist() {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            tasks: this.tasks,
            overlayMinimized: this.overlayMinimized,
            fullscreen: this.fullscreen,
          }),
        );
      } catch {
        /* storage full — ignore */
      }
    },

    /** 添加或更新一个任务 */
    upsertTask(task: AsyncTaskState) {
      this.tasks[task.taskId] = task;
      this._persist();
    },

    /** 确认一个已完成的任务 */
    confirmTask(taskId: string) {
      const t = this.tasks[taskId];
      if (t && t.status !== "running") {
        this.tasks[taskId] = { ...t, confirmed: true };
        this._persist();
      }
    },

    /** 移除一个任务 */
    removeTask(taskId: string) {
      delete this.tasks[taskId];
      this._persist();
    },

    /** 清除已完成/取消/出错且已确认的 */
    clearCompleted() {
      for (const [id, t] of Object.entries(this.tasks)) {
        if (t.status !== "running" && t.confirmed) {
          delete this.tasks[id];
        }
      }
      this._persist();
    },

    /** 设置浮层最小化状态 */
    setMinimized(v: boolean) {
      this.overlayMinimized = v;
      if (v) this.fullscreen = false; // 最小化时退出全屏
      this._persist();
    },

    /** 注册任务的取消函数（由 composable 调用） */
    registerCancel(taskId: string, fn: () => Promise<unknown>) {
      _cancelFns[taskId] = fn;
    },

    /** 注销取消函数 */
    unregisterCancel(taskId: string) {
      delete _cancelFns[taskId];
    },

    /** 停止一个运行中的任务 */
    async cancelTask(taskId: string) {
      const fn = _cancelFns[taskId];
      if (fn) {
        try { await fn(); } catch { /* ignore */ }
        delete _cancelFns[taskId];
      }
      // 标记为已取消
      const t = this.tasks[taskId];
      if (t) {
        this.tasks[taskId] = { ...t, status: "cancelled", finishedAt: new Date().toISOString() };
        this._persist();
      }
    },

    /** 设置全屏遮罩 */
    setFullscreen(v: boolean) {
      this.fullscreen = v;
      if (v) this.overlayMinimized = false;
      this._persist();
    },
  },
});
