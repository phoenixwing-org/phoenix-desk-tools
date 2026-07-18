import { ref, type ComputedRef, type Ref } from "vue";
import type { CaaDialogIr, CaaDialogNode } from "../types/caaDialogIr";
import {
  addChildNode,
  findCaaNode,
  insertGridCol,
  insertGridRow,
  removeChildNode,
  renumberGrid,
} from "../utils/caaDialogTree";
import { buildBuilderRecord, type BuilderRecord } from "../utils/caaDropZone";
import type {
  CaaContextMenuItem,
  CaaControlContext,
  CaaNlsEditTarget,
} from "./useCaaControlContext";

export interface CaaDialogCanvasControllerState {
  readonly ir: Ref<CaaDialogIr | null>;
  readonly selectedId: Ref<string | null>;
  readonly canEditNls: ComputedRef<boolean>;
  readonly activeLocale: Ref<string>;
  readonly editMode: Ref<boolean>;
}

export interface CaaDialogCanvasControllerPorts {
  readonly recordHistory: () => void;
  readonly markDirty: (mode?: "patch" | "full") => void;
  readonly syncSidebar: () => void;
  readonly mirrorSelection: (nodeId: string) => void;
  readonly syncNls: () => void;
  readonly commitNls: (
    key: string,
    value: string,
    target: CaaNlsEditTarget,
  ) => void;
}

export interface UseCaaDialogCanvasControllerOptions {
  readonly state: CaaDialogCanvasControllerState;
  readonly ports: CaaDialogCanvasControllerPorts;
}

/**
 * CAA Canvas command controller.
 *
 * It owns Canvas-local transient state and IR command orchestration. Active Tab,
 * keyboard listeners, Pinia, PageSession, Host APIs, Shell and locale UI remain
 * Page responsibilities and enter only through explicit refs/ports.
 */
export function useCaaDialogCanvasController(
  options: UseCaaDialogCanvasControllerOptions,
) {
  const { state, ports } = options;

  const dropIndicator = ref<{
    rect: { left: number; top: number; width: number; height: number } | null;
    edge: "inside" | "right" | "bottom" | "left" | "top";
  }>({ rect: null, edge: "inside" });
  const contextMenuVisible = ref(false);
  const contextMenuItems = ref<CaaContextMenuItem[]>([]);
  const contextMenuPosition = ref({ x: 0, y: 0 });
  const contextMenuTargetId = ref<string | null>(null);
  const lastBuilderRecord = ref<BuilderRecord | null>(null);
  const dragJustEnded = ref(false);

  function showContextMenu(
    nodeId: string,
    items: CaaContextMenuItem[],
    pos: { x: number; y: number },
  ) {
    contextMenuTargetId.value = nodeId;
    contextMenuItems.value = items;
    contextMenuPosition.value = pos;
    contextMenuVisible.value = true;
  }

  function hideContextMenu() {
    contextMenuVisible.value = false;
    contextMenuTargetId.value = null;
  }

  function toggleGridRowResize(containerId: string, rowIndex: number) {
    const root = state.ir.value?.root;
    if (!root) return;
    const node = findCaaNode(root, containerId);
    if (!node) return;
    ports.recordHistory();
    const gl = node.gridLayout ?? {};
    const cur = [...(gl.rowResizable ?? [])];
    const idx = cur.indexOf(rowIndex);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(rowIndex);
    cur.sort((a, b) => a - b);
    node.gridLayout = { ...gl, rowResizable: cur };
    ports.markDirty("patch");
    ports.syncSidebar();
  }

  function toggleGridColResize(containerId: string, colIndex: number) {
    const root = state.ir.value?.root;
    if (!root) return;
    const node = findCaaNode(root, containerId);
    if (!node) return;
    ports.recordHistory();
    const gl = node.gridLayout ?? {};
    const cur = [...(gl.colResizable ?? [])];
    const idx = cur.indexOf(colIndex);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(colIndex);
    cur.sort((a, b) => a - b);
    node.gridLayout = { ...gl, colResizable: cur };
    ports.markDirty("patch");
    ports.syncSidebar();
  }

  function setGridRowResize(
    containerId: string,
    rowIndex: number,
    enabled: boolean,
    opts?: { recordHistory?: boolean },
  ) {
    const root = state.ir.value?.root;
    if (!root) return;
    const node = findCaaNode(root, containerId);
    if (!node) return;
    const gl = node.gridLayout ?? {};
    const cur = [...(gl.rowResizable ?? [])];
    const idx = cur.indexOf(rowIndex);
    const hasValue = idx >= 0;
    if (hasValue === enabled) return;
    if (opts?.recordHistory !== false) ports.recordHistory();
    if (enabled) cur.push(rowIndex);
    else cur.splice(idx, 1);
    cur.sort((a, b) => a - b);
    node.gridLayout = { ...gl, rowResizable: cur };
    ports.markDirty("patch");
    ports.syncSidebar();
  }

  function setGridColResize(
    containerId: string,
    colIndex: number,
    enabled: boolean,
    opts?: { recordHistory?: boolean },
  ) {
    const root = state.ir.value?.root;
    if (!root) return;
    const node = findCaaNode(root, containerId);
    if (!node) return;
    const gl = node.gridLayout ?? {};
    const cur = [...(gl.colResizable ?? [])];
    const idx = cur.indexOf(colIndex);
    const hasValue = idx >= 0;
    if (hasValue === enabled) return;
    if (opts?.recordHistory !== false) ports.recordHistory();
    if (enabled) cur.push(colIndex);
    else cur.splice(idx, 1);
    cur.sort((a, b) => a - b);
    node.gridLayout = { ...gl, colResizable: cur };
    ports.markDirty("patch");
    ports.syncSidebar();
  }

  function selectControl(nodeId: string) {
    state.selectedId.value = nodeId;
    ports.mirrorSelection(nodeId);
  }

  function removeControlFromContainer(
    containerId: string,
    nodeId: string,
  ): boolean {
    const root = state.ir.value?.root;
    if (!root || nodeId === root.id) return false;
    const container = findCaaNode(root, containerId);
    if (!container) return false;
    const nextChildren = container.children.filter((child) => child.id !== nodeId);
    if (nextChildren.length === container.children.length) return false;
    ports.recordHistory();
    container.children = nextChildren;
    renumberGrid(container);
    if (state.selectedId.value === nodeId) {
      state.selectedId.value = containerId;
      ports.mirrorSelection(containerId);
    }
    ports.markDirty("full");
    ports.syncSidebar();
    return true;
  }

  function deleteSelectedControl(): boolean {
    const root = state.ir.value?.root;
    const selectedId = state.selectedId.value;
    if (!root || !selectedId || selectedId === root.id) return false;
    const selectedNode = findCaaNode(root, selectedId);
    const parentId = selectedNode?.father;
    if (!parentId) return false;
    return removeControlFromContainer(parentId, selectedId);
  }

  /** Builder deletion keeps its existing NLS cleanup semantics. */
  function removeControlImpl(containerId: string, nodeId: string) {
    const root = state.ir.value?.root;
    if (!root) return;
    const container = findCaaNode(root, containerId);
    if (!container) return;

    const childrenBefore = container.children.map((child) => ({
      ...child,
      grid: child.grid ? { ...child.grid } : undefined,
      children: child.children,
    }));
    const { removed, newChildren } = removeChildNode(container.children, nodeId);
    container.children = newChildren;
    renumberGrid(container);
    ports.markDirty();
    ports.syncSidebar();

    if (removed) {
      lastBuilderRecord.value = buildBuilderRecord({
        operation: "DELETE",
        sourceContainerId: null,
        targetContainerId: containerId,
        sourceChildrenBefore: null,
        targetChildrenBefore: childrenBefore,
        targetChildrenAfter: container.children.map((child) => ({
          ...child,
          grid: child.grid ? { ...child.grid } : undefined,
          children: child.children,
        })),
        sourceChildrenAfter: null,
        affectedNodeId: nodeId,
        affectedNodeType: removed.type,
      });
    }

    ports.syncNls();
  }

  const controlContext: CaaControlContext = {
    get dialogRoot() {
      return state.ir.value?.root ?? null;
    },
    selectedId: state.selectedId,
    select: selectControl,
    canEdit: state.canEditNls,
    activeLocale: state.activeLocale,
    commitNls: ports.commitNls,
    showContextMenu,
    hideContextMenu,
    contextMenuVisible,
    contextMenuItems,
    contextMenuPosition,
    contextMenuTargetId,
    toggleGridRowResize,
    toggleGridColResize,
    setGridRowResize,
    setGridColResize,
    editMode: state.editMode,
    dropIndicator,
    addControl(containerId: string, typeOrNodeId: string, row: number, col: number) {
      const root = state.ir.value?.root;
      if (!root) return "";
      const container = findCaaNode(root, containerId);
      if (!container) return "";
      ports.recordHistory();
      const existing = findCaaNode(root, typeOrNodeId);
      if (existing) {
        existing.grid = { ...existing.grid, row, col, rowSpan: 1, colSpan: 1 };
        existing.father = containerId;
        container.children.push(existing);
      } else {
        addChildNode(container, typeOrNodeId, { row, col });
      }
      renumberGrid(container);
      ports.markDirty("full");
      ports.syncSidebar();
      ports.syncNls();
      return typeOrNodeId;
    },
    removeControl(containerId: string, nodeId: string) {
      removeControlImpl(containerId, nodeId);
    },
    insertRow(containerId: string, beforeRow: number) {
      const root = state.ir.value?.root;
      if (!root) return;
      const container = findCaaNode(root, containerId);
      if (!container) return;
      ports.recordHistory();
      insertGridRow(container, beforeRow);
      renumberGrid(container);
      ports.markDirty("full");
      ports.syncSidebar();
    },
    insertCol(containerId: string, beforeCol: number) {
      const root = state.ir.value?.root;
      if (!root) return;
      const container = findCaaNode(root, containerId);
      if (!container) return;
      ports.recordHistory();
      insertGridCol(container, beforeCol);
      renumberGrid(container);
      ports.markDirty("full");
      ports.syncSidebar();
    },
    recordHistory: ports.recordHistory,
    setChildren(containerId: string, children: CaaDialogNode[], selectId?: string) {
      const root = state.ir.value?.root;
      if (!root) return;
      const container = findCaaNode(root, containerId);
      if (!container) return;
      container.children = children;
      renumberGrid(container);
      if (selectId) state.selectedId.value = selectId;
      ports.markDirty("full");
      ports.syncSidebar();
    },
    lastBuilderRecord,
    dragJustEnded,
  };

  return {
    controlContext,
    deleteSelectedControl,
  };
}
