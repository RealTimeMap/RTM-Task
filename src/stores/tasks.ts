import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { tasksApi } from '../api/tasks'
import { errorMessage } from '../api/client'
import {
  TaskEvents,
  connectSocket,
  disconnectSocket,
  type ConnectionState,
} from '../api/socket'
import type {
  CreateTaskPayload,
  Task,
  TaskFilters,
  TaskStatus,
  TaskType,
  TaskPriority,
  UpdateTaskPayload,
} from '../types/task'
import { STATUS_ORDER } from '../types/task'

export type ViewMode = 'board' | 'list'
export type ScopeMode = 'mine' | 'all'

/** Колонки доски: завершённые в доску не попадают — для них есть список. */
export const BOARD_COLUMNS: TaskStatus[] = ['new', 'working', 'review']

export const useTasksStore = defineStore('tasks', () => {
  const items = ref<Task[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const view = ref<ViewMode>('board')
  const scope = ref<ScopeMode>('mine')
  const query = ref('')
  const typeFilter = ref<TaskType | 'all'>('all')
  const statusFilter = ref<TaskStatus | 'all'>('all')

  const selectedId = ref<number | null>(null)
  const connection = ref<ConnectionState>('idle')

  /** Задача, которую сейчас перетаскивают по доске. */
  const draggingId = ref<number | null>(null)

  /** Идентификатор сотрудника, от чьего имени работает стор. */
  let viewerId: number | null = null

  const selected = computed(
    () => items.value.find((task) => task.id === selectedId.value) ?? null,
  )

  /**
   * Задачи после локальной фильтрации.
   *
   * Поиск и фильтры применяются на клиенте: набор задач команды невелик,
   * а мгновенный отклик важнее точности пагинации. Серверные фильтры
   * используются при загрузке (scope), клиентские — поверх неё.
   */
  const visible = computed(() => {
    const search = query.value.trim().toLowerCase()

    return items.value.filter((task) => {
      if (typeFilter.value !== 'all' && task.type !== typeFilter.value) return false
      if (statusFilter.value !== 'all' && task.status !== statusFilter.value) return false
      if (!search) return true

      return (
        task.title.toLowerCase().includes(search) ||
        String(task.id).includes(search) ||
        (task.description ?? '').toLowerCase().includes(search)
      )
    })
  })

  /** Задачи, разложенные по колонкам доски. */
  const columns = computed(() =>
    BOARD_COLUMNS.map((status) => ({
      status,
      tasks: visible.value.filter((task) => task.status === status),
    })),
  )

  /** Счётчики по типам — для сайдбара. Считаются до фильтра по типу. */
  const typeCounts = computed(() => {
    const counts: Record<string, number> = { all: items.value.length }
    for (const task of items.value) {
      counts[task.type] = (counts[task.type] ?? 0) + 1
    }
    return counts
  })

  const completedCount = computed(
    () => items.value.filter((task) => task.status === 'complete').length,
  )

  /** Кладёт задачу в список или обновляет существующую. */
  function upsert(task: Task): void {
    const index = items.value.findIndex((item) => item.id === task.id)
    if (index === -1) {
      items.value = [task, ...items.value]
      total.value += 1
      return
    }

    // Событие может прийти после того, как мы уже применили более свежую
    // версию локально — старую запись не откатываем.
    if (items.value[index].version > task.version) return
    items.value[index] = task
  }

  function remove(id: number): void {
    const index = items.value.findIndex((item) => item.id === id)
    if (index === -1) return

    items.value.splice(index, 1)
    total.value = Math.max(0, total.value - 1)
    if (selectedId.value === id) {
      selectedId.value = null
    }
  }

  /**
   * Решает, относится ли задача к текущей области видимости.
   * В режиме «Мои» чужие задачи из realtime-потока игнорируются.
   */
  function inScope(task: Task): boolean {
    if (scope.value === 'all') return true
    return task.assigneeId === viewerId || task.creatorId === viewerId
  }

  function baseFilters(): TaskFilters {
    const filters: TaskFilters = { limit: 100 }
    if (scope.value === 'mine' && viewerId !== null) {
      filters.assigneeId = viewerId
    }
    return filters
  }

  async function load(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await tasksApi.list(baseFilters())
      items.value = response.items
      total.value = response.total
    } catch (err) {
      error.value = errorMessage(err)
    } finally {
      loading.value = false
    }
  }

  async function setScope(next: ScopeMode): Promise<void> {
    if (scope.value === next) return
    scope.value = next
    await load()
  }

  /**
   * Поднимает сокет и подписывается на изменения задач.
   * viewerId нужен только для режима «Мои»: личность на сервере
   * определяется заголовками шлюза, а не этим значением.
   */
  function connect(staffId: number): void {
    viewerId = staffId
    connection.value = 'connecting'

    const socket = connectSocket()

    socket.on('connect', () => {
      connection.value = 'connected'
    })

    socket.on('disconnect', () => {
      connection.value = 'connecting'
    })

    socket.on('connect_error', () => {
      connection.value = 'error'
    })

    socket.on('error', (payload: unknown) => {
      connection.value = 'error'
      const body = payload as { error?: { message?: string } }
      error.value = body?.error?.message ?? 'Сокет отклонил подключение'
    })

    // Все события изменения приносят актуальную задачу целиком.
    for (const event of [
      TaskEvents.Created,
      TaskEvents.Updated,
      TaskEvents.StatusChanged,
      TaskEvents.Reworked,
      TaskEvents.Assigned,
      TaskEvents.Unassigned,
    ]) {
      socket.on(event, (task: Task) => {
        if (inScope(task)) {
          upsert(task)
        } else {
          // Задачу переназначили на другого — из «Моих» она уходит.
          remove(task.id)
        }
      })
    }

    socket.on(TaskEvents.Deleted, (task: Task) => remove(task.id))
  }

  function disconnect(): void {
    disconnectSocket()
    connection.value = 'idle'
    viewerId = null
  }

  /**
   * Обёртка над мутирующим вызовом: ошибка показывается пользователю,
   * а результат сразу кладётся в стор, не дожидаясь push-события.
   */
  async function mutate(action: () => Promise<Task>): Promise<Task | null> {
    error.value = null
    try {
      const task = await action()
      upsert(task)
      return task
    } catch (err) {
      error.value = errorMessage(err)
      return null
    }
  }

  async function create(payload: CreateTaskPayload): Promise<Task | null> {
    return mutate(() => tasksApi.create(payload))
  }

  async function update(id: number, payload: UpdateTaskPayload): Promise<Task | null> {
    return mutate(() => tasksApi.update(id, payload))
  }

  async function changeStatus(id: number, status: TaskStatus): Promise<Task | null> {
    return mutate(() => tasksApi.changeStatus(id, status))
  }

  /**
   * Переводит задачу в статус, попутно взяв её на себя, если она ничья
   * и уходит в работу.
   *
   * Сервер не пускает задачу в `working` без исполнителя, поэтому
   * назначение идёт первым отдельным запросом — иначе смена статуса
   * вернула бы отказ. Если назначить не удалось (например, нет прав),
   * статус не трогаем: пользователь увидит причину отказа.
   */
  async function changeStatusAsOwner(
    id: number,
    status: TaskStatus,
    staffId: number,
  ): Promise<Task | null> {
    const task = items.value.find((item) => item.id === id)
    const needsAssignee = status === 'working' && task?.assigneeId == null

    if (needsAssignee) {
      const assigned = await assign(id, staffId)
      if (!assigned) return null
    }

    return changeStatus(id, status)
  }

  /**
   * Возвращает завершённую задачу в работу с замечанием.
   *
   * Отдельное действие, а не changeStatus: сервер не пускает complete
   * обратно по таблице переходов, потому что возврат требует описания
   * того, что нужно доделать.
   */
  async function sendToRework(id: number, note: string): Promise<Task | null> {
    return mutate(() => tasksApi.sendToRework(id, note))
  }

  async function setPriority(id: number, priority: TaskPriority): Promise<Task | null> {
    return mutate(() => tasksApi.update(id, { priority }))
  }

  async function assign(id: number, assigneeId: number): Promise<Task | null> {
    return mutate(() => tasksApi.assign(id, assigneeId))
  }

  async function unassign(id: number): Promise<Task | null> {
    return mutate(() => tasksApi.unassign(id))
  }

  /** Сдвигает задачу по цепочке статусов на шаг вперёд или назад. */
  async function moveByStep(id: number, direction: 1 | -1): Promise<Task | null> {
    const task = items.value.find((item) => item.id === id)
    if (!task) return null

    const target = STATUS_ORDER[STATUS_ORDER.indexOf(task.status) + direction]
    if (!target) return null

    return changeStatus(id, target)
  }

  async function remove_(id: number): Promise<boolean> {
    error.value = null
    try {
      await tasksApi.remove(id)
      remove(id)
      return true
    } catch (err) {
      error.value = errorMessage(err)
      return false
    }
  }

  function select(id: number | null): void {
    selectedId.value = id
  }

  const dragging = computed(
    () => items.value.find((task) => task.id === draggingId.value) ?? null,
  )

  function startDrag(id: number): void {
    draggingId.value = id
  }

  function endDrag(): void {
    draggingId.value = null
  }

  function clearError(): void {
    error.value = null
  }

  return {
    items,
    total,
    loading,
    error,
    view,
    scope,
    query,
    typeFilter,
    statusFilter,
    selectedId,
    selected,
    connection,
    draggingId,
    dragging,
    startDrag,
    endDrag,
    visible,
    columns,
    typeCounts,
    completedCount,
    load,
    setScope,
    connect,
    disconnect,
    create,
    update,
    changeStatus,
    changeStatusAsOwner,
    sendToRework,
    setPriority,
    assign,
    unassign,
    moveByStep,
    removeTask: remove_,
    select,
    clearError,
  }
})
