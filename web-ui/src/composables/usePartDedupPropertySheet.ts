import { computed, type Ref } from "vue";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { pnwPropBool, pnwPropEnum, pnwPropGroup, pnwPropNumber, pnwPropPath, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";

export const PART_DEDUP_EXTENSION_OPTIONS = [".FCStd", ".SLDPRT", ".SLDASM", ".SLDDRW", ".step", ".stp"];

const PAGE_INTRO = "按扩展名扫描目录，检测文件名、编号、编号+版本三类重复。";

export function usePartDedupPropertySheet(
  pageId: string,
  opts: {
    scanDir: Ref<string>;
    extension: Ref<string>;
    codeLen: Ref<number>;
    verLen: Ref<number>;
    checkCode: Ref<boolean>;
    checkVersion: Ref<boolean>;
    codeMustBeDigit: Ref<boolean>;
    onPersist: () => void;
  },
) {
  const {
    scanDir,
    extension,
    codeLen,
    verLen,
    checkCode,
    checkVersion,
    codeMustBeDigit,
    onPersist,
  } = opts;

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("intro", "介绍", [
          pnwPropReadonly("intro", "说明", {
            value: computed(() => PAGE_INTRO),
          }),
        ]),
        pnwPropGroup("scan", "扫描", [
          pnwPropPath("scan_dir", "目录", {
            value: computed(() => scanDir.value),
            mono: true,
            placeholder: "相对工作空间，如 .",
            onChange: (v) => {
              scanDir.value = v;
              onPersist();
            },
          }),
          pnwPropEnum("extension", "扩展名", {
            value: computed(() => extension.value),
            options: PART_DEDUP_EXTENSION_OPTIONS.map((ext) => ({ value: ext, label: ext })),
            onChange: (v) => {
              extension.value = v;
              onPersist();
            },
          }),
          pnwPropNumber("code_len", "编号位数", {
            value: computed(() => codeLen.value),
            min: 1,
            max: 20,
            onChange: (v) => {
              codeLen.value = v;
              onPersist();
            },
          }),
          pnwPropNumber("ver_len", "版本位数", {
            value: computed(() => verLen.value),
            min: 1,
            max: 10,
            onChange: (v) => {
              verLen.value = v;
              onPersist();
            },
          }),
        ]),
        pnwPropGroup("checks", "检查项", [
          pnwPropBool("check_code", "查编号", {
            value: checkCode,
            onChange: (v) => {
              checkCode.value = v;
              onPersist();
            },
          }),
          pnwPropBool("check_version", "查版本", {
            value: checkVersion,
            onChange: (v) => {
              checkVersion.value = v;
              onPersist();
            },
          }),
          pnwPropBool("code_must_be_digit", "编号须数字", {
            value: codeMustBeDigit,
            onChange: (v) => {
              codeMustBeDigit.value = v;
              onPersist();
            },
          }),
        ]),
      ],
      { title: "编号查重", schemaVersion: 1 },
    ),
  );
}
