/**
 * Контракт задач — зеркало доменной модели RTM-Task.
 * Значения совпадают с internal/domain/task/model.go.
 */

export type TaskStatus = 'new' | 'working' | 'review' | 'complete'
export type TaskType = 'bug' | 'feature' | 'fix' | 'refactor' | 'update'

/** Приоритет: числовые значения заданы бэкендом, меньше — важнее. */
export const Priority = {
  Base: 10,
  High: 20,
  Medium: 30,
  Low: 40,
} as const

export type TaskPriority = (typeof Priority)[keyof typeof Priority]

export interface Task {
  id: number
  title: string
  description?: string
  type: TaskType
  status: TaskStatus
  priority: TaskPriority
  creatorId: number
  assigneeId: number | null
  version: number
  closedAt?: string | null
  createdAt: string
  updatedAt: string

  /** Замечание к доработке: живёт, пока задачу не приняли заново. */
  reworkNote?: string
  reworkById?: number | null
  reworkAt?: string | null
}

export interface TaskListResponse {
  items: Task[]
  total: number
  limit: number
  offset: number
}

export interface TaskFilters {
  status?: TaskStatus
  type?: TaskType
  priority?: TaskPriority
  creatorId?: number
  assigneeId?: number
  unassigned?: boolean
  limit?: number
  offset?: number
}

export interface CreateTaskPayload {
  title: string
  description?: string
  type: TaskType
  priority?: TaskPriority
  assigneeId?: number | null
}

export interface UpdateTaskPayload {
  title?: string
  description?: string
  type?: TaskType
  priority?: TaskPriority
}

/**
 * Порядок жизненного цикла. Дублирует таблицу переходов бэкенда,
 * чтобы UI мог заранее гасить недоступные действия, — но источником
 * истины остаётся сервер: он отклонит недопустимый переход.
 */
export const STATUS_ORDER: TaskStatus[] = ['new', 'working', 'review', 'complete']

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  new: ['working'],
  working: ['review', 'new'],
  review: ['complete', 'working'],
  complete: [],
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** Следующий статус по цепочке, если переход разрешён. */
export function nextStatus(status: TaskStatus): TaskStatus | null {
  const index = STATUS_ORDER.indexOf(status)
  const target = STATUS_ORDER[index + 1]
  return target && canTransition(status, target) ? target : null
}

/** Задачу вернули в работу с замечанием, и оно ещё не снято. */
export function isInRework(task: Task): boolean {
  return Boolean(task.reworkAt && task.reworkNote)
}

/**
 * Завершённую задачу можно отправить в доработку. Это не переход по
 * таблице выше: из complete обычного выхода нет, доработка — отдельная
 * операция со своим обязательным замечанием.
 */
export function canSendToRework(task: Task): boolean {
  return task.status === 'complete'
}

/** Предыдущий статус по цепочке, если возврат разрешён. */
export function previousStatus(status: TaskStatus): TaskStatus | null {
  const index = STATUS_ORDER.indexOf(status)
  const target = STATUS_ORDER[index - 1]
  return target && canTransition(status, target) ? target : null
}
