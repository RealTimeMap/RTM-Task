/**
 * Клиент auth-service платформы.
 *
 * RTM-Task паролей не хранит: форма входа отправляет их сюда, а дальше
 * запросы к сервису задач идут с Bearer-токеном, который шлюз проверяет
 * через forward auth (GET /auth/token-validate) и превращает
 * в заголовки X-User-*.
 */

// Тот же путь, что проксирует dev-сервер (VITE_AUTH_BASE_PATH).
const AUTH_URL = import.meta.env.VITE_AUTH_BASE_PATH ?? '/api/v2/auth'
const TOKEN_KEY = 'rtm-task:access-token'

export interface LoginCredentials {
  username: string
  password: string
}

/**
 * Ответ auth-service на успешный вход.
 *
 * Сервис отдаёт поля в snake_case (`access_token`), хотя документация
 * описывает camelCase — принимаем оба варианта.
 */
interface LoginResponse {
  access_token?: string
  accessToken?: string
  token_type?: string
  tokenType?: string
}

export class AuthError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }

  /**
   * Неверный логин или пароль.
   * Сервис отвечает на это 400, хотя документация обещает 401, —
   * учитываем оба статуса.
   */
  get isInvalidCredentials(): boolean {
    return this.status === 400 || this.status === 401
  }
}

let token: string | null = null

/** Восстанавливает токен из хранилища при старте приложения. */
export function restoreToken(): string | null {
  if (token === null) {
    token = localStorage.getItem(TOKEN_KEY)
  }
  return token
}

export function getToken(): string | null {
  return token
}

function setToken(value: string | null): void {
  token = value
  if (value === null) {
    localStorage.removeItem(TOKEN_KEY)
  } else {
    localStorage.setItem(TOKEN_KEY, value)
  }
}

/** Заголовок авторизации для запросов к сервису задач. */
export function authHeader(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Вход по логину и паролю.
 * Тело — form-urlencoded: auth-service следует стилю OAuth2.
 */
export async function login(credentials: LoginCredentials): Promise<void> {
  const body = new URLSearchParams({
    username: credentials.username,
    password: credentials.password,
  })

  let response: Response
  try {
    response = await fetch(`${AUTH_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    throw new AuthError(0, 'Не удалось связаться с сервисом авторизации')
  }

  if (!response.ok) {
    throw new AuthError(response.status, await loginErrorMessage(response))
  }

  const data = (await response.json()) as LoginResponse
  const accessToken = data?.access_token ?? data?.accessToken
  if (!accessToken) {
    throw new AuthError(response.status, 'Сервис авторизации не вернул токен')
  }

  setToken(accessToken)
}

export function logout(): void {
  setToken(null)
}

/** Коды auth-service, для которых есть понятный человеку текст. */
const KNOWN_DETAILS: Record<string, string> = {
  LOGIN_BAD_CREDENTIALS: 'Неверный логин или пароль',
  LOGIN_USER_NOT_VERIFIED: 'Email не подтверждён — проверьте почту',
}

async function loginErrorMessage(response: Response): Promise<string> {
  // FastAPI отдаёт detail строкой либо списком ошибок валидации.
  let detail: unknown
  try {
    const body = (await response.json()) as { detail?: unknown }
    detail = body?.detail
  } catch {
    // Тело не JSON — обойдёмся статусом.
  }

  if (typeof detail === 'string') {
    // Технические коды переводим, остальное показываем как есть.
    return KNOWN_DETAILS[detail] ?? detail
  }

  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string } | undefined
    if (first?.msg) return first.msg
  }

  if (response.status === 400 || response.status === 401) {
    return 'Неверный логин или пароль'
  }

  return `Вход не удался (код ${response.status})`
}
