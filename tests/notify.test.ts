/**
 * Проверка правил оповещения о новых задачах и комментариях.
 *
 * Логика решает, кого и когда беспокоить. Ошибка здесь либо оставляет
 * человека без уведомления, либо звенит на каждое чужое событие — и то
 * и другое приводит к тому, что звук выключают совсем.
 *
 * Правила повторяют stores/tasks.ts (announceTask и announceComment).
 */

import type { Comment, Task, TaskProject } from '../src/types/task'

let failed = 0

function check(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    console.error(`FAIL: ${name}: ожидали ${expected}, получили ${actual}`)
    failed += 1
  }
}

const VIEWER = 10

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Задача',
    type: 'bug',
    status: 'new',
    priority: 20,
    project: 'rtm-task',
    creatorId: 99,
    assigneeId: null,
    version: 1,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    taskId: 1,
    authorId: 99,
    body: 'Реплика',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

/** Копия inScope из stores/tasks.ts. */
function inScope(
  item: Task,
  scope: 'mine' | 'all',
  project: TaskProject | 'all',
  viewerId: number | null,
): boolean {
  if (project !== 'all' && item.project !== project) return false
  if (scope === 'all') return true
  return item.assigneeId === viewerId || item.creatorId === viewerId
}

/** Копия announceTask: оповещаем ли о появившейся задаче. */
function announcesTask(item: Task, viewerId: number | null): boolean {
  return item.creatorId !== viewerId
}

/** Копия announceComment: оповещаем ли о реплике. */
function announcesComment(
  entry: Comment,
  known: Task[],
  viewerId: number | null,
): boolean {
  if (entry.authorId === viewerId) return false

  const parent = known.find((item) => item.id === entry.taskId)
  if (!parent) return false
  return parent.assigneeId === viewerId || parent.creatorId === viewerId
}

// --- Задачи ----------------------------------------------------------

// О собственной задаче звенеть незачем: сигнал был бы эхом своего клика.
check('своя задача не озвучивается', announcesTask(task({ creatorId: VIEWER }), VIEWER), false)
check('чужая задача озвучивается', announcesTask(task(), VIEWER), true)
check(
  'чужая задача на нас озвучивается',
  announcesTask(task({ assigneeId: VIEWER }), VIEWER),
  true,
)

// --- Область видимости ----------------------------------------------

// Фильтр по проекту применяется и к потоку событий: иначе realtime
// приносил бы на доску то, чего не вернула бы загрузка.
check(
  'задача другого проекта не попадает на доску',
  inScope(task({ project: 'rtm-app' }), 'all', 'rtm-task', VIEWER),
  false,
)
check(
  'задача выбранного проекта попадает на доску',
  inScope(task({ project: 'rtm-app' }), 'all', 'rtm-app', VIEWER),
  true,
)
check('без фильтра проходит любой проект', inScope(task({ project: 'rtm-app' }), 'all', 'all', VIEWER), true)

// В режиме «Мои» чужие задачи из потока игнорируются.
check('чужая задача вне режима «Мои»', inScope(task(), 'mine', 'all', VIEWER), false)
check(
  'наша по исполнителю задача входит в «Мои»',
  inScope(task({ assigneeId: VIEWER }), 'mine', 'all', VIEWER),
  true,
)
check(
  'наша по автору задача входит в «Мои»',
  inScope(task({ creatorId: VIEWER }), 'mine', 'all', VIEWER),
  true,
)

// Проект отсеивает задачу даже когда она наша: доска показывает
// один проект, и звенеть о том, что на ней не появится, нельзя.
check(
  'своя задача чужого проекта не проходит',
  inScope(task({ assigneeId: VIEWER, project: 'rtm-app' }), 'mine', 'rtm-task', VIEWER),
  false,
)

// --- Комментарии -----------------------------------------------------

const mine = task({ id: 1, assigneeId: VIEWER })
const foreign = task({ id: 2, creatorId: 99, assigneeId: 98 })

check('своя реплика не озвучивается', announcesComment(comment({ authorId: VIEWER }), [mine], VIEWER), false)
check('чужая реплика в нашей задаче озвучивается', announcesComment(comment(), [mine], VIEWER), true)
check(
  'реплика в чужой задаче не озвучивается',
  announcesComment(comment({ taskId: 2 }), [mine, foreign], VIEWER),
  false,
)

// Задачи нет в списке — она вне области видимости, и о ней молчим.
check(
  'реплика в неизвестной задаче не озвучивается',
  announcesComment(comment({ taskId: 404 }), [mine], VIEWER),
  false,
)

check(
  'реплика в задаче, где мы автор, озвучивается',
  announcesComment(comment({ taskId: 3 }), [task({ id: 3, creatorId: VIEWER })], VIEWER),
  true,
)

if (failed > 0) {
  console.error(`\n${failed} проверок не пройдено`)
  process.exit(1)
}

console.log('notify.test.ts: все проверки пройдены')
