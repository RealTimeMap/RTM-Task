/**
 * Проверка стора перечня багов — того, что стоит за страницей «Баги».
 *
 * Здесь поднимается настоящий стор, а не копия его логики: правила
 * отбора и порядка живут только в нём, и копия рано или поздно
 * разошлась бы с оригиналом.
 *
 * Сеть подменяется на уровне fetch: api/client.ts ходит именно через
 * него, поэтому подмена проверяет и разбор ответа заодно.
 */

import { createPinia, setActivePinia } from 'pinia'

import { useBugsStore, BUG_TAG_ORDER } from '../src/stores/bugs'
import type { Bug, BugTag } from '../src/types/task'

let failed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    console.error(`FAIL: ${name}: ожидали ${expected}, получили ${actual}`)
    failed += 1
  }
}

function bug(overrides: Partial<Bug> = {}): Bug {
  return {
    id: 1,
    title: 'Маркер не обновляется',
    tag: 'logic',
    status: 'open',
    hasLogs: false,
    createdAt: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

/** Ответы, которые отдаст подменённый fetch. */
let answer: { items: Bug[]; total: number } = { items: [], total: 0 }
let failure: { status: number; code: string; field?: string } | null = null
let requests = 0

/** Адреса запросов — чтобы проверить, какие перечни стор запросил. */
let urls: string[] = []

/** Ответ на решение по багу: сервер возвращает баг в новом состоянии. */
let reviewed: Bug | null = null

globalThis.fetch = (async (input: string, init?: RequestInit) => {
  requests += 1
  urls.push(String(input))

  if (failure) {
    return new Response(
      JSON.stringify({ error: { code: failure.code, message: 'Сбой', field: failure.field } }),
      { status: failure.status, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Перечень запрашивается ровно по этому адресу: промах означал бы,
  // что стор ходит не туда.
  if (!String(input).includes('/bugs')) {
    throw new Error(`Неожиданный запрос: ${input}`)
  }

  if (init?.method === 'POST') {
    return new Response(JSON.stringify(reviewed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify(answer), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}) as typeof fetch

function fresh() {
  setActivePinia(createPinia())
  return useBugsStore()
}

// --- Загрузка ---------------------------------------------------------

answer = {
  items: [
    bug({ id: 1, tag: 'logic', createdAt: '2026-09-01T10:00:00Z' }),
    bug({ id: 2, tag: 'ui', createdAt: '2026-09-03T10:00:00Z', title: 'Кнопка уезжает' }),
    bug({ id: 3, tag: 'feature', createdAt: '2026-09-02T10:00:00Z', title: 'Экспорт в CSV' }),
  ],
  total: 3,
}

const store = fresh()
urls = []
await store.load()

// Очередь проверки и готовые к работе грузятся всегда — их счётчики
// стоят на вкладках и в бейдже. Отклонённые — только по требованию.
check('запрошена очередь проверки', urls.some((url) => url.includes('status=new')), true)
check('запрошены готовые', urls.some((url) => url.includes('status=confirmed')), true)
check('отклонённые не запрошены', urls.some((url) => url.includes('status=rejected')), false)
check('по умолчанию открыта очередь проверки', store.queue, 'new')

check('перечень загружен', store.items.length, 3)
check('всего багов', store.total, 3)
check('перечень помечен прочитанным', store.loaded, true)
check('ошибки нет', store.error, null)

// Свежие отчёты интереснее старых: разбирают обычно то, что пришло
// последним.
check('сначала свежие: первый', store.visible[0].id, 2)
check('сначала свежие: последний', store.visible[2].id, 1)

// --- Повторный заход не ходит в сеть ---------------------------------

const before = requests
await store.ensureLoaded()
check('повторный заход не грузит заново', requests, before)

// --- Порядок по категории --------------------------------------------

store.sortField = 'tag'
const byTag = store.visible.map((item) => item.tag)
check(
  'категории идут в заданном порядке',
  byTag.join(','),
  BUG_TAG_ORDER.filter((tag: BugTag) => byTag.includes(tag)).join(','),
)
store.sortField = 'createdAt'

// --- Фильтр по категории ---------------------------------------------

check('счётчик всех', store.tagCounts.all, 3)
check('счётчик logic', store.tagCounts.logic, 1)

store.tagFilter = 'ui'
check('фильтр по категории', store.visible.length, 1)
check('фильтр оставил нужный баг', store.visible[0].id, 2)
store.tagFilter = 'all'

// --- Поиск ------------------------------------------------------------

store.query = 'экспорт'
check('поиск по названию без учёта регистра', store.visible.length, 1)
check('поиск нашёл нужный баг', store.visible[0].id, 3)

// Номер бага — то, чем его называют в переписке: по нему тоже ищут.
store.query = '2'
check('поиск по номеру', store.visible.some((item) => item.id === 2), true)

store.query = 'такого нет'
check('поиск без совпадений', store.visible.length, 0)
store.query = ''

// --- Взятый баг уходит из перечня -------------------------------------

store.select(2)
check('баг выбран', store.selected?.id, 2)

store.forget(2)
check('взятый баг ушёл из перечня', store.items.length, 2)
check('счётчик уменьшился', store.total, 2)
// Выбор снимается вместе с багом: карточка отчёта, которого больше нет
// в списке, показывала бы то, что уже нельзя взять.
check('выбор снят', store.selectedId, null)

// Повторное снятие ничего не ломает и не уводит счётчик в минус.
store.forget(2)
check('повторное снятие безопасно', store.items.length, 2)
check('счётчик не ушёл в минус', store.total, 2)

// --- Открытый баг, исчезнувший при перезагрузке ------------------------

store.select(1)
answer = { items: [bug({ id: 3, tag: 'feature' })], total: 1 }
await store.load()
check('исчезнувший баг перестал быть выбранным', store.selectedId, null)

// --- Очереди и решения по багу ------------------------------------------

const review = fresh()
answer = {
  items: [bug({ id: 1, status: 'new' }), bug({ id: 2, status: 'new' })],
  total: 2,
}
await review.load()
check('в очереди два отчёта', review.queueCounts.new, 2)
// Мок отвечает одним перечнем на все запросы — и готовых тоже два.
check('бейдж считает очередь и готовые', review.attentionCount, 4)

// Подтверждённый баг уходит из очереди в готовые — сразу, не дожидаясь
// перечитывания: иначе его предложили бы проверить второй раз.
review.lists.confirmed = []
review.select(1)
reviewed = bug({ id: 1, status: 'confirmed', reviewComment: 'воспроизвёлся' })
const confirmedBug = await review.confirm(1, '  воспроизвёлся  ')
check('подтверждение вернуло баг', confirmedBug?.status, 'confirmed')
check('баг ушёл из очереди', review.lists.new.some((item) => item.id === 1), false)
check('баг появился в готовых', review.lists.confirmed[0]?.id, 1)
check('карточка ушедшего бага закрыта', review.selectedId, null)
check('решение не висит', review.reviewing, null)

// Отклонённые догружаются при первом открытии вкладки.
urls = []
answer = { items: [bug({ id: 5, status: 'rejected', rejectReason: 'spam' })], total: 1 }
review.setQueue('rejected')
await new Promise((resolve) => setTimeout(resolve, 0))
check('отклонённые запрошены при открытии', urls.some((url) => url.includes('status=rejected')), true)
check('открыт перечень отклонённых', review.items[0]?.id, 5)

// Возврат на проверку переносит баг обратно в очередь.
reviewed = bug({ id: 5, status: 'new' })
await review.reopen(5)
check('отклонённый вернулся в очередь', review.lists.new.some((item) => item.id === 5), true)
check('и ушёл из отклонённых', review.lists.rejected.length, 0)

// Отказ сервера по состоянию бага не ломает перечень.
failure = { status: 409, code: 'conflict' }
const refused = await review.reject(5, 'duplicate')
check('отказ вернул null', refused, null)
check('баг остался на месте', review.lists.new.some((item) => item.id === 5), true)
failure = null
reviewed = null

// --- Недоступность сервиса ---------------------------------------------

const offline = fresh()
failure = { status: 503, code: 'service_unavailable', field: 'feedback' }
await offline.load()

// Сбой сервиса — не ошибка запроса: привязка тут ни при чём, и повтор
// имеет смысл. Поэтому он отделён от обычной ошибки.
check('недоступность отмечена', offline.unavailable, true)
check('сообщение о недоступности показано', typeof offline.error, 'string')
check('перечень не помечен прочитанным', offline.loaded, false)

// Не помечен прочитанным — значит следующий заход повторит попытку,
// а не оставит страницу пустой навсегда.
failure = null
answer = { items: [bug({ id: 9 })], total: 1 }
await offline.ensureLoaded()
check('после сбоя перечень перечитывается', offline.items.length, 1)
check('недоступность снята', offline.unavailable, false)

// --- Обычная ошибка -----------------------------------------------------

const broken = fresh()
failure = { status: 500, code: 'internal_error' }
await broken.load()
check('ошибка записана', typeof broken.error, 'string')
check('обычная ошибка не выдаётся за недоступность', broken.unavailable, false)

broken.clearError()
check('ошибка сбрасывается', broken.error, null)

failure = null

if (failed > 0) {
  console.error(`\n${failed} проверок не пройдено`)
  process.exit(1)
}

console.log('bugs-page.test.ts: все проверки пройдены')
