import { computed, inject, type ComputedRef } from "vue";
import {
  nlsDisplayBinding,
  nlsKeyForProp,
  nlsPathSegments,
  type NlsStringProp,
} from "@desk-tools/catdlg-core";
import type { CaaDialogNode } from "../../../types/caaDialogIr";
import { CAA_CONTROL_KEY, type CaaContextMenuItem } from "../../../composables/useCaaControlContext";
import { caaControlWidthStyle, CAA_DIALOG_PREVIEW_WIDTH_PX } from "../../../utils/caaControlMetrics";

/**
 * 每个 CAA 控件组件的共享逻辑。
 * 封装：选中状态、NLS 绑定、点击处理、宽度样式。
 */
export function useCaaControl(
  props: { node: CaaDialogNode; fillParent?: boolean },
  opts?: {
    /** 外部计算的宽度样式（如 useCaaContainerResize），优先级最高 */
    widthOverride?: ComputedRef<Record<string, string> | undefined>;
  },
) {
  const ctx = inject(CAA_CONTROL_KEY, null);

  /** 对话框根节点（NLS 路径计算用） */
  const dialogRoot = computed(() => ctx?.dialogRoot ?? null);

  /** 当前控件是否为对话框根（CATDlgDialog） */
  const isDialog = computed(() => props.node.type === "CATDlgDialog");

  /** 是否选中 */
  const isSelected = computed(() => ctx?.selectedId.value === props.node.id);

  /** 是否可编辑 NLS */
  const canEdit = computed(() => ctx?.canEdit.value ?? false);

  /** 点击选中（拖拽刚结束时跳过，防止误触发） */
  function onClick(e: MouseEvent) {
    e.stopPropagation();
    if (ctx?.dragJustEnded.value) {
      ctx.dragJustEnded.value = false;
      return;
    }
    if (ctx) ctx.select(props.node.id);
  }

  /** 计算 NLS 显示绑定（Title 文本 + NLS 键） */
  function bindingFor(node: CaaDialogNode, opts?: { selectorPlaceholder?: string }) {
    const root = dialogRoot.value;
    if (!root) {
      return { text: node.id, prop: "title" as NlsStringProp, key: "Title" };
    }
    return nlsDisplayBinding(node, root, opts);
  }

  /** 当前控件的 Title 绑定 */
  const titleBinding = computed(() => bindingFor(props.node));

  /** ShortHelp → title tooltip（鼠标悬停显示） */
  const helpTooltip = computed(() => {
    const nls = props.node.nls;
    if (!nls) return undefined;
    return nls.shortHelp?.trim() || nls.help?.trim() || undefined;
  });

  /** 当前控件的选择列表占位绑定 */
  const selectorBinding = computed(() =>
    bindingFor(props.node, { selectorPlaceholder: "（选择列表）" }),
  );

  /** 控件宽度：外部 resize > fillParent 伸缩 > TW 固有宽度 */
  const widthStyle = computed(() => {
    if (opts?.widthOverride?.value) return opts.widthOverride.value;
    if (props.fillParent) return { width: "100%", boxSizing: "border-box" as const };
    return caaControlWidthStyle(props.node.size?.textWidth);
  });

  /** Dialog 外框宽度 */
  const dialogStyle = computed(() =>
    isDialog.value ? { width: `${CAA_DIALOG_PREVIEW_WIDTH_PX}px` } : undefined,
  );

  /** 列标题 NLS 绑定 */
  const columnTitleBindings = computed(() => {
    const root = dialogRoot.value;
    if (!root) return [];
    const segments = nlsPathSegments(props.node, root);
    const cc = props.node.size?.columnCount ?? props.node.nls?.columnTitles?.length ?? 0;
    return Array.from({ length: cc }, (_, i) => {
      const titles = props.node.nls?.columnTitles ?? [];
      return {
        text: titles[i]?.trim() || `Col ${i + 1}`,
        key: nlsKeyForProp(segments, "title", i),
        index: i,
      };
    });
  });

  /** 构建默认右键菜单项（各控件可扩展） */
  function buildDefaultMenu(): CaaContextMenuItem[] {
    const items: CaaContextMenuItem[] = [];
    const node = props.node;

    // 所有有 NLS 属性的控件都可编辑标题文案
    if (node.nls?.title !== undefined) {
      items.push({
        label: "编辑 Title",
        action: () => ctx?.select(node.id),
      });
    }

    // 有 Help 相关属性的控件可打开 NLS 编辑器
    if (node.nls?.help !== undefined || node.nls?.shortHelp !== undefined || node.nls?.longHelp !== undefined) {
      items.push({
        label: "编辑 Tooltip (Help/ShortHelp/LongHelp)",
        action: () => {
          ctx?.select(node.id);
          // 滚动到属性面板 NLS 分组
        },
      });
    }

    if (items.length > 0) {
      items.push({ divider: true, label: "", action: () => {} });
    }

    // Grid 属性（有 grid 的控件）
    if (node.grid) {
      items.push({
        label: `Grid: row=${node.grid.row} col=${node.grid.col} span=${node.grid.rowSpan}×${node.grid.colSpan}`,
        disabled: true,
        action: () => {},
      });
    }

    // 尺寸属性
    if (node.size) {
      const parts: string[] = [];
      if (node.size.textHeight != null) parts.push(`TH=${node.size.textHeight}`);
      if (node.size.textWidth != null) parts.push(`TW=${node.size.textWidth}`);
      if (node.size.columnCount != null) parts.push(`CC=${node.size.columnCount}`);
      if (parts.length) {
        items.push({
          label: `尺寸: ${parts.join(" ")}`,
          disabled: true,
          action: () => {},
        });
      }
    }

    // ── 删除（仅非根节点）──
    // 注意：删除前先选中父容器，方便用户感知删除后的上下文变化
    if (!isDialog.value && node.father) {
      items.push({ divider: true, label: "", action: () => {} });
      items.push({
        label: "删除控件",
        action: () => {
          if (ctx && node.father) {
            ctx.select(node.father);
            ctx.removeControl(node.father, node.id);
          }
        },
      });
    }

    return items;
  }

  /** 右键弹出菜单 */
  function onContextmenu(e: MouseEvent, extraItems?: CaaContextMenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    if (!ctx) return;
    // 右键同时选中
    ctx.select(props.node.id);
    const menu = [...buildDefaultMenu(), ...(extraItems ?? [])];
    ctx.showContextMenu(props.node.id, menu, { x: e.clientX, y: e.clientY });
  }

  return {
    ctx,
    dialogRoot,
    isDialog,
    isSelected,
    canEdit,
    onClick,
    onContextmenu,
    buildDefaultMenu,
    bindingFor,
    titleBinding,
    selectorBinding,
    helpTooltip,
    widthStyle,
    dialogStyle,
    columnTitleBindings,
  };
}
