import { request } from './client'
import type {
  ChecklistItem,
  ChecklistResponse,
  Comment,
  CommentListResponse,
  CreateTaskPayload,
  Task,
  TaskFilters,
  TaskListResponse,
  TaskStatus,
  UpdateChecklistItemPayload,
  UpdateTaskPayload,
} from '../types/task'

export const tasksApi = {
  list(filters: TaskFilters = {}): Promise<TaskListResponse> {
    return request<TaskListResponse>('/tasks', { query: { ...filters } })
  },

  get(id: number): Promise<Task> {
    return request<Task>(`/tasks/${id}`)
  },

  create(payload: CreateTaskPayload): Promise<Task> {
    return request<Task>('/tasks', { method: 'POST', body: payload })
  },

  update(id: number, payload: UpdateTaskPayload): Promise<Task> {
    return request<Task>(`/tasks/${id}`, { method: 'PATCH', body: payload })
  },

  changeStatus(id: number, status: TaskStatus): Promise<Task> {
    return request<Task>(`/tasks/${id}/status`, { method: 'PATCH', body: { status } })
  },

  /**
   * Возврат завершённой задачи в работу. Отдельный маршрут, а не смена
   * статуса: замечание обязательно, и это видно по контракту.
   */
  sendToRework(id: number, note: string): Promise<Task> {
    return request<Task>(`/tasks/${id}/rework`, { method: 'POST', body: { note } })
  },

  assign(id: number, assigneeId: number): Promise<Task> {
    return request<Task>(`/tasks/${id}/assignee`, { method: 'PUT', body: { assigneeId } })
  },

  unassign(id: number): Promise<Task> {
    return request<Task>(`/tasks/${id}/assignee`, { method: 'DELETE' })
  },

  remove(id: number): Promise<void> {
    return request<void>(`/tasks/${id}`, { method: 'DELETE' })
  },
}

/**
 * Обсуждение и чек-лист живут вложенными в задачу: без неё они
 * не существуют, и адреса это отражают.
 */
export const commentsApi = {
  list(taskId: number): Promise<CommentListResponse> {
    return request<CommentListResponse>(`/tasks/${taskId}/comments`)
  },

  create(taskId: number, body: string): Promise<Comment> {
    return request<Comment>(`/tasks/${taskId}/comments`, { method: 'POST', body: { body } })
  },

  update(taskId: number, commentId: number, body: string): Promise<Comment> {
    return request<Comment>(`/tasks/${taskId}/comments/${commentId}`, {
      method: 'PATCH',
      body: { body },
    })
  },

  remove(taskId: number, commentId: number): Promise<void> {
    return request<void>(`/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' })
  },
}

export const checklistApi = {
  list(taskId: number): Promise<ChecklistResponse> {
    return request<ChecklistResponse>(`/tasks/${taskId}/checklist`)
  },

  create(taskId: number, title: string): Promise<ChecklistItem> {
    return request<ChecklistItem>(`/tasks/${taskId}/checklist`, { method: 'POST', body: { title } })
  },

  update(
    taskId: number,
    itemId: number,
    payload: UpdateChecklistItemPayload,
  ): Promise<ChecklistItem> {
    return request<ChecklistItem>(`/tasks/${taskId}/checklist/${itemId}`, {
      method: 'PATCH',
      body: payload,
    })
  },

  remove(taskId: number, itemId: number): Promise<void> {
    return request<void>(`/tasks/${taskId}/checklist/${itemId}`, { method: 'DELETE' })
  },
}
