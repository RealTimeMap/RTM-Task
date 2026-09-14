import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { ideaCommentsApi, ideasApi } from '../api/ideas'
import { errorMessage } from '../api/client'
import type {
  CreateIdeaPayload,
  Idea,
  IdeaComment,
  UpdateIdeaPayload,
} from '../types/idea'

/**
 * Копилка идей.
 *
 * Отдельный стор, а не часть tasks: идея не участвует ни в доске, ни в
 * фильтрах задач, не приходит по сокету и не имеет статуса. Общий стор
 * заставил бы делить loading и error — и загрузка идей гасила бы доску.
 */

/** Что показывать в списке. */
export type IdeaScope = 'all' | 'open' | 'done'

export const useIdeasStore = defineStore('ideas', () => {
  const items = ref<Idea[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Перечень уже читали: повторный заход на страницу не ходит в сеть. */
  const loaded = ref(false)

  const query = ref('')
  const scope = ref<IdeaScope>('all')

  /** Идея, открытая в карточке. */
  const selectedId = ref<number | null>(null)

  /** Обсуждение открытой идеи. Держим только его: список целиком не нужен. */
  const comments = ref<IdeaComment[]>([])
  const commentsLoading = ref(false)
  const commentsError = ref<string | null>(null)

  const selected = computed(
    () => items.value.find((idea) => idea.id === selectedId.value) ?? null,
  )

  const openCount = computed(() => items.value.filter((idea) => !idea.done).length)
  const doneCount = computed(() => items.value.filter((idea) => idea.done).length)

  /**
   * Идеи после поиска и отбора по состоянию.
   *
   * Фильтруется на клиенте: копилка невелика, и мгновенный отклик
   * важнее точности пагинации. Порядок задаёт сервер — невыполненные
   * сверху, внутри свежие первыми.
   */
  const visible = computed(() => {
    const search = query.value.trim().toLowerCase()

    return items.value.filter((idea) => {
      if (scope.value === 'open' && idea.done) return false
      if (scope.value === 'done' && !idea.done) return false
      if (!search) return true

      return (
        idea.title.toLowerCase().includes(search) ||
        String(idea.id).includes(search) ||
        (idea.description ?? '').toLowerCase().includes(search)
      )
    })
  })

  /** Кладёт идею в список или обновляет существующую. */
  function upsert(idea: Idea): void {
    const index = items.value.findIndex((item) => item.id === idea.id)
    if (index === -1) {
      // Новая идея встаёт наверх: список открывают, чтобы увидеть
      // свежее, а серверный порядок — невыполненные сверху по убыванию
      // даты — ставит её туда же.
      items.value = [idea, ...items.value]
      total.value += 1
      return
    }

    items.value[index] = idea
  }

  function remove(id: number): void {
    const index = items.value.findIndex((item) => item.id === id)
    if (index === -1) return

    items.value.splice(index, 1)
    total.value = Math.max(0, total.value - 1)
    if (selectedId.value === id) {
      selectedId.value = null
      comments.value = []
    }
  }

  async function load(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      // Забираем всё: отбор по состоянию идёт на клиенте, чтобы
      // переключение «сделанные / несделанные» было мгновенным.
      const response = await ideasApi.list({ limit: 200 })
      items.value = response.items
      total.value = response.total
      loaded.value = true

      // Открытую идею могли удалить — тогда карточка закрывается.
      if (selectedId.value !== null && !response.items.some((i) => i.id === selectedId.value)) {
        selectedId.value = null
        comments.value = []
      }
    } catch (err) {
      error.value = errorMessage(err)
    } finally {
      loading.value = false
    }
  }

  /** Грузит перечень, если его ещё не читали. */
  async function ensureLoaded(): Promise<void> {
    if (loaded.value || loading.value) return
    await load()
  }

  /**
   * Обёртка над мутирующим вызовом: ошибка показывается пользователю,
   * а результат сразу кладётся в стор.
   */
  async function mutate(action: () => Promise<Idea>): Promise<Idea | null> {
    error.value = null
    try {
      const idea = await action()
      upsert(idea)
      return idea
    } catch (err) {
      error.value = errorMessage(err)
      return null
    }
  }

  async function create(payload: CreateIdeaPayload): Promise<Idea | null> {
    return mutate(() => ideasApi.create(payload))
  }

  async function update(id: number, payload: UpdateIdeaPayload): Promise<Idea | null> {
    return mutate(() => ideasApi.update(id, payload))
  }

  async function setDone(id: number, done: boolean): Promise<Idea | null> {
    return mutate(() => ideasApi.setDone(id, done))
  }

  /** Переключает отметку выполнения на противоположную. */
  async function toggleDone(id: number): Promise<Idea | null> {
    const idea = items.value.find((item) => item.id === id)
    if (!idea) return null
    return setDone(id, !idea.done)
  }

  async function removeIdea(id: number): Promise<boolean> {
    error.value = null
    try {
      await ideasApi.remove(id)
      remove(id)
      return true
    } catch (err) {
      error.value = errorMessage(err)
      return false
    }
  }

  /** Открывает идею и подтягивает её обсуждение. */
  async function select(id: number | null): Promise<void> {
    selectedId.value = id
    comments.value = []
    commentsError.value = null

    if (id === null) return
    await loadComments(id)
  }

  async function loadComments(ideaId: number): Promise<void> {
    commentsLoading.value = true
    commentsError.value = null

    try {
      const response = await ideaCommentsApi.list(ideaId)
      // Пока грузили, могли открыть другую идею — чужой ответ не наш.
      if (selectedId.value !== ideaId) return
      comments.value = response.items
    } catch (err) {
      if (selectedId.value === ideaId) {
        commentsError.value = errorMessage(err)
      }
    } finally {
      commentsLoading.value = false
    }
  }

  /**
   * Обновляет счётчик реплик на карточке.
   *
   * Сервер присылает его только со списком и чтением идеи, а число
   * меняется от каждой реплики: без этого счётчик на карточке
   * расходился бы с обсуждением до следующей загрузки.
   */
  function applyCommentCount(ideaId: number, count: number): void {
    const index = items.value.findIndex((item) => item.id === ideaId)
    if (index === -1) return
    if (items.value[index].commentCount === count) return

    items.value[index] = { ...items.value[index], commentCount: count }
  }

  async function addComment(ideaId: number, body: string): Promise<IdeaComment | null> {
    commentsError.value = null
    try {
      const comment = await ideaCommentsApi.create(ideaId, body)
      comments.value = [...comments.value, comment]
      applyCommentCount(ideaId, comments.value.length)
      return comment
    } catch (err) {
      commentsError.value = errorMessage(err)
      return null
    }
  }

  async function updateComment(
    ideaId: number,
    commentId: number,
    body: string,
  ): Promise<IdeaComment | null> {
    commentsError.value = null
    try {
      const comment = await ideaCommentsApi.update(ideaId, commentId, body)
      const index = comments.value.findIndex((item) => item.id === commentId)
      if (index !== -1) {
        comments.value[index] = comment
      }
      return comment
    } catch (err) {
      commentsError.value = errorMessage(err)
      return null
    }
  }

  async function removeComment(ideaId: number, commentId: number): Promise<boolean> {
    commentsError.value = null
    try {
      await ideaCommentsApi.remove(ideaId, commentId)
      comments.value = comments.value.filter((item) => item.id !== commentId)
      applyCommentCount(ideaId, comments.value.length)
      return true
    } catch (err) {
      commentsError.value = errorMessage(err)
      return false
    }
  }

  function clearError(): void {
    error.value = null
  }

  return {
    items,
    total,
    loading,
    error,
    loaded,
    query,
    scope,
    selectedId,
    selected,
    visible,
    openCount,
    doneCount,
    comments,
    commentsLoading,
    commentsError,
    load,
    ensureLoaded,
    create,
    update,
    setDone,
    toggleDone,
    removeIdea,
    select,
    addComment,
    updateComment,
    removeComment,
    clearError,
  }
})
