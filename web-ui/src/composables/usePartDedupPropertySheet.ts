import { computed, type Ref } from "vue";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { propBool, propEnum, propGroup, propNumber, propSheet, propString } from "../utils/pagePropertySchema";

const EXT_OPTIONS = [".FCStd", ".SLDPRT", ".SLDASM", ".SLDDRW", ".step", ".stp"];

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

  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        propGroup("scan", "扫描", [
          propString("scan_dir", "目录", {
            value: computed(() => scanDir.value),
            mono: true,
            placeholder: "相对工作空间，如 .",
            onChange: (v) => {
              scanDir.value = v;
              onPersist();
            },
          }),
          propEnum("extension", "扩展名", {
            value: computed(() => extension.value),
            options: EXT_OPTIONS.map((ext) => ({ value: ext, label: ext })),
            onChange: (v) => {
              extension.value = v;
              onPersist();
            },
          }),
          propNumber("code_len", "编号位数", {
            value: computed(() => codeLen.value),
            min: 1,
            max: 20,
            onChange: (v) => {
              codeLen.value = v;
              onPersist();
            },
          }),
          propNumber("ver_len", "版本位数", {
            value: computed(() => verLen.value),
            min: 1,
            max: 10,
            onChange: (v) => {
              verLen.value = v;
              onPersist();
            },
          }),
        ]),
        propGroup("checks", "检查项", [
          propBool("check_code", "查编号", {
            value: checkCode,
            onChange: (v) => {
              checkCode.value = v;
              onPersist();
            },
          }),
          propBool("check_version", "查版本", {
            value: checkVersion,
            onChange: (v) => {
              checkVersion.value = v;
              onPersist();
            },
          }),
          propBool("code_must_be_digit", "编号须数字", {
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
