import { computed, type ComputedRef, type Ref } from "vue";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { propGroup, propReadonly, propSheet } from "../utils/pagePropertySchema";

export function useTestFixturesPropertySheet(pageId: string,
  opts: {
    checkoutRoot: ComputedRef<string>;
    enabledCount: ComputedRef<number>;
    totalCount: ComputedRef<number>;
    checkedOutCount: ComputedRef<number>;
    loading: Ref<boolean>;
    syncing: Ref<boolean>;
  },
) {
  const { checkoutRoot, enabledCount, totalCount, checkedOutCount, loading, syncing } = opts;

  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        propGroup("checkout", "检出", [
          propReadonly("checkout_root", "检出根目录", {
            value: computed(() => checkoutRoot.value.trim() || "（未设置）"),
            mono: true,
          }),
          propReadonly("enabled", "已勾选", {
            value: computed(() => `${enabledCount.value} / ${totalCount.value}`),
          }),
          propReadonly("checked_out", "已检出", {
            value: computed(() => `${checkedOutCount.value} / ${totalCount.value}`),
          }),
        ]),
        propGroup("state", "状态", [
          propReadonly("page_state", "页面", {
            value: computed(() => {
              if (syncing.value) return "同步中";
              if (loading.value) return "加载中";
              return "就绪";
            }),
          }),
        ]),
        propGroup("intro", "介绍", [
          propReadonly("intro_catalog", "来源", {
            value: computed(() => "系统内置（phoenix/config/test_fixture_catalog.json）"),
          }),
          propReadonly("intro_prefs", "位置", {
            value: computed(() => "clone 到 phoenix-desk-tools 同级目录即可，测试自动定位"),
          }),
        ]),
        propGroup("prefs", "本机偏好", [
          propReadonly("prefs_store", "保存位置", {
            value: computed(() => "launcher.json → test_fixtures"),
            mono: true,
          }),
        ]),
      ],
      { title: "检出测试工程" },
    ),
  );
}
