import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { checklistApi, commentsApi } from '../api/tasks'
import { errorMessage } from '../api/client'
import { TaskEvents, getSocket } from '../api/socket'
import { useTasksStore } from './tasks'
import type { ChecklistItem, Comment } from '../types/task'

/**
 * Обсуждение и чек-лист открытой задачи.
 *
 * Отдельный стор, а не поля в tasks: списки грузятся только для той
 * задачи, которую сейчас смотрят, и держать их рядом с доской значило бы
 * тянуть содержимое всех карточек ради одной открытой.
 */
export const useDiscussionStore = defineStore('discussion', () => {
  /** Задача, для которой загружены списки. */
  const taskId = ref<number | null>(null)

  const comments = ref<Comment[]>([])
  const checklist = ref<ChecklistItem[]>([])

  const loading = ref(false)
  const error = ref<string | null>(null)

  const tasks = useTasksStore()

  const doneCount = computed(() => checklist.value.filter((item) => item.done).length)
  const progress = computed(() =>
    checklist.value.length === 0 ? 0 : doneCount.value / checklist.value.length,
  )

  /** Кладёт запись в список или обновляет существующую. */
  function upsert<T extends { id: number }>(list: T[], entry: T, sort?: (a: T, b: T) => number): T[] {
    const index = list.findIndex((item) => item.id === entry.id)
    const next = index === -1 ? [...list, entry] : list.map((item, i) => (i === index ? entry : item))
    return sort ? [...next].sort(sort) : next
  }

  const byPosition = (a: ChecklistItem, b: ChecklistItem): number =>
    a.position - b.position || a.id - b.id

  /**
   * Переносит счётчики в карточку задачи.
   *
   * Задача при изменении обсуждения не меняется и своей версии не
   * поднимает, поэтому обычное событие задачи сюда не приходит — сводку
   * на доске обновляем сами.
   */
  function syncSummary(): void {
    // Пока списки не загрузились, синхронизировать нечего: пустые
    // массивы означают «ещё не знаем», а не «записей нет», и запись
    // нулей погасила бы счётчики на карточке до конца загрузки.
    if (taskId.value === null || loading.value) return

    tasks.applySummary(taskId.value, {
      checklistTotal: checklist.value.length,
      checklistDone: doneCount.value,
      commentCount: comments.value.length,
    })
  }

  /**
   * Загружает обсуждение и чек-лист задачи.
   *
   * Списки грузятся параллельно и заменяются целиком: расхождение с
   * сервером после серии realtime-событий разрешается перечитыванием.
   */
  async function open(id: number): Promise<void> {
    if (taskId.value === id && !loading.value) {
      // Та же задача уже открыта — обновляем молча, без мигания списков.
      void refresh(id)
      return
    }

    taskId.value = id
    comments.value = []
    checklist.value = []
    await refresh(id)
  }

  async function refresh(id: number): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const [commentList, checklistList] = await Promise.all([
        commentsApi.list(id),
        checklistApi.list(id),
      ])

      // Пока грузили, пользователь мог открыть другую задачу —
      // чужой ответ применять нельзя.
      if (taskId.value !== id) return

      comments.value = commentList.items
      checklist.value = [...checklistList.items].sort(byPosition)
    } catch (err) {
      if (taskId.value === id) {
        error.value = errorMessage(err)
      }
    } finally {
      loading.value = false
    }
  }

  function close(): void {
    taskId.value = null
    comments.value = []
    checklist.value = []
    error.value = null
  }

  async function addComment(body: string): Promise<Comment | null> {
    const id = taskId.value
    if (id === null) return null

    error.value = null
    try {
      const comment = await commentsApi.create(id, body)
      comments.value = upsert(comments.value, comment)
      return comment
    } catch (err) {
      error.value = errorMessage(err)
      return null
    }
  }

  async function editComment(commentId: number, body: string): Promise<Comment | null> {
    const id = taskId.value
    if (id === null) return null

    error.value = null
    try {
      const comment = await commentsApi.update(id, commentId, body)
      comments.value = upsert(comments.value, comment)
      return comment
    } catch (err) {
      error.value = errorMessage(err)
      return null
    }
  }

  async function removeComment(commentId: number): Promise<boolean> {
    const id = taskId.value
    if (id === null) return false

    error.value = null
    try {
      await commentsApi.remove(id, commentId)
      comments.value = comments.value.filter((item) => item.id !== commentId)
      return true
    } catch (err) {
      error.value = errorMessage(err)
      return false
    }
  }

  async function addItem(title: string): Promise<ChecklistItem | null> {
    const id = taskId.value
    if (id === null) return null

    error.value = null
    try {
      const item = await checklistApi.create(id, title)
      checklist.value = upsert(checklist.value, item, byPosition)
      return item
    } catch (err) {
      error.value = errorMessage(err)
      return null
    }
  }

  /**
   * Переключает отметку пункта.
   *
   * Отметка ставится оптимистично: щелчок по чек-боксу должен отзываться
   * мгновенно. При отказе сервера возвращаем прежнее состояние.
   */
  async function toggleItem(itemId: number, done: boolean): Promise<ChecklistItem | null> {
    const id = taskId.value
    if (id === null) return null

    const previous = checklist.value.find((item) => item.id === itemId)
    if (previous) {
      checklist.value = upsert(checklist.value, { ...previous, done }, byPosition)
    }

    error.value = null
    try {
      const item = await checklistApi.update(id, itemId, { done })
      checklist.value = upsert(checklist.value, item, byPosition)
      return item
    } catch (err) {
      error.value = errorMessage(err)
      if (previous) {
        checklist.value = upsert(checklist.value, previous, byPosition)
      }
      return null
    }
  }

  async function renameItem(itemId: number, title: string): Promise<ChecklistItem | null> {
    const id = taskId.value
    if (id === null) return null

    error.value = null
    try {
      const item = await checklistApi.update(id, itemId, { title })
      checklist.value = upsert(checklist.value, item, byPosition)
      return item
    } catch (err) {
      error.value = errorMessage(err)
      return null
    }
  }

  async function removeItem(itemId: number): Promise<boolean> {
    const id = taskId.value
    if (id === null) return false

    error.value = null
    try {
      await checklistApi.remove(id, itemId)
      checklist.value = checklist.value.filter((item) => item.id !== itemId)
      return true
    } catch (err) {
      error.value = errorMessage(err)
      return false
    }
  }

  /**
   * Подписывается на realtime-изменения обсуждения.
   *
   * События приходят по всем задачам сразу, поэтому чужие отбрасываются:
   * держать в памяти обсуждения всей доски незачем.
   */
  function subscribe(): void {
    const socket = getSocket()
    if (!socket) return

    socket.on(TaskEvents.CommentAdded, (comment: Comment) => {
      if (comment.taskId !== taskId.value) return
      comments.value = upsert(comments.value, comment)
    })

    socket.on(TaskEvents.CommentUpdated, (comment: Comment) => {
      if (comment.taskId !== taskId.value) return
      comments.value = upsert(comments.value, comment)
    })

    socket.on(TaskEvents.CommentDeleted, (comment: Comment) => {
      if (comment.taskId !== taskId.value) return
      comments.value = comments.value.filter((item) => item.id !== comment.id)
    })

    socket.on(TaskEvents.ChecklistAdded, (item: ChecklistItem) => {
      if (item.taskId !== taskId.value) return
      checklist.value = upsert(checklist.value, item, byPosition)
    })

    socket.on(TaskEvents.ChecklistUpdated, (item: ChecklistItem) => {
      if (item.taskId !== taskId.value) return
      checklist.value = upsert(checklist.value, item, byPosition)
    })

    socket.on(TaskEvents.ChecklistDeleted, (item: ChecklistItem) => {
      if (item.taskId !== taskId.value) return
      checklist.value = checklist.value.filter((entry) => entry.id !== item.id)
    })
  }

  // Сводка на карточке следует за списками сама: вызывать синхронизацию
  // из каждой мутации значило бы девять раз повторить одну строку и
  // однажды её забыть.
  watch([comments, checklist], syncSummary, { deep: true })

  function clearError(): void {
    error.value = null
  }

  return {
    taskId,
    comments,
    checklist,
    loading,
    error,
    doneCount,
    progress,
    open,
    refresh,
    close,
    addComment,
    editComment,
    removeComment,
    addItem,
    toggleItem,
    renameItem,
    removeItem,
    subscribe,
    clearError,
  }
})
