import { computed, type ComputedRef, type Ref } from "vue";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { pnwPropGroup, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";

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

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("checkout", "检出", [
          pnwPropReadonly("checkout_root", "检出根目录", {
            value: computed(() => checkoutRoot.value.trim() || "（未设置）"),
            mono: true,
          }),
          pnwPropReadonly("enabled", "已勾选", {
            value: computed(() => `${enabledCount.value} / ${totalCount.value}`),
          }),
          pnwPropReadonly("checked_out", "已检出", {
            value: computed(() => `${checkedOutCount.value} / ${totalCount.value}`),
          }),
        ]),
        pnwPropGroup("state", "状态", [
          pnwPropReadonly("page_state", "页面", {
            value: computed(() => {
              if (syncing.value) return "同步中";
              if (loading.value) return "加载中";
              return "就绪";
            }),
          }),
        ]),
        pnwPropGroup("intro", "介绍", [
          pnwPropReadonly("intro_catalog", "来源", {
            value: computed(() => "系统内置（phoenix/config/test_fixture_catalog.json）"),
          }),
          pnwPropReadonly("intro_prefs", "位置", {
            value: computed(() => "clone 到 phoenix-desk-tools 同级目录即可，测试自动定位"),
          }),
        ]),
        pnwPropGroup("prefs", "本机偏好", [
          pnwPropReadonly("prefs_store", "保存位置", {
            value: computed(() => "launcher.json → test_fixtures"),
            mono: true,
          }),
        ]),
      ],
      { title: "检出测试工程" },
    ),
  );
}
