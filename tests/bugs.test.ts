/**
 * Проверка клиентских правил привязки бага и выбора проекта.
 *
 * Источник истины — сервер: он отклонит и привязку к задаче не того
 * типа, и незнакомый проект. Клиент повторяет те же правила, чтобы
 * гасить недоступные действия заранее, не отправляя заведомо
 * неудачный запрос (домен: internal/domain/task/model.go).
 */

import {
  DEFAULT_PROJECT,
  PROJECT_ORDER,
  canAttachBug,
  hasBug,
} from '../src/types/task'
import type { Task, TaskProject } from '../src/types/task'
import { PROJECT_SHORT, PROJECT_TITLES, PROJECT_TONES } from '../src/lib/presentation'

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
    project: 'rtm-app',
    creatorId: 1,
    assigneeId: 2,
    version: 1,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

// --- Привязка бага ---------------------------------------------------

check('баг не привязан по умолчанию', hasBug(task()), false)
check('привязанный баг виден', hasBug(task({ bugId: 7 })), true)
check('bugId: null означает отсутствие привязки', hasBug(task({ bugId: null })), false)

check('к задаче типа bug баг привязать можно', canAttachBug(task()), true)

// Баг ведут только в задаче типа «баг»: иначе обратная синхронизация
// закрывала бы его по завершении посторонней работы.
for (const type of ['feature', 'fix', 'refactor', 'update'] as const) {
  check(`к задаче типа ${type} баг не привязать`, canAttachBug(task({ type })), false)
}

// Завершённую задачу сервер менять не даёт — включая привязку.
check(
  'в завершённой задаче привязка недоступна',
  canAttachBug(task({ status: 'complete' })),
  false,
)
check('в задаче на проверке привязка доступна', canAttachBug(task({ status: 'review' })), true)

// --- Проекты ---------------------------------------------------------

check('проектов ровно два', PROJECT_ORDER.length, 2)
check('проект по умолчанию — rtm-app', DEFAULT_PROJECT, 'rtm-app')
check('проект по умолчанию входит в перечень', PROJECT_ORDER.includes(DEFAULT_PROJECT), true)

// Каждому проекту нужны подписи и цвет: без них фильтр и значок на
// карточке показали бы пустое место.
for (const project of PROJECT_ORDER) {
  check(`у проекта ${project} есть подпись`, typeof PROJECT_TITLES[project], 'string')
  check(`у проекта ${project} есть короткая подпись`, typeof PROJECT_SHORT[project], 'string')
  check(`у проекта ${project} есть цвет`, typeof PROJECT_TONES[project]?.dot, 'string')
}

// Значения проектов должны совпадать с доменом: сервер принимает
// только эти строки, опечатка здесь дала бы 422 на каждое создание.
const expectedProjects: TaskProject[] = ['rtm-task', 'rtm-app']
check('состав проектов совпадает с доменом', PROJECT_ORDER.join(','), expectedProjects.join(','))

if (failed > 0) {
  console.error(`\n${failed} проверок не пройдено`)
  process.exit(1)
}

console.log('bugs.test.ts: все проверки пройдены')
