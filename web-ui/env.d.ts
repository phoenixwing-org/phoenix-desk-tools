/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "element-plus/dist/locale/zh-cn.mjs" {
  const locale: Record<string, unknown>;
  export default locale;
}
