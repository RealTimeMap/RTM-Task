/**
 * HTTP-клиент к RTM-Task.
 *
 * Аутентификация выполняется до сервиса: шлюз валидирует Bearer-токен
 * в auth-service (forward auth) и подставляет заголовки X-User-ID,
 * X-User-Name, X-User-Admin. Фронтенд их не формирует — он лишь прикладывает
 * токен, полученный при входе.
 */

import { authHeader } from './auth'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1'

/** Формат ошибки бэкенда: { error: { code, message, field, value } }. */
interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
    field?: string
    value?: unknown
  }
}

/** Ошибка запроса с разобранным телом ответа. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field?: string

  constructor(status: number, code: string, message: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.field = field
  }

  /** Конфликт версий: задачу изменил кто-то другой. */
  get isVersionConflict(): boolean {
    return this.status === 409 && this.field === 'version'
  }

  /** Сессия недействительна — нужно заново пройти авторизацию. */
  get isUnauthorized(): boolean {
    return this.status === 401
  }

  /** Доступ есть, но прав на действие не хватает. */
  get isForbidden(): boolean {
    return this.status === 403
  }

  get isNotFound(): boolean {
    return this.status === 404
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, unknown>
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
  const url = `${BASE_URL}${path}`
  if (!query) return url

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }

  const search = params.toString()
  return search ? `${url}?${search}` : url
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody = {}
  try {
    body = (await response.json()) as ApiErrorBody
  } catch {
    // Тело не JSON — обойдёмся статусом.
  }

  const error = body.error
  return new ApiError(
    response.status,
    error?.code ?? 'unknown_error',
    error?.message ?? `Запрос завершился со статусом ${response.status}`,
    error?.field,
  )
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query } = options

  const headers: Record<string, string> = { ...authHeader() }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    throw await parseError(response)
  }

  // 204 No Content — тела нет.
  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

/** Приводит любую пойманную ошибку к читаемому тексту. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Неизвестная ошибка'
}
