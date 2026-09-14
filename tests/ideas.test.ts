/**
 * Проверка стора копилки идей — того, что стоит за страницей «Идеи».
 *
 * Поднимается настоящий стор, а не копия его логики: правила отбора и
 * счётчик реплик живут только в нём. Сеть подменяется на уровне fetch,
 * поэтому заодно проверяется разбор ответа.
 */

import { createPinia, setActivePinia } from 'pinia'

import { useIdeasStore } from '../src/stores/ideas'
import { isValidIdeaTitle, MIN_IDEA_TITLE, MAX_IDEA_TITLE } from '../src/types/idea'
import type { Idea, IdeaComment } from '../src/types/idea'

let failed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    console.error(`FAIL: ${name}: ожидали ${expected}, получили ${actual}`)
    failed += 1
  }
}

function idea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: 1,
    title: 'Кэшировать список задач',
    authorId: 1,
    done: false,
    commentCount: 0,
    createdAt: '2026-09-10T10:00:00Z',
    updatedAt: '2026-09-10T10:00:00Z',
    ...overrides,
  }
}

function comment(overrides: Partial<IdeaComment> = {}): IdeaComment {
  return {
    id: 100,
    ideaId: 1,
    authorId: 2,
    body: 'Хорошая мысль',
    createdAt: '2026-09-10T11:00:00Z',
    updatedAt: '2026-09-10T11:00:00Z',
    ...overrides,
  }
}

// --- Подменённая сеть -------------------------------------------------

let ideasAnswer: { items: Idea[]; total: number } = { items: [], total: 0 }
let commentsAnswer: { items: IdeaComment[]; total: number } = { items: [], total: 0 }
let failNext: { status: number; code: string } | null = null

const sent: { url: string; method: string; body: unknown }[] = []

globalThis.fetch = (async (input: string, init?: RequestInit) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  sent.push({ url, method, body })

  if (failNext) {
    const answer = new Response(
      JSON.stringify({ error: { code: failNext.code, message: 'Сбой' } }),
      { status: failNext.status, headers: { 'Content-Type': 'application/json' } },
    )
    failNext = null
    return answer
  }

  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  // Обсуждение идеи.
  if (/\/ideas\/\d+\/comments/.test(url)) {
    if (method === 'POST') {
      return json(comment({ id: 200, body: (body as { body: string }).body }), 201)
    }
    if (method === 'PATCH') {
      return json(comment({ id: 100, body: (body as { body: string }).body, editedAt: 'now' }))
    }
    if (method === 'DELETE') {
      return new Response(null, { status: 204 })
    }
    return json(commentsAnswer)
  }

  // Отметка выполнения.
  if (/\/ideas\/\d+\/done/.test(url)) {
    const done = (body as { done: boolean }).done
    return json(idea({ id: 1, done, doneById: done ? 7 : null }))
  }

  // Правка идеи.
  if (/\/ideas\/\d+$/.test(url) && method === 'PATCH') {
    return json(idea({ id: 1, ...(body as object) }))
  }

  if (/\/ideas\/\d+$/.test(url) && method === 'DELETE') {
    return new Response(null, { status: 204 })
  }

  // Заведение.
  if (url.includes('/ideas') && method === 'POST') {
    return json(idea({ id: 42, ...(body as object) }), 201)
  }

  // Перечень.
  if (url.includes('/ideas')) {
    return json(ideasAnswer)
  }

  throw new Error(`Неожиданный запрос: ${method} ${url}`)
}) as typeof fetch

function fresh() {
  setActivePinia(createPinia())
  return useIdeasStore()
}

// --- Проверка заголовка ------------------------------------------------

// Пределы совпадают с доменными (internal/domain/idea/model.go):
// расхождение означало бы, что UI шлёт заведомо отклоняемый запрос.
check('минимальная длина заголовка', MIN_IDEA_TITLE, 3)
check('максимальная длина заголовка', MAX_IDEA_TITLE, 300)

check('пустой заголовок не годится', isValidIdeaTitle(''), false)
check('пробелы — тот же пустой', isValidIdeaTitle('   '), false)
check('короткий не годится', isValidIdeaTitle('ид'), false)
check('минимальный годится', isValidIdeaTitle('иде'), true)
check('обычный годится', isValidIdeaTitle('Кэшировать список'), true)
check('слишком длинный не годится', isValidIdeaTitle('x'.repeat(MAX_IDEA_TITLE + 1)), false)

// --- Загрузка -----------------------------------------------------------

ideasAnswer = {
  items: [
    idea({ id: 1, title: 'Кэшировать список задач', done: false }),
    idea({ id: 2, title: 'Тёмная тема в письмах', done: true, commentCount: 2 }),
    idea({ id: 3, title: 'Горячие клавиши на доске', done: false, commentCount: 1 }),
  ],
  total: 3,
}

const store = fresh()
await store.load()

check('перечень загружен', store.items.length, 3)
check('всего идей', store.total, 3)
check('перечень помечен прочитанным', store.loaded, true)
check('ошибки нет', store.error, null)

check('счётчик несделанных', store.openCount, 2)
check('счётчик сделанных', store.doneCount, 1)

// --- Повторный заход не ходит в сеть ------------------------------------

const before = sent.length
await store.ensureLoaded()
check('повторный заход не грузит заново', sent.length, before)

// --- Отбор по состоянию --------------------------------------------------

store.scope = 'open'
check('в отборе «не сделано» только открытые', store.visible.length, 2)
check('сделанная не попала', store.visible.every((i) => !i.done), true)

store.scope = 'done'
check('в отборе «сделано» только закрытые', store.visible.length, 1)
check('попала нужная', store.visible[0].id, 2)

store.scope = 'all'
check('в отборе «все» весь перечень', store.visible.length, 3)

// --- Поиск ---------------------------------------------------------------

store.query = 'тёмная'
check('поиск без учёта регистра', store.visible.length, 1)
check('поиск нашёл нужную', store.visible[0].id, 2)

store.query = '3'
check('поиск по номеру', store.visible.some((i) => i.id === 3), true)

store.query = 'такого нет'
check('поиск без совпадений', store.visible.length, 0)
store.query = ''

// --- Заведение ------------------------------------------------------------

const created = await store.create({ title: 'Экспорт отчёта', description: 'в CSV' })
check('идея создана', created?.id, 42)
check('новая идея попала в список', store.items.length, 4)
// Свежая встаёт наверх: список открывают, чтобы увидеть новое.
check('новая идея встала первой', store.items[0].id, 42)
check('счётчик всего вырос', store.total, 4)

// --- Отметка выполнения -----------------------------------------------------

const done = await store.toggleDone(1)
check('идея отмечена сделанной', done?.done, true)
check('в сторе тоже отмечена', store.items.find((i) => i.id === 1)?.done, true)
check('счётчик несделанных уменьшился', store.openCount, 2)

const reopened = await store.toggleDone(1)
check('идея вернулась в работу', reopened?.done, false)
// Подпись закрывшего стирается вместе с отметкой: иначе она говорила
// бы, что идею кто-то закрыл, хотя она снова открыта.
check('подпись закрывшего стёрта', reopened?.doneById ?? null, null)

// --- Обсуждение --------------------------------------------------------------

commentsAnswer = { items: [comment({ id: 100 })], total: 1 }
await store.select(1)

check('идея открыта', store.selectedId, 1)
check('обсуждение загружено', store.comments.length, 1)

const added = await store.addComment(1, 'Ещё одна мысль')
check('реплика добавлена', added?.id, 200)
check('реплика попала в обсуждение', store.comments.length, 2)
// Счётчик на карточке идёт за обсуждением: иначе он расходился бы с
// ним до следующей полной загрузки.
check('счётчик реплик обновлён', store.items.find((i) => i.id === 1)?.commentCount, 2)

const edited = await store.updateComment(1, 100, 'Правленая мысль')
check('реплика изменена', edited?.body, 'Правленая мысль')

check('реплика удалена', await store.removeComment(1, 100), true)
check('обсуждение уменьшилось', store.comments.length, 1)
check('счётчик реплик уменьшился', store.items.find((i) => i.id === 1)?.commentCount, 1)

// Закрытие карточки забывает обсуждение: держать чужие реплики,
// пока открыта другая идея, незачем.
await store.select(null)
check('карточка закрыта', store.selectedId, null)
check('обсуждение забыто', store.comments.length, 0)

// --- Удаление -----------------------------------------------------------------

const totalBefore = store.total
check('идея удалена', await store.removeIdea(42), true)
check('идея ушла из списка', store.items.some((i) => i.id === 42), false)
check('счётчик всего уменьшился', store.total, totalBefore - 1)

// --- Ошибки ---------------------------------------------------------------------

const broken = fresh()
failNext = { status: 500, code: 'internal_error' }
await broken.load()

check('ошибка записана', typeof broken.error, 'string')
// Не помечен прочитанным — значит следующий заход повторит попытку,
// а не оставит страницу пустой навсегда.
check('перечень не помечен прочитанным', broken.loaded, false)

broken.clearError()
check('ошибка сбрасывается', broken.error, null)

if (failed > 0) {
  console.error(`\n${failed} проверок не пройдено`)
  process.exit(1)
}

console.log('ideas.test.ts: все проверки пройдены')
