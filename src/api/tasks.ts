import { request } from './client'
import type {
  CreateTaskPayload,
  Task,
  TaskFilters,
  TaskListResponse,
  TaskStatus,
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
