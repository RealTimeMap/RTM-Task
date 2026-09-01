/**
 * Проверка клиентских правил доработки: они должны совпадать с доменом
 * (internal/domain/task/model.go — SendToRework).
 *
 * Ключевое отличие от обычных переходов: возврат из complete не проходит
 * по таблице canTransition, это отдельная операция с замечанием.
 */

import { canSendToRework, canTransition, isInRework, type Task, type TaskStatus } from '../src/types/task'

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
    type: 'refactor',
    status: 'complete',
    priority: 30,
    creatorId: 1,
    assigneeId: 2,
    version: 3,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

// Отправить в доработку можно только завершённую задачу.
const statuses: TaskStatus[] = ['new', 'working', 'review', 'complete']
for (const status of statuses) {
  check(`canSendToRework(${status})`, canSendToRework(task({ status })), status === 'complete')
}

// Возврат из complete не должен появиться в таблице обычных переходов:
// иначе drag & drop потащил бы задачу обратно без замечания.
for (const target of statuses) {
  check(`canTransition(complete → ${target})`, canTransition('complete', target), false)
}

// Признак доработки требует обоих полей: без текста замечания баннер пуст,
// без даты непонятно, актуально ли оно.
check('isInRework: оба поля', isInRework(task({ reworkAt: '2026-09-01T12:00:00Z', reworkNote: 'Поправить' })), true)
check('isInRework: только дата', isInRework(task({ reworkAt: '2026-09-01T12:00:00Z' })), false)
check('isInRework: только текст', isInRework(task({ reworkNote: 'Поправить' })), false)
check('isInRework: пусто', isInRework(task()), false)
check('isInRework: пустая строка', isInRework(task({ reworkAt: '2026-09-01T12:00:00Z', reworkNote: '' })), false)

// Типы задач: новые значения должны быть частью объединения.
const types = ['bug', 'feature', 'fix', 'refactor', 'update'] as const
for (const type of types) {
  check(`тип ${type} допустим`, task({ type }).type, type)
}

if (failed > 0) {
  console.error(`\n${failed} проверок не прошло`)
  process.exit(1)
}

console.log(`OK: ${statuses.length * 2 + 5 + types.length} проверок доработки пройдено`)
