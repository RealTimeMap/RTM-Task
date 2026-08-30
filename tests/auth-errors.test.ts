/**
 * Проверка разбора ответов auth-service.
 *
 * Реальный сервис отвечает не так, как обещает документация:
 * неверные данные — 400 с detail "LOGIN_BAD_CREDENTIALS" (а не 401),
 * ошибки формата — 422 со списком. Оба случая должны превращаться
 * в понятный пользователю текст.
 */

// Минимальные заглушки браузерного окружения для Node.
// Ставятся до импорта модуля: он читает их на верхнем уровне.
const storage = new Map<string, string>()
;(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
}

const { AuthError, login } = await import('../src/api/auth')

let failed = 0
const check = (name: string, actual: string, expected: string) => {
  if (actual !== expected) {
    console.error(`FAIL: ${name}\n  ожидали: ${expected}\n  получили: ${actual}`)
    failed += 1
  }
}

/** Подменяет fetch заранее заданным ответом. */
function mockFetch(status: number, body: unknown): void {
  ;(globalThis as Record<string, unknown>).fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
}

async function loginError(): Promise<string> {
  try {
    await login({ username: 'u', password: 'p' })
    return '<ошибки не было>'
  } catch (error) {
    return error instanceof AuthError ? error.message : String(error)
  }
}

// 400 с техническим кодом — реальное поведение стенда.
mockFetch(400, { detail: 'LOGIN_BAD_CREDENTIALS' })
check('400 LOGIN_BAD_CREDENTIALS', await loginError(), 'Неверный логин или пароль')

// 401 — вариант из документации, тоже должен читаться.
mockFetch(401, { detail: 'LOGIN_BAD_CREDENTIALS' })
check('401 LOGIN_BAD_CREDENTIALS', await loginError(), 'Неверный логин или пароль')

// Неподтверждённый email.
mockFetch(400, { detail: 'LOGIN_USER_NOT_VERIFIED' })
check('неподтверждённый email', await loginError(), 'Email не подтверждён — проверьте почту')

// 422 со списком ошибок валидации.
mockFetch(422, {
  detail: [{ type: 'missing', loc: ['body', 'username'], msg: 'Field required' }],
})
check('422 список', await loginError(), 'Field required')

// Незнакомый текстовый detail показываем как есть.
mockFetch(400, { detail: 'SOME_OTHER_REASON' })
check('незнакомый detail', await loginError(), 'SOME_OTHER_REASON')

// Ответ без detail — остаётся статус.
mockFetch(500, {})
check('без detail', await loginError(), 'Вход не удался (код 500)')

// Успешный вход: сервис отдаёт snake_case.
mockFetch(200, { access_token: 'tok123', token_type: 'bearer' })
try {
  await login({ username: 'u', password: 'p' })
  if (storage.get('rtm-task:access-token') !== 'tok123') {
    console.error('FAIL: токен не сохранён')
    failed += 1
  }
} catch (error) {
  console.error('FAIL: успешный вход бросил ошибку:', error)
  failed += 1
}

if (failed > 0) {
  console.error(`\n${failed} проверок не прошло`)
  process.exit(1)
}

console.log('OK: 7 проверок разбора ответов auth-service пройдено')
