import type { Component } from "vue";
import CaaControlDialog from "./CaaControlDialog.vue";
import CaaControlFrame from "./CaaControlFrame.vue";
import CaaControlTabContainer from "./CaaControlTabContainer.vue";
import CaaControlTabPage from "./CaaControlTabPage.vue";
import CaaControlContainer from "./CaaControlContainer.vue";
import CaaControlLabel from "./CaaControlLabel.vue";
import CaaControlEditor from "./CaaControlEditor.vue";
import CaaControlSelectorList from "./CaaControlSelectorList.vue";
import CaaControlMultiList from "./CaaControlMultiList.vue";
import CaaControlPushButton from "./CaaControlPushButton.vue";
import CaaControlSpinner from "./CaaControlSpinner.vue";
import CaaControlCheckButton from "./CaaControlCheckButton.vue";
import CaaControlRadioButton from "./CaaControlRadioButton.vue";
import CaaControlCombo from "./CaaControlCombo.vue";
import CaaControlSeparator from "./CaaControlSeparator.vue";
import CaaControlCatalogBox from "./CaaControlCatalogBox.vue";
import CaaControlUnknown from "./CaaControlUnknown.vue";

/**
 * CAA 控件类型 → Vue 组件映射。
 * 每个 CATDlg* 类型对应一个独立的 .vue 组件，封装行为与样式。
 */
const caaControlMap: Record<string, Component> = {
  CATDlgDialog: CaaControlDialog,
  CATDlgFrame: CaaControlFrame,
  CATDlgTabContainer: CaaControlTabContainer,
  CATDlgTabPage: CaaControlTabPage,
  CATDlgContainer: CaaControlContainer,
  CATDlgLabel: CaaControlLabel,
  CATDlgEditor: CaaControlEditor,
  CATDlgSelectorList: CaaControlSelectorList,
  CATDlgMultiList: CaaControlMultiList,
  CATDlgPushButton: CaaControlPushButton,
  CATDlgSpinner: CaaControlSpinner,
  CATDlgCheckButton: CaaControlCheckButton,
  CATDlgRadioButton: CaaControlRadioButton,
  CATDlgCombo: CaaControlCombo,
  CATDlgSeparator: CaaControlSeparator,
  CATDlgSplitter: CaaControlCatalogBox,
  CATDlgIconBox: CaaControlCatalogBox,
  CATDlgProgress: CaaControlCatalogBox,
  CATDlgSlider: CaaControlCatalogBox,
  CATDlgScrollbar: CaaControlCatalogBox,
  CATDlgMenuBar: CaaControlCatalogBox,
  CATDlgToolBar: CaaControlCatalogBox,
  CATDlgStatusBar: CaaControlCatalogBox,
  CATDlgSubMenu: CaaControlCatalogBox,
  CATDlgMenuItem: CaaControlCatalogBox,
  CATDlgToolBarItem: CaaControlCatalogBox,
  CATDlgPushItem: CaaControlCatalogBox,
  CATDlgCheckItem: CaaControlCatalogBox,
  CATDlgRadioItem: CaaControlCatalogBox,
  CATDlgSeparatorItem: CaaControlCatalogBox,
};

/** 按 CAA 类型名解析对应的 Vue 组件，未注册返回 CaaControlUnknown */
export function resolveCaaControl(type: string): Component {
  return caaControlMap[type] ?? CaaControlUnknown;
}

/** 注册控件组件（用于延迟注册或外部扩展） */
export function registerCaaControl(type: string, component: Component): void {
  caaControlMap[type] = component;
}
