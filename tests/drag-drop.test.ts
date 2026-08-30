/**
 * Проверка правил, по которым доска решает, можно ли отпустить задачу
 * в колонку. Логика зеркалит серверную таблицу переходов и правило
 * «в работу только с исполнителем».
 */

import { canTransition, type Task, type TaskStatus } from '../src/types/task'

/** Копия canDrop из TaskBoard.vue — поведение должно совпадать. */
function canDrop(task: Task | null, status: TaskStatus): boolean {
  if (!task || task.status === status) return false
  return canTransition(task.status, status)
}

function makeTask(status: TaskStatus, assigneeId: number | null): Task {
  return {
    id: 1,
    title: 'Тестовая задача',
    type: 'bug',
    status,
    priority: 20,
    creatorId: 1,
    assigneeId,
    version: 1,
    createdAt: '2026-08-28T10:00:00Z',
    updatedAt: '2026-08-28T10:00:00Z',
  }
}

let failed = 0
const check = (name: string, actual: boolean, expected: boolean) => {
  if (actual !== expected) {
    console.error(`FAIL: ${name}: ожидали ${expected}, получили ${actual}`)
    failed += 1
  }
}

const assigned = makeTask('new', 7)
const unassigned = makeTask('new', null)

// Разрешённые переходы
check('new → working (с исполнителем)', canDrop(assigned, 'working'), true)
check('working → review', canDrop(makeTask('working', 7), 'review'), true)
check('review → complete', canDrop(makeTask('review', 7), 'complete'), true)
check('review → working', canDrop(makeTask('review', 7), 'working'), true)
check('working → new', canDrop(makeTask('working', 7), 'new'), true)

// Запрещённые переходы
check('new → review (через голову)', canDrop(assigned, 'review'), false)
check('new → complete', canDrop(assigned, 'complete'), false)
check('complete → working (финальный)', canDrop(makeTask('complete', 7), 'working'), false)

// Особые случаи
// Задачу без исполнителя в работу перетащить можно: тот, кто перетащил,
// становится исполнителем (changeStatusAsOwner в сторе).
check('в работу без исполнителя', canDrop(unassigned, 'working'), true)
check('в свою же колонку', canDrop(assigned, 'new'), false)

// Регрессия: при drop состояние стора уже сброшено, и раньше проверка
// читала оттуда null — перенос молча отменялся. Теперь задача передаётся
// явно, а null означает именно отсутствие задачи.
check('null вместо задачи', canDrop(null, 'working'), false)

/**
 * Копия правила из changeStatusAsOwner: назначение нужно только когда
 * ничья задача уходит в работу.
 */
function needsAssignee(task: Task, status: TaskStatus): boolean {
  return status === 'working' && task.assigneeId === null
}

check('ничья задача в работу — назначаем', needsAssignee(unassigned, 'working'), true)
check('задача с исполнителем — не трогаем', needsAssignee(assigned, 'working'), false)
check(
  'ничья задача не в работу — не назначаем',
  needsAssignee(makeTask('review', null), 'complete'),
  false,
)

if (failed > 0) {
  console.error(`\n${failed} проверок не прошло`)
  process.exit(1)
}

console.log('OK: 14 проверок drag & drop пройдено')
