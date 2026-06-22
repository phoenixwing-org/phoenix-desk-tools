import { computed, type ComputedRef, type Ref } from "vue";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { propGroup, propReadonly, propSheet } from "../utils/pagePropertySchema";

export function useTestFixturesPropertySheet(  pageId: string,
  opts: {
    checkoutRoot: ComputedRef<string>;
    enabledCount: ComputedRef<number>;
    totalCount: ComputedRef<number>;
    linkedCount: ComputedRef<number>;
    loading: Ref<boolean>;
    syncing: Ref<boolean>;
  },
) {
  const { checkoutRoot, enabledCount, totalCount, linkedCount, loading, syncing } = opts;

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
          propReadonly("linked", "已链接", {
            value: computed(() => `${linkedCount.value} / ${totalCount.value}`),
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
            value: computed(() => "系统内置（phoenix/config/test_fixture_catalog.json），非用户自建"),
          }),
          propReadonly("intro_prefs", "偏好", {
            value: computed(() => "launcher.json → test_fixtures"),
            mono: true,
          }),
          propReadonly("intro_action", "操作", {
            value: computed(
              () =>
                "勾选或「检出并链接」：git clone 到检出根目录，再链到 tests/fixtures/<名>（Windows 先删旧链接再建）",
            ),
          }),
        ]),
        propGroup("prefs", "本机偏好", [
          propReadonly("prefs_store", "保存位置", {
            value: computed(() => "launcher.json → test_fixtures"),
            mono: true,
          }),
        ]),
      ],
      { title: "引用测试工程" },
    ),
  );
}
