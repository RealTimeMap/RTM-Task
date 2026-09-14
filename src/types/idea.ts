/**
 * Контракт копилки идей — зеркало internal/domain/idea/model.go.
 *
 * Идея намеренно проще задачи: ни исполнителя, ни приоритета, ни
 * жизненного цикла. Замысел либо ещё обдумывают, либо уже сделали —
 * двух состояний достаточно, а всё остальное появляется тогда, когда
 * за идею берутся и заводят по ней задачу.
 */

export interface Idea {
  id: number
  title: string
  description?: string
  authorId: number

  done: boolean
  doneAt?: string | null
  doneById?: number | null

  /** Сколько реплик в обсуждении. Приходит со списком и чтением. */
  commentCount: number

  createdAt: string
  updatedAt: string
}

/** Реплика обсуждения идеи. */
export interface IdeaComment {
  id: number
  ideaId: number
  authorId: number
  body: string
  editedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface IdeaListResponse {
  items: Idea[]
  total: number
  limit: number
  offset: number
}

export interface IdeaCommentListResponse {
  items: IdeaComment[]
  total: number
}

export interface CreateIdeaPayload {
  title: string
  description?: string
}

/**
 * Правка идеи. Отсутствующее поле означает «не трогать», пустая
 * строка в описании — осознанное стирание: идею могли записать наспех,
 * и убрать подробности должно быть можно.
 */
export interface UpdateIdeaPayload {
  title?: string
  description?: string
}

/** Отбор идей. Отсутствие done — показать все. */
export interface IdeaFilters {
  done?: boolean
  authorId?: number
  limit?: number
  offset?: number
}

/**
 * Ограничения совпадают с доменными (internal/domain/idea/model.go):
 * сервер отклонит выход за них, а UI гасит кнопку заранее, не
 * отправляя заведомо неудачный запрос.
 */
export const MIN_IDEA_TITLE = 3
export const MAX_IDEA_TITLE = 300
export const MAX_IDEA_DESCRIPTION = 20000
export const MAX_IDEA_COMMENT = 5000

/** Заголовок годится для отправки. */
export function isValidIdeaTitle(title: string): boolean {
  const trimmed = title.trim()
  return trimmed.length >= MIN_IDEA_TITLE && trimmed.length <= MAX_IDEA_TITLE
}
