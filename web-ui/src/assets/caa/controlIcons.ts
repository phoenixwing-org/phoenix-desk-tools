/** CAA 控件图标映射：类型短名 → SVG URL。
 * Vite 处理 SVG 导入，浏览器自然缓存。
 */

import DialogSvg from "../../assets/icons/widget/phoenix-widget-dialog.svg";
import FrameSvg from "../../assets/icons/widget/phoenix-widget-frame.svg";
import TabContainerSvg from "../../assets/icons/widget/phoenix-widget-tab-container.svg";
import TabPageSvg from "../../assets/icons/widget/phoenix-widget-tab-page.svg";
import ContainerSvg from "../../assets/icons/widget/phoenix-widget-container.svg";
import SplitterSvg from "../../assets/icons/widget/phoenix-widget-splitter.svg";
import IconBoxSvg from "../../assets/icons/widget/phoenix-widget-icon-box.svg";
import ProgressSvg from "../../assets/icons/widget/phoenix-widget-progress.svg";
import SliderSvg from "../../assets/icons/widget/phoenix-widget-slider.svg";
import ScrollbarSvg from "../../assets/icons/widget/phoenix-widget-scrollbar.svg";
import MenuBarSvg from "../../assets/icons/widget/phoenix-widget-menu-bar.svg";
import ToolBarSvg from "../../assets/icons/widget/phoenix-widget-tool-bar.svg";
import StatusBarSvg from "../../assets/icons/widget/phoenix-widget-status-bar.svg";
import SubMenuSvg from "../../assets/icons/widget/phoenix-widget-sub-menu.svg";
import MenuItemSvg from "../../assets/icons/widget/phoenix-widget-menu-item.svg";
import ToolBarItemSvg from "../../assets/icons/widget/phoenix-widget-tool-bar-item.svg";
import PushItemSvg from "../../assets/icons/widget/phoenix-widget-push-item.svg";
import CheckItemSvg from "../../assets/icons/widget/phoenix-widget-check-item.svg";
import RadioItemSvg from "../../assets/icons/widget/phoenix-widget-radio-item.svg";
import SeparatorItemSvg from "../../assets/icons/widget/phoenix-widget-separator-item.svg";
import LabelSvg from "../../assets/icons/widget/phoenix-widget-label.svg";
import EditorSvg from "../../assets/icons/widget/phoenix-widget-editor.svg";
import PushButtonSvg from "../../assets/icons/widget/phoenix-widget-push-button.svg";
import ComboSvg from "../../assets/icons/widget/phoenix-widget-combo.svg";
import CheckButtonSvg from "../../assets/icons/widget/phoenix-widget-check-button.svg";
import RadioButtonSvg from "../../assets/icons/widget/phoenix-widget-radio-button.svg";
import SpinnerSvg from "../../assets/icons/widget/phoenix-widget-spinner.svg";
import SelectorListSvg from "../../assets/icons/widget/phoenix-widget-selector-list.svg";
import MultiListSvg from "../../assets/icons/widget/phoenix-widget-multi-list.svg";
import SeparatorSvg from "../../assets/icons/widget/phoenix-widget-separator.svg";

export const CONTROL_ICONS: Record<string, string> = {
  Dialog: DialogSvg,
  Frame: FrameSvg,
  TabContainer: TabContainerSvg,
  TabPage: TabPageSvg,
  Container: ContainerSvg,
  Splitter: SplitterSvg,
  IconBox: IconBoxSvg,
  Progress: ProgressSvg,
  Slider: SliderSvg,
  Scrollbar: ScrollbarSvg,
  MenuBar: MenuBarSvg,
  ToolBar: ToolBarSvg,
  StatusBar: StatusBarSvg,
  SubMenu: SubMenuSvg,
  MenuItem: MenuItemSvg,
  ToolBarItem: ToolBarItemSvg,
  PushItem: PushItemSvg,
  CheckItem: CheckItemSvg,
  RadioItem: RadioItemSvg,
  SeparatorItem: SeparatorItemSvg,
  Label: LabelSvg,
  Editor: EditorSvg,
  PushButton: PushButtonSvg,
  Combo: ComboSvg,
  CheckButton: CheckButtonSvg,
  RadioButton: RadioButtonSvg,
  Spinner: SpinnerSvg,
  SelectorList: SelectorListSvg,
  MultiList: MultiListSvg,
  Separator: SeparatorSvg,
};

/** CATDlg 类型 → 图标 URL */
export function controlIcon(type: string): string | undefined {
  const key = type.replace(/^CATDlg/, "");
  return CONTROL_ICONS[key];
}
