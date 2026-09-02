/**
 * Проверка клиентских правил сортировки списка.
 *
 * Порядок строит сервер, но клиент повторяет сравнение, чтобы
 * push-события не ломали расстановку. Ранги должны совпадать с
 * CASE-выражениями репозитория (postgres/task.go — orderClause).
 */

import { STATUS_ORDER, defaultSortOrder, DEFAULT_SORT } from '../src/types/task'
import type { SortField, SortOrder, Task, TaskSort, TaskStatus, TaskType } from '../src/types/task'
import { TYPE_ORDER } from '../src/lib/presentation'

let failed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    console.error(`FAIL: ${name}: ожидали ${expected}, получили ${actual}`)
    failed += 1
  }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Задача',
    type: 'bug',
    status: 'new',
    priority: 20,
    creatorId: 1,
    assigneeId: 2,
    version: 1,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

/** Копии sortRank и compareTasks из stores/tasks.ts. */
function sortRank(item: Task, field: SortField): number {
  switch (field) {
    case 'priority':
      return item.priority
    case 'status':
      return STATUS_ORDER.indexOf(item.status)
    case 'type':
      return TYPE_ORDER.indexOf(item.type)
    case 'createdAt':
      return Date.parse(item.createdAt) || 0
  }
}

function compareTasks(a: Task, b: Task, sort: TaskSort): number {
  const diff = sortRank(a, sort.field) - sortRank(b, sort.field)
  if (diff !== 0) {
    return sort.order === 'asc' ? diff : -diff
  }
  return b.id - a.id
}

function order(items: Task[], field: SortField, dir: SortOrder): string {
  return [...items]
    .sort((a, b) => compareTasks(a, b, { field, order: dir }))
    .map((item) => item.id)
    .join(',')
}

// Направление по умолчанию должно совпадать с defaultOrder бэкенда.
check('дата по умолчанию убывает', defaultSortOrder('createdAt'), 'desc')
for (const field of ['priority', 'status', 'type'] as SortField[]) {
  check(`${field} по умолчанию возрастает`, defaultSortOrder(field), 'asc')
}

// Порядок по умолчанию — тот же, что сервер отдаёт без параметров.
check('поле по умолчанию', DEFAULT_SORT.field, 'priority')
check('направление по умолчанию', DEFAULT_SORT.order, 'asc')

// Приоритет: меньше число — важнее, поэтому asc ставит критичные первыми.
const byPriority = [
  task({ id: 1, priority: 40 }),
  task({ id: 2, priority: 10 }),
  task({ id: 3, priority: 30 }),
]
check('приоритет asc: критичные первыми', order(byPriority, 'priority', 'asc'), '2,3,1')
check('приоритет desc', order(byPriority, 'priority', 'desc'), '1,3,2')

// Статус: порядок жизненного цикла, а не алфавитный. По алфавиту
// complete встал бы первым — это и есть ловушка, которую ловит тест.
const statuses: TaskStatus[] = ['complete', 'new', 'review', 'working']
const byStatus = statuses.map((status, i) => task({ id: i + 1, status }))
check('статус asc: new → working → review → complete', order(byStatus, 'status', 'asc'), '2,4,3,1')
check('статус desc', order(byStatus, 'status', 'desc'), '1,3,4,2')

// Тип: порядок домена (bug, feature, fix, refactor, update).
const types: TaskType[] = ['update', 'bug', 'refactor', 'feature', 'fix']
const byType = types.map((type, i) => task({ id: i + 1, type }))
check('тип asc: доменный порядок', order(byType, 'type', 'asc'), '2,4,5,3,1')

// Дата: desc ставит свежие первыми.
const byDate = [
  task({ id: 1, createdAt: '2026-08-01T10:00:00Z' }),
  task({ id: 2, createdAt: '2026-09-01T10:00:00Z' }),
  task({ id: 3, createdAt: '2026-07-01T10:00:00Z' }),
]
check('дата desc: свежие первыми', order(byDate, 'createdAt', 'desc'), '2,1,3')
check('дата asc: старые первыми', order(byDate, 'createdAt', 'asc'), '3,1,2')

// Битая дата не должна ломать сортировку — задача просто уходит в конец
// при desc, а не выбрасывает NaN, от которого порядок стал бы случайным.
const withBrokenDate = [
  task({ id: 1, createdAt: 'не дата' }),
  task({ id: 2, createdAt: '2026-09-01T10:00:00Z' }),
]
check('битая дата не ломает порядок', order(withBrokenDate, 'createdAt', 'desc'), '2,1')

// Равные значения поля: второй ключ — id по убыванию, как в запросе.
const tied = [task({ id: 5, priority: 20 }), task({ id: 9, priority: 20 }), task({ id: 7, priority: 20 })]
check('равные значения: id по убыванию', order(tied, 'priority', 'asc'), '9,7,5')
check('равные значения при desc: тот же ключ', order(tied, 'priority', 'desc'), '9,7,5')

/** Вставка новой задачи из push-события — копия insertSorted. */
function insertSorted(list: Task[], entry: Task, sort: TaskSort): number[] {
  const at = list.findIndex((item) => compareTasks(entry, item, sort) < 0)
  const next = at === -1 ? [...list, entry] : [...list.slice(0, at), entry, ...list.slice(at)]
  return next.map((item) => item.id)
}

const sorted = [task({ id: 3, priority: 10 }), task({ id: 2, priority: 20 }), task({ id: 1, priority: 40 })]
const sortByPriority: TaskSort = { field: 'priority', order: 'asc' }

// Новая задача встаёт по своему приоритету, а не в начало списка.
check(
  'новая задача в середину',
  insertSorted(sorted, task({ id: 9, priority: 30 }), sortByPriority).join(','),
  '3,2,9,1',
)
check(
  'новая задача в начало',
  insertSorted(sorted, task({ id: 9, priority: 5 }), sortByPriority).join(','),
  '9,3,2,1',
)
check(
  'новая задача в конец',
  insertSorted(sorted, task({ id: 9, priority: 40 }), sortByPriority).join(','),
  '3,2,9,1',
)

// Смена поля сортировки меняет ранг — по нему стор понимает, что задачу
// нужно переставить.
const before = task({ id: 1, status: 'new' })
const after = task({ id: 1, status: 'complete' })
check(
  'смена статуса меняет ранг',
  sortRank(before, 'status') !== sortRank(after, 'status'),
  true,
)
check(
  'смена статуса не трогает ранг по типу',
  sortRank(before, 'type') === sortRank(after, 'type'),
  true,
)

if (failed > 0) {
  console.error(`\n${failed} проверок не прошло`)
  process.exit(1)
}

console.log('sorting.test.ts: все проверки пройдены')
