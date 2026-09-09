/**
 * Контракт задач — зеркало доменной модели RTM-Task.
 * Значения совпадают с internal/domain/task/model.go.
 */

export type TaskStatus = 'new' | 'working' | 'review' | 'complete'
export type TaskType = 'bug' | 'feature' | 'fix' | 'refactor' | 'update'

/**
 * Проект, в который направлена задача. Значения совпадают с доменом
 * (internal/domain/task/model.go - Project).
 */
export type TaskProject = 'rtm-task' | 'rtm-app'

export const PROJECT_ORDER: TaskProject[] = ['rtm-task', 'rtm-app']

/** Проект по умолчанию - тот же, что проставляет сервер. */
export const DEFAULT_PROJECT: TaskProject = 'rtm-task'

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
  project: TaskProject
  creatorId: number
  assigneeId: number | null
  version: number

  /**
   * Баг из feedback-service, над которым идёт работа.
   * Приходит только у задач типа bug.
   */
  bugId?: number | null
  closedAt?: string | null
  createdAt: string
  updatedAt: string

  /** Замечание к доработке: живёт, пока задачу не приняли заново. */
  reworkNote?: string
  reworkById?: number | null
  reworkAt?: string | null

  /**
   * Сводка по вложенным записям. Приходит только при загрузке списка
   * и чтении задачи: события изменения статуса её не несут, поэтому
   * поля опциональны, а не обязательные нули.
   */
  checklistTotal?: number
  checklistDone?: number
  commentCount?: number
}

/** Комментарий к задаче. */
export interface Comment {
  id: number
  taskId: number
  authorId: number
  body: string
  editedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface CommentListResponse {
  items: Comment[]
  total: number
}

/** Пункт чек-листа задачи. */
export interface ChecklistItem {
  id: number
  taskId: number
  title: string
  position: number
  done: boolean
  doneAt?: string | null
  doneById?: number | null
  createdAt: string
  updatedAt: string
}

export interface ChecklistResponse {
  items: ChecklistItem[]
  total: number
  done: number
}

export interface UpdateChecklistItemPayload {
  title?: string
  done?: boolean
}

export interface TaskListResponse {
  items: Task[]
  total: number
  limit: number
  offset: number
}

/**
 * Поля сортировки списка. Значения совпадают с доменом
 * (internal/domain/task/filter.go — SortField).
 */
export type SortField = 'createdAt' | 'priority' | 'status' | 'type'
export type SortOrder = 'asc' | 'desc'

export interface TaskSort {
  field: SortField
  order: SortOrder
}

/**
 * Направление, в котором поле читается естественно.
 *
 * Свежие задачи интереснее старых, поэтому дата убывает. Приоритет,
 * статус и тип — шкалы с осмысленным началом (важное, новое, первый
 * тип), их читают по возрастанию. Дублирует defaultOrder бэкенда,
 * чтобы первый клик по колонке давал ожидаемый порядок без запроса.
 */
export function defaultSortOrder(field: SortField): SortOrder {
  return field === 'createdAt' ? 'desc' : 'asc'
}

/** Порядок списка по умолчанию — тот же, что отдаёт сервер без параметров. */
export const DEFAULT_SORT: TaskSort = { field: 'priority', order: 'asc' }

export interface TaskFilters {
  status?: TaskStatus
  type?: TaskType
  priority?: TaskPriority
  project?: TaskProject
  creatorId?: number
  assigneeId?: number
  unassigned?: boolean
  sort?: SortField
  order?: SortOrder
  limit?: number
  offset?: number
}

export interface CreateTaskPayload {
  title: string
  description?: string
  type: TaskType
  priority?: TaskPriority
  project?: TaskProject
  assigneeId?: number | null
  /** Заготовка чек-листа, заполняемая прямо в форме создания. */
  checklist?: string[]

  /**
   * Баг, который берут в работу этой задачей.
   * Сервер принимает его только вместе с type: 'bug'.
   */
  bugId?: number | null
}

/**
 * Баг из feedback-service, доступный для привязки.
 *
 * Завершённые и уже занятые другой задачей баги сюда не попадают:
 * их отбирает feedback-service.
 */
export interface Bug {
  id: number
  title: string
  description?: string
  tag: BugTag
  status: string
  platform?: string
  build?: string
  hasLogs: boolean
  createdAt: string
}

/**
 * Баг целиком: обстановка воспроизведения и логи.
 *
 * Отдельно от карточки перечня - эти поля приходят только при чтении
 * конкретного бага, потому что логи весят прилично.
 */
export interface BugDetail extends Bug {
  os?: string
  resolution?: string
  width?: number
  height?: number
  battery?: number | null
  reporterId?: number | null
  logs: string[]
}

/** Категория бага. Значения принадлежат feedback-service. */
export type BugTag = 'feature' | 'ui' | 'logic'

export interface BugListResponse {
  items: Bug[]
  total: number
}

export interface UpdateTaskPayload {
  title?: string
  description?: string
  type?: TaskType
  priority?: TaskPriority
  project?: TaskProject
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

/**
 * Ограничения совпадают с доменными: сервер отклонит выход за них,
 * а UI гасит кнопку заранее, не отправляя заведомо неудачный запрос.
 */
export const MAX_COMMENT_LENGTH = 5000
export const MAX_CHECKLIST_TITLE = 300
export const MAX_CHECKLIST_ITEMS = 50

/** Доля выполненных пунктов чек-листа, 0…1. Пустой список — ноль. */
export function checklistProgress(task: Task): number {
  const total = task.checklistTotal ?? 0
  if (total === 0) return 0
  return (task.checklistDone ?? 0) / total
}

/** У задачи есть чек-лист, который стоит показать на карточке. */
export function hasChecklist(task: Task): boolean {
  return (task.checklistTotal ?? 0) > 0
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

/** К задаче привязан баг из feedback-service. */
export function hasBug(task: Task): boolean {
  return typeof task.bugId === 'number'
}

/**
 * Баг можно привязать только к задаче типа bug: сервер отклонит
 * привязку к любой другой, а обратная синхронизация закрывала бы баг
 * по завершении посторонней работы.
 */
export function canAttachBug(task: Task): boolean {
  return task.type === 'bug' && task.status !== 'complete'
}
