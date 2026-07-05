import type { ComputedRef, InjectionKey, Ref } from "vue";
import type { NlsStringProp } from "@desk-tools/catdlg-core";
import type { CaaDialogNode } from "../types/caaDialogIr";
import type { DropEdge, BuilderRecord } from "../utils/caaDropZone";

/** 右键菜单项 */
export interface CaaContextMenuItem {
  label: string;
  action: () => void;
  divider?: boolean;
  disabled?: boolean;
}

/** NLS 编辑目标定位 */
export interface CaaNlsEditTarget {
  nodeId: string;
  prop: NlsStringProp;
  columnIndex?: number;
}

/**
 * 对话框级共享上下文 —— 通过 provide/inject 传递给每个控件组件，
 * 避免 props 层层透传。
 */
export interface CaaControlContext {
  /** 对话框根节点（NLS 路径计算用） */
  dialogRoot: CaaDialogNode | null;
  /** 当前选中的控件 ID */
  selectedId: Ref<string | null>;
  /** 选中控件（画布 + 树联动） */
  select: (nodeId: string) => void;
  /** 是否可编辑（非 Demo 且有 .CATNls） */
  canEdit: ComputedRef<boolean>;
  /** 当前活动的 NLS locale */
  activeLocale: Ref<string>;
  /** NLS 内联编辑提交 */
  commitNls: (key: string, value: string, target: CaaNlsEditTarget) => void;
  /** 右键菜单显示 */
  showContextMenu: (nodeId: string, items: CaaContextMenuItem[], pos: { x: number; y: number }) => void;
  /** 右键菜单关闭 */
  hideContextMenu: () => void;
  /** 右键菜单可见状态 */
  contextMenuVisible: Ref<boolean>;
  /** 右键菜单项 */
  contextMenuItems: Ref<CaaContextMenuItem[]>;
  /** 右键菜单位置 */
  contextMenuPosition: Ref<{ x: number; y: number }>;
  /** 右键菜单目标控件 ID */
  contextMenuTargetId: Ref<string | null>;
  /** Grid 行伸缩开关（按 container nodeId + row index） */
  toggleGridRowResize: (containerId: string, rowIndex: number) => void;
  /** Grid 列伸缩开关（按 container nodeId + col index） */
  toggleGridColResize: (containerId: string, colIndex: number) => void;
  /** Set ROWRES flag directly; used by header drag batching. */
  setGridRowResize: (containerId: string, rowIndex: number, enabled: boolean, opts?: { recordHistory?: boolean }) => void;
  /** Set COLRES flag directly; used by header drag batching. */
  setGridColResize: (containerId: string, colIndex: number, enabled: boolean, opts?: { recordHistory?: boolean }) => void;
  /** 拖拽/插入模式：控制工具箱显示 + 拖放/span resize + grid 指示器 */
  editMode: Ref<boolean>;
  /** Builder 模式：向容器添加控件，返回新节点 ID */
  addControl: (containerId: string, type: string, row: number, col: number) => string;
  /** Builder 模式：插入行 */
  insertRow: (containerId: string, beforeRow: number) => void;
  /** Builder 模式：插入列 */
  insertCol: (containerId: string, beforeCol: number) => void;
  /** Builder 模式：从容器移除控件，返回被移除的节点 */
  removeControl: (containerId: string, nodeId: string) => void;
  /** Builder 拖放指示器状态：顶层 overlay 读取（唯一的拖拽视觉反馈） */
  dropIndicator: Ref<{ rect: { left: number; top: number; width: number; height: number } | null; edge: DropEdge }>;
  /** Builder：在即将修改 IR 前记录 undo 快照 */
  recordHistory: () => void;
  /** Builder：原子替换容器子节点（批量操作入口） */
  setChildren: (containerId: string, children: CaaDialogNode[], selectId?: string) => void;
  /** Builder 操作历史记录（供撤销/重做消费，目前记录最近一次） */
  lastBuilderRecord: Ref<BuilderRecord | null>;
  /** 拖拽刚结束标记：控件 onClick 检查此标记跳过选中（防止拖拽后误触发 click） */
  dragJustEnded: Ref<boolean>;
}

export const CAA_CONTROL_KEY: InjectionKey<CaaControlContext> = Symbol("caaControl");
