import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite'

/**
 * Заголовки, которые auth-service возвращает на token-validate,
 * а Traefik подставляет в запрос к сервису.
 */
const FORWARDED_HEADERS = ['x-user-id', 'x-user-name', 'x-user-admin', 'x-user-ban']

/** Пути, которые в проде защищены forward auth. */
const PROTECTED_PREFIXES = ['/api/v1', '/socket.io']

/**
 * Родительский домен туннеля в формате allowedHosts (`.example.com`
 * разрешает все поддомены).
 *
 * Имя, которое выдаёт туннель, не всегда совпадает с ожидаемым:
 * `--subdomain=realtimemap` для домена realtimemap.ru превращается
 * в realtimemap.ru.tuna.am. Разрешая родительский домен, мы избавляемся
 * от необходимости угадывать точное имя.
 */
function tunnelSuffix(host: string): string {
  const parts = host.split('.')
  return parts.length > 2 ? `.${parts.slice(-2).join('.')}` : `.${host}`
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_BACKEND_ORIGIN ?? 'http://localhost:8091'

  // Origin — только схема и хост; путь до ручек задаётся отдельно,
  // чтобы он не удваивался и был виден в одном месте.
  const authOrigin = (env.VITE_AUTH_ORIGIN ?? '').replace(/\/+$/, '')
  const authBasePath = (env.VITE_AUTH_BASE_PATH ?? '/api/v2/auth').replace(/\/+$/, '')

  const staticUser: Record<string, string> = {
    'x-user-id': env.VITE_DEV_USER_ID ?? '',
    'x-user-name': env.VITE_DEV_USER_NAME ?? '',
    'x-user-admin': env.VITE_DEV_USER_ADMIN ?? '',
  }

  /**
   * Валидирует токен в auth-service и возвращает заголовки пользователя.
   * Без указанного auth-service работает прямая подмена из .env — так UI
   * можно поднять и без запущенной авторизации.
   */
  async function resolveUser(
    authorization: string | undefined,
  ): Promise<Record<string, string> | null> {
    if (!authOrigin) return staticUser
    if (!authorization) return null

    try {
      const response = await fetch(`${authOrigin}${authBasePath}/token-validate`, {
        headers: { Authorization: authorization },
      })
      if (!response.ok) return null

      const headers: Record<string, string> = {}
      for (const name of FORWARDED_HEADERS) {
        const value = response.headers.get(name)
        if (value) headers[name] = value
      }
      return headers
    } catch {
      return null
    }
  }

  /**
   * Локальная замена Traefik forwardAuth.
   *
   * Стоит перед прокси: валидация асинхронная, а хуки http-proxy
   * синхронные — дожидаться ответа auth-service нужно раньше, чем
   * запрос уйдёт дальше. Заголовки переписываются на самом запросе,
   * поэтому прокси отправит уже готовый набор.
   */
  function forwardAuthPlugin(): Plugin {
    return {
      name: 'rtm-dev-forward-auth',
      configureServer(server) {
        server.middlewares.use(async (req, _res, next) => {
          const url = req.url ?? ''
          if (!PROTECTED_PREFIXES.some((prefix) => url.startsWith(prefix))) {
            return next()
          }

          // Клиент не должен уметь притвориться кем-то, подделав заголовок.
          for (const name of FORWARDED_HEADERS) {
            delete req.headers[name]
          }

          const resolved = await resolveUser(req.headers.authorization)
          if (resolved) {
            for (const [name, value] of Object.entries(resolved)) {
              if (value) req.headers[name] = value
            }
          }

          next()
        })

        // Websocket-апгрейд не проходит через middleware-стек, поэтому
        // тот же разбор нужен отдельно на событии upgrade. Слушатель
        // ставится первым и правит заголовки до того, как их прочитает
        // проксирующий обработчик.
        server.httpServer?.prependListener('upgrade', (req) => {
          const url = req.url ?? ''
          if (!url.startsWith('/socket.io')) return

          for (const name of FORWARDED_HEADERS) {
            delete req.headers[name]
          }

          // Соединение уже устанавливается — дождаться ответа auth-service
          // здесь нельзя, поэтому подставляется только статический
          // пользователь. С реальным auth-service это не мешает: клиент
          // начинает с polling-рукопожатия, которое проходит middleware
          // выше, а апгрейд лишь наследует созданную сессию.
          if (!authOrigin) {
            for (const [name, value] of Object.entries(staticUser)) {
              if (value) req.headers[name] = value
            }
          }
        })
      },
    }
  }

  const passThrough: ProxyOptions = { target: backend, changeOrigin: true }

  // Публичный хост туннеля (tuna, ngrok и подобные). Задан — dev-сервер
  // слушает все интерфейсы, пропускает запросы с этого домена и отдаёт
  // клиенту правильный адрес для HMR-сокета.
  const tunnelHost = env.VITE_TUNNEL_HOST ?? ''

  return {
    plugins: [vue(), forwardAuthPlugin()],
    server: {
      // Через туннель нужно слушать все интерфейсы; локально — только
      // IPv4-loopback, иначе Vite поднимается на [::1], куда не попадают
      // клиенты, резолвящие localhost в 127.0.0.1.
      host: tunnelHost ? '0.0.0.0' : '127.0.0.1',
      port: 5173,
      // Порт фиксирован: иначе при занятом 5173 сервер молча уезжает
      // на соседний, и адрес приходится каждый раз искать в логе.
      strictPort: true,
      // Vite отклоняет запросы с неизвестного Host — домен туннеля
      // нужно разрешить явно. Вместе с ним разрешаем и весь его
      // родительский домен: туннель может выдать другое имя
      // (например, с точкой в поддомене), и ломать запуск из-за
      // этого не стоит.
      ...(tunnelHost ? { allowedHosts: [tunnelHost, tunnelSuffix(tunnelHost)] } : {}),
      // Иначе HMR стучится на localhost изнутри туннеля и не находит его.
      ...(tunnelHost
        ? { hmr: { protocol: 'wss', host: tunnelHost, clientPort: 443 } }
        : {}),
      proxy: {
        // Логин идёт напрямую в auth-service, минуя forward auth.
        ...(authOrigin ? { [authBasePath]: { target: authOrigin, changeOrigin: true } } : {}),
        '/api/v1': passThrough,
        '/socket.io': { ...passThrough, ws: true },
      },
    },
  }
})
