/**
 * Проверка клиентских правил обсуждения и чек-листа.
 *
 * Пределы и производные величины должны совпадать с доменом
 * (internal/domain/task/service.go — validateCommentBody,
 * validateChecklistTitle, maxChecklistItems).
 */

import {
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_TITLE,
  MAX_COMMENT_LENGTH,
  checklistProgress,
  hasChecklist,
  type ChecklistItem,
  type Comment,
  type Task,
} from '../src/types/task'

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
    type: 'feature',
    status: 'working',
    priority: 30,
    creatorId: 1,
    assigneeId: 2,
    version: 3,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

// Пределы обязаны совпадать с серверными: расхождение означает, что
// UI либо гасит кнопку раньше времени, либо шлёт заведомый отказ.
check('предел комментария', MAX_COMMENT_LENGTH, 5000)
check('предел пункта', MAX_CHECKLIST_TITLE, 300)
check('предел числа пунктов', MAX_CHECKLIST_ITEMS, 50)

// Прогресс: пустой чек-лист даёт ноль, а не деление на ноль.
check('прогресс без чек-листа', checklistProgress(task()), 0)
check('прогресс 0 из 4', checklistProgress(task({ checklistTotal: 4, checklistDone: 0 })), 0)
check('прогресс 1 из 4', checklistProgress(task({ checklistTotal: 4, checklistDone: 1 })), 0.25)
check('прогресс 4 из 4', checklistProgress(task({ checklistTotal: 4, checklistDone: 4 })), 1)

// Счётчик выполненных может отсутствовать в событии — считаем нулём,
// а не NaN: иначе полоса прогресса ломается на пришедшем push-событии.
check(
  'прогресс без checklistDone',
  checklistProgress(task({ checklistTotal: 4 })),
  0,
)

// Значок чек-листа показывается только когда пункты есть.
check('hasChecklist: нет полей', hasChecklist(task()), false)
check('hasChecklist: ноль пунктов', hasChecklist(task({ checklistTotal: 0 })), false)
check('hasChecklist: есть пункты', hasChecklist(task({ checklistTotal: 3 })), true)

/**
 * Слияние счётчиков при realtime-событии.
 *
 * Повторяет логику upsert в src/stores/tasks.ts: событие изменения
 * статуса не несёт сводки, и отсутствующие поля не должны затирать
 * уже известные значения.
 */
function mergeSummary(current: Task, incoming: Task): Task {
  return {
    ...incoming,
    checklistTotal: incoming.checklistTotal ?? current.checklistTotal,
    checklistDone: incoming.checklistDone ?? current.checklistDone,
    commentCount: incoming.commentCount ?? current.commentCount,
  }
}

const known = task({ checklistTotal: 5, checklistDone: 2, commentCount: 3 })
const fromEvent = task({ version: 4, status: 'review' })
const merged = mergeSummary(known, fromEvent)

check('слияние: статус берётся из события', merged.status, 'review')
check('слияние: версия берётся из события', merged.version, 4)
check('слияние: чек-лист сохранён', merged.checklistTotal, 5)
check('слияние: выполнено сохранено', merged.checklistDone, 2)
check('слияние: комментарии сохранены', merged.commentCount, 3)

// Свежая сводка из полной загрузки перекрывает известную.
const reloaded = mergeSummary(known, task({ checklistTotal: 6, checklistDone: 6, commentCount: 0 }))
check('перезагрузка: новый total', reloaded.checklistTotal, 6)
check('перезагрузка: новый done', reloaded.checklistDone, 6)
// Ноль — это значение, а не «нет данных»: удалили единственную реплику.
check('перезагрузка: ноль комментариев применяется', reloaded.commentCount, 0)

/** Порядок пунктов: по позиции, при равенстве — по идентификатору. */
function byPosition(a: ChecklistItem, b: ChecklistItem): number {
  return a.position - b.position || a.id - b.id
}

function item(id: number, position: number): ChecklistItem {
  return {
    id,
    taskId: 1,
    title: `Пункт ${id}`,
    position,
    done: false,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
  }
}

const ordered = [item(3, 2), item(1, 0), item(2, 1)].sort(byPosition)
check('порядок пунктов', ordered.map((entry) => entry.id).join(','), '1,2,3')

// Одинаковая позиция возможна после параллельной вставки — тогда
// порядок определяет идентификатор, а не случайность сортировки.
const tied = [item(9, 0), item(4, 0)].sort(byPosition)
check('порядок при равных позициях', tied.map((entry) => entry.id).join(','), '4,9')

/** Признак правленого комментария. */
function isEdited(comment: Comment): boolean {
  return Boolean(comment.editedAt)
}

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 1,
    taskId: 1,
    authorId: 2,
    body: 'текст',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

check('новый комментарий не правлен', isEdited(comment()), false)
check('null не считается правкой', isEdited(comment({ editedAt: null })), false)
check('дата означает правку', isEdited(comment({ editedAt: '2026-09-01T11:00:00Z' })), true)

/**
 * Права на чужой текст: свой комментарий правит автор, чужой — только
 * управляющая роль. Совпадает с canManageComment в домене.
 */
function canManage(authorId: number, viewerId: number, isManager: boolean): boolean {
  return authorId === viewerId || isManager
}

check('автор правит свой', canManage(2, 2, false), true)
check('чужой без прав', canManage(2, 7, false), false)
check('менеджер правит чужой', canManage(2, 7, true), true)

if (failed > 0) {
  console.error(`\n${failed} проверок не прошло`)
  process.exit(1)
}

console.log('discussion.test.ts: все проверки пройдены')
