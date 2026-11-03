/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 백엔드 API origin. /api/v1은 포함하지 않는다. */
  readonly VITE_API_ORIGIN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
