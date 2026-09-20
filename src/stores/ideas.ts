import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { ideaCommentsApi, ideasApi } from '../api/ideas'
import { errorMessage } from '../api/client'
import { IdeaEvents, getSocket } from '../api/socket'
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

/**
 * Сравнение идей в том же порядке, что задаёт сервер:
 * невыполненные сверху, внутри — свежие первыми.
 *
 * Повторяет `done ASC, created_at DESC, id DESC` из репозитория.
 * Второй и третий ключи нужны не меньше первого: без даты идеи с
 * одинаковой отметкой встали бы как придётся, а без id — зависели бы
 * от устойчивости сортировки.
 */
function compareIdeas(a: Idea, b: Idea): number {
  if (a.done !== b.done) return a.done ? 1 : -1

  const diff = (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
  if (diff !== 0) return diff

  return b.id - a.id
}

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

  /**
   * Кладёт идею в список или обновляет существующую.
   *
   * Отметка «сделано» меняет место идеи: сервер держит невыполненные
   * сверху. Обновление на месте оставляло бы закрытую идею среди
   * открытых до следующей загрузки — и список противоречил бы и
   * серверу, и фильтру «Не сделано».
   */
  function upsert(idea: Idea): void {
    const index = items.value.findIndex((item) => item.id === idea.id)
    if (index === -1) {
      items.value = insertSorted(items.value, idea)
      total.value += 1
      return
    }

    // Пересортировка всего списка дешевле поиска нового индекса
    // вручную: копилка невелика и уже упорядочена.
    // Пересортировка всего списка дешевле поиска нового индекса
    // вручную: копилка невелика и уже упорядочена.
    const moved = items.value[index].done !== idea.done
    items.value[index] = idea
    if (moved) {
      items.value = [...items.value].sort(compareIdeas)
    }
  }

  /** Вставляет идею на её место в уже упорядоченном списке. */
  function insertSorted(list: Idea[], idea: Idea): Idea[] {
    const at = list.findIndex((item) => compareIdeas(idea, item) < 0)
    if (at === -1) return [...list, idea]
    return [...list.slice(0, at), idea, ...list.slice(at)]
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
   * Подписывается на изменения идей по сокету.
   *
   * Копилку правят из нескольких окон сразу, а её состав виден бейджем
   * в меню с любого экрана: без подписки число держалось бы неверным
   * до следующего захода в раздел.
   *
   * Вешается на тот же сокет, что и задачи, — после connect, иначе
   * подписываться было бы не на что. Комната общая: идею никому не
   * назначают, и делить поток по получателям незачем.
   */
  function subscribe(): void {
    const socket = getSocket()
    if (!socket) return

    // Обе правки приносят идею целиком — upsert разберётся, новая она
    // или уже известная.
    for (const event of [IdeaEvents.Created, IdeaEvents.Updated]) {
      socket.on(event, (idea: Idea) => upsert(idea))
    }

    socket.on(IdeaEvents.Deleted, (idea: Idea) => remove(idea.id))

    // Реплики меняют счётчик на карточке, а открытое обсуждение —
    // ещё и свой список. Сервер шлёт саму реплику, но пересчитывать
    // по ней нечего: число реплик приходит только со списком, поэтому
    // счётчик правим на месте.
    socket.on(IdeaEvents.CommentAdded, (comment: IdeaComment) => {
      applyCommentDelta(comment.ideaId, 1)
      if (selectedId.value !== comment.ideaId) return
      if (comments.value.some((item) => item.id === comment.id)) return
      comments.value = [...comments.value, comment]
    })

    socket.on(IdeaEvents.CommentUpdated, (comment: IdeaComment) => {
      if (selectedId.value !== comment.ideaId) return
      const index = comments.value.findIndex((item) => item.id === comment.id)
      if (index !== -1) {
        comments.value[index] = comment
      }
    })

    socket.on(IdeaEvents.CommentDeleted, (comment: IdeaComment) => {
      applyCommentDelta(comment.ideaId, -1)
      if (selectedId.value !== comment.ideaId) return
      comments.value = comments.value.filter((item) => item.id !== comment.id)
    })
  }

  /**
   * Сдвигает счётчик реплик идеи.
   *
   * Событие приносит одну реплику, а не новое число: пересчитать его
   * можно только по открытому обсуждению, которого у закрытой карточки
   * нет. Поэтому счётчик двигаем на единицу — и не ниже нуля, чтобы
   * задвоившееся событие не увело его в минус.
   */
  function applyCommentDelta(ideaId: number, delta: number): void {
    const index = items.value.findIndex((item) => item.id === ideaId)
    if (index === -1) return

    const current = items.value[index]
    items.value[index] = {
      ...current,
      commentCount: Math.max(0, current.commentCount + delta),
    }
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
    subscribe,
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
