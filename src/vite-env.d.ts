/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Базовый путь REST API. По умолчанию /api/v1. */
  readonly VITE_API_URL?: string
  /** Origin сокета. Пустой — тот же хост, что и страница. */
  readonly VITE_SOCKET_URL?: string
  /** Базовый путь ручек авторизации. По умолчанию /api/v2/auth. */
  readonly VITE_AUTH_BASE_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
