import type { ComputedRef, InjectionKey, Ref } from "vue";
import type { NlsStringProp } from "@phoenix/catdlg-core";
import type { CaaDialogNode } from "../types/caaDialogIr";

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
  /** 编辑模式：控制 grid bar / 辅助线 / 单元格边界显隐 */
  editMode: Ref<boolean>;
}

export const CAA_CONTROL_KEY: InjectionKey<CaaControlContext> = Symbol("caaControl");
