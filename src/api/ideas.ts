import { request } from './client'
import type {
  CreateIdeaPayload,
  Idea,
  IdeaComment,
  IdeaCommentListResponse,
  IdeaFilters,
  IdeaListResponse,
  UpdateIdeaPayload,
} from '../types/idea'

export const ideasApi = {
  list(filters: IdeaFilters = {}): Promise<IdeaListResponse> {
    return request<IdeaListResponse>('/ideas', { query: { ...filters } })
  },

  get(id: number): Promise<Idea> {
    return request<Idea>(`/ideas/${id}`)
  },

  create(payload: CreateIdeaPayload): Promise<Idea> {
    return request<Idea>('/ideas', { method: 'POST', body: payload })
  },

  update(id: number, payload: UpdateIdeaPayload): Promise<Idea> {
    return request<Idea>(`/ideas/${id}`, { method: 'PATCH', body: payload })
  },

  /**
   * Отметка выполнения. Отдельный маршрут, а не поле в update: это
   * единственное действие, доступное всем, кому открыта запись, тогда
   * как текст правит только автор.
   */
  setDone(id: number, done: boolean): Promise<Idea> {
    return request<Idea>(`/ideas/${id}/done`, { method: 'PUT', body: { done } })
  },

  remove(id: number): Promise<void> {
    return request<void>(`/ideas/${id}`, { method: 'DELETE' })
  },
}

/** Обсуждение живёт вложенным в идею: без неё оно не существует. */
export const ideaCommentsApi = {
  list(ideaId: number): Promise<IdeaCommentListResponse> {
    return request<IdeaCommentListResponse>(`/ideas/${ideaId}/comments`)
  },

  create(ideaId: number, body: string): Promise<IdeaComment> {
    return request<IdeaComment>(`/ideas/${ideaId}/comments`, {
      method: 'POST',
      body: { body },
    })
  },

  update(ideaId: number, commentId: number, body: string): Promise<IdeaComment> {
    return request<IdeaComment>(`/ideas/${ideaId}/comments/${commentId}`, {
      method: 'PATCH',
      body: { body },
    })
  },

  remove(ideaId: number, commentId: number): Promise<void> {
    return request<void>(`/ideas/${ideaId}/comments/${commentId}`, { method: 'DELETE' })
  },
}
