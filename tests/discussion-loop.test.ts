/**
 * Регрессия: обсуждение открытой задачи не должно перезагружаться
 * по кругу.
 *
 * Цикл, который здесь ловится, выглядел так:
 *   загрузка чек-листа → syncSummary → applySummary пишет новый объект
 *   задачи → selected (computed по списку) отдаёт новую ссылку →
 *   watch по объекту принимает это за смену задачи → discussion.open →
 *   refresh → загрузка чек-листа → ...
 *
 * На проде это давало 100+ запросов в секунду на /tasks/:id/checklist.
 * Каждое из трёх звеньев чинится отдельно, поэтому проверяются все три.
 */

import type { Task } from '../src/types/task'

let failed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    console.error(`FAIL: ${name}: ожидали ${expected}, получили ${actual}`)
    failed += 1
  }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 81,
    title: 'Задача',
    type: 'feature',
    status: 'working',
    priority: 20,
    creatorId: 1,
    assigneeId: 2,
    version: 3,
    createdAt: '2026-09-03T10:00:00Z',
    updatedAt: '2026-09-03T10:00:00Z',
    ...overrides,
  }
}

type Summary = { checklistTotal?: number; checklistDone?: number; commentCount?: number }

/** Копия applySummary из stores/tasks.ts. */
function applySummary(items: Task[], id: number, summary: Summary): Task[] {
  const index = items.findIndex((item) => item.id === id)
  if (index === -1) return items

  const current = items[index]
  const same = (Object.keys(summary) as (keyof Summary)[]).every(
    (key) => summary[key] === undefined || summary[key] === current[key],
  )
  if (same) return items

  const next = [...items]
  next[index] = { ...current, ...summary }
  return next
}

// --- Звено 1: applySummary не переписывает задачу впустую ---

const withSummary = [task({ checklistTotal: 3, checklistDone: 1, commentCount: 2 })]

const unchanged = applySummary(withSummary, 81, {
  checklistTotal: 3,
  checklistDone: 1,
  commentCount: 2,
})
// Та же ссылка на элемент — значит подписчики не проснутся.
check('те же счётчики не меняют ссылку', unchanged[0] === withSummary[0], true)

const changed = applySummary(withSummary, 81, {
  checklistTotal: 4,
  checklistDone: 1,
  commentCount: 2,
})
check('изменившийся счётчик даёт новую ссылку', changed[0] === withSummary[0], false)
check('новое значение применилось', changed[0].checklistTotal, 4)

// Впервые пришедшая сводка (в задаче полей ещё нет) обязана примениться.
const fresh = applySummary([task()], 81, { checklistTotal: 0, checklistDone: 0, commentCount: 0 })
check('нули поверх undefined применяются', fresh[0].checklistTotal, 0)
check('нули поверх undefined меняют ссылку', fresh[0] === withSummary[0], false)

// Неизвестная задача не создаётся из воздуха.
check('чужой id не трогает список', applySummary(withSummary, 999, { commentCount: 5 })[0].commentCount, 2)

// --- Звено 2: watch следит за id, а не за объектом ---

/**
 * Что видит watch: при слежении за объектом любая правка задачи читается
 * как смена задачи, при слежении за id — только настоящая смена.
 */
function watchFires(before: Task | null, after: Task | null, mode: 'object' | 'id'): boolean {
  if (mode === 'object') return before !== after
  return (before?.id ?? null) !== (after?.id ?? null)
}

const before = withSummary[0]
const afterSummary = changed[0]

check('watch по объекту срабатывает на правку счётчиков', watchFires(before, afterSummary, 'object'), true)
check('watch по id не срабатывает на правку счётчиков', watchFires(before, afterSummary, 'id'), false)

// Настоящая смена задачи обязана срабатывать в обоих режимах.
const other = task({ id: 82 })
check('watch по id срабатывает на смену задачи', watchFires(before, other, 'id'), true)
check('watch по id срабатывает на закрытие окна', watchFires(before, null, 'id'), true)
check('watch по id срабатывает на открытие окна', watchFires(null, before, 'id'), true)

// --- Звено 3: open() не перезагружает уже открытую задачу ---

/** Копия решения из discussion.open: возвращает true, если пойдёт запрос. */
function openTriggersFetch(currentTaskId: number | null, requestedId: number): boolean {
  return currentTaskId !== requestedId
}

check('повторный open той же задачи не грузит', openTriggersFetch(81, 81), false)
check('open другой задачи грузит', openTriggersFetch(81, 82), true)
check('первый open грузит', openTriggersFetch(null, 81), true)

// --- Цикл целиком: моделируем последовательность из бага ---

let fetches = 0
let items = [task()] // счётчиков ещё нет — как после первой загрузки списка
let openedId: number | null = null
let selectedRef: Task | null = items[0]

function openDiscussion(id: number): void {
  if (!openTriggersFetch(openedId, id)) return
  openedId = id
  fetches += 1

  // Загрузка завершилась — стор обсуждения переносит счётчики в карточку.
  items = applySummary(items, id, { checklistTotal: 3, checklistDone: 1, commentCount: 2 })
  const next = items.find((item) => item.id === id) ?? null

  // Watch по id: перезапуск только при смене задачи.
  if (watchFires(selectedRef, next, 'id')) {
    selectedRef = next
    openDiscussion(id)
    return
  }
  selectedRef = next
}

openDiscussion(81)
check('открытие задачи делает ровно один запрос', fetches, 1)

// Повторная синхронизация теми же значениями ничего не запускает.
const settled = items[0]
items = applySummary(items, 81, { checklistTotal: 3, checklistDone: 1, commentCount: 2 })
check('повторная сводка не меняет список', items[0] === settled, true)

if (failed > 0) {
  console.error(`\n${failed} проверок не прошло`)
  process.exit(1)
}

console.log('discussion-loop.test.ts: все проверки пройдены')
