import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { bugsApi } from '../api/tasks'
import { ApiError, errorMessage } from '../api/client'
import { BugsChangedEvent, getSocket } from '../api/socket'
import type { Bug, BugQueue, BugRejectReason, BugTag } from '../types/task'
import { useToastStore } from './toast'

/**
 * Перечень багов feedback-service — то, из чего рождаются задачи типа
 * «баг».
 *
 * Перечней три, по состояниям проверки: отчёты, ждущие проверки,
 * подтверждённые баги, которые можно брать в работу, и отклонённые.
 * Большая часть отчётов не подтверждается, поэтому между «пришёл отчёт»
 * и «взяли в задачу» стоит проверка разработчиком.
 *
 * Отдельный стор, а не часть tasks: баг живёт в чужом сервисе, не
 * приходит по сокету и не участвует ни в доске, ни в фильтрах задач.
 * Сваленные в один стор, они делили бы loading и error — и сбой
 * feedback-service гасил бы доску задач.
 */

/** Категории в порядке показа. Значения принадлежат feedback-service. */
export const BUG_TAG_ORDER: BugTag[] = ['logic', 'ui', 'feature']

/**
 * Как часто перечитывать перечень в фоне.
 *
 * Свои действия — взяли баг, отвязали — приходят по сокету сразу. Но
 * заводят баги в feedback-service, и о новом отчёте он нам не
 * сообщает: узнать о нём можно только спросив. Две минуты — предел,
 * на который бейдж в меню вправе отстать от действительности.
 */
const REFRESH_INTERVAL_MS = 2 * 60 * 1000

/**
 * Сколько багов запрашивать.
 *
 * Верхнюю границу держит сервер (maxLimit в feedback-клиенте), здесь
 * просто «столько, сколько поместится на странице за один запрос»:
 * пагинации у перечня нет, а разбирают баги пачками.
 */
const PAGE_LIMIT = 200

export type BugSortField = 'createdAt' | 'tag'

/**
 * Перечни, которые перечитываются всегда.
 *
 * Очередь проверки и готовые к работе — то, что требует внимания: их
 * счётчики стоят на вкладках и в бейдже меню, поэтому держать их
 * свежими нужно, даже когда смотрят на другую вкладку. Отклонённые
 * нужны редко — они грузятся, только когда их открыли.
 */
const ALWAYS_LOADED: BugQueue[] = ['new', 'confirmed']

function emptyLists(): Record<BugQueue, Bug[]> {
  return { new: [], confirmed: [], rejected: [] }
}

export const useBugsStore = defineStore('bugs', () => {
  const lists = ref<Record<BugQueue, Bug[]>>(emptyLists())

  /**
   * Открытый перечень. По умолчанию — очередь проверки: с неё разбор и
   * начинается, а готовые к работе без неё не пополнятся.
   */
  const queue = ref<BugQueue>('new')

  /** Отклонённые уже грузили — значит, их нужно держать свежими. */
  const rejectedLoaded = ref(false)

  /** Баги открытого перечня. */
  const items = computed(() => lists.value[queue.value])
  const total = computed(() => items.value.length)

  /** Сколько багов в каждом перечне — для вкладок. */
  const queueCounts = computed<Record<BugQueue, number>>(() => ({
    new: lists.value.new.length,
    confirmed: lists.value.confirmed.length,
    rejected: lists.value.rejected.length,
  }))

  /**
   * Сколько багов ждут внимания — для бейджа в меню: непроверенные
   * отчёты и подтверждённые, которые ещё никто не взял. Отклонённые
   * внимания не ждут.
   */
  const attentionCount = computed(() => lists.value.new.length + lists.value.confirmed.length)

  /** Решение по багу, которое прямо сейчас уходит на сервер. */
  const reviewing = ref<number | null>(null)

  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Сбой из-за недоступности feedback-service, а не из-за запроса.
   * Такой отказ временный, и повтор имеет смысл — поэтому он отделён
   * от обычной ошибки.
   */
  const unavailable = ref(false)

  /** Перечень уже грузили: повторный заход на страницу не ходит в сеть. */
  const loaded = ref(false)

  const query = ref('')
  const tagFilter = ref<BugTag | 'all'>('all')

  /**
   * Порядок перечня. Сортируется на клиенте, в отличие от задач:
   * сервер отдаёт весь перечень одним ответом, страниц нет — и
   * упорядочить его здесь честнее, чем гонять запрос.
   */
  const sortField = ref<BugSortField>('createdAt')

  /** Баг, открытый в карточке подробностей. */
  const selectedId = ref<number | null>(null)

  const selected = computed(
    () => items.value.find((bug) => bug.id === selectedId.value) ?? null,
  )

  /** Счётчики по категориям — для фильтра. Считаются до фильтра по ней. */
  const tagCounts = computed(() => {
    const counts: Record<string, number> = { all: items.value.length }
    for (const bug of items.value) {
      counts[bug.tag] = (counts[bug.tag] ?? 0) + 1
    }
    return counts
  })

  /** Баги после поиска, фильтра по категории и сортировки. */
  const visible = computed(() => {
    const search = query.value.trim().toLowerCase()

    const filtered = items.value.filter((bug) => {
      if (tagFilter.value !== 'all' && bug.tag !== tagFilter.value) return false
      if (!search) return true

      return (
        bug.title.toLowerCase().includes(search) ||
        String(bug.id).includes(search) ||
        (bug.description ?? '').toLowerCase().includes(search) ||
        (bug.build ?? '').toLowerCase().includes(search) ||
        (bug.platform ?? '').toLowerCase().includes(search)
      )
    })

    // Свежие отчёты интереснее старых — дата идёт по убыванию. Внутри
    // одинаковых значений порядок задаёт id: без второго ключа он
    // зависел бы от устойчивости сортировки.
    return [...filtered].sort((a, b) => {
      if (sortField.value === 'tag') {
        const diff = BUG_TAG_ORDER.indexOf(a.tag) - BUG_TAG_ORDER.indexOf(b.tag)
        if (diff !== 0) return diff
      } else {
        const diff = (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
        if (diff !== 0) return diff
      }
      return b.id - a.id
    })
  })

  /**
   * Перечитывает перечень.
   *
   * `silent` — обновление по часам, а не по просьбе человека: оно не
   * зажигает индикатор загрузки и не гасит уже показанную ошибку.
   * Мигать «загружаем» поверх спокойно лежащего списка каждые две
   * минуты значило бы сообщать о работе, которой никто не просил.
   */
  async function load(silent = false): Promise<void> {
    if (!silent) {
      loading.value = true
      error.value = null
      unavailable.value = false
    }

    const queues: BugQueue[] =
      queue.value === 'rejected' || rejectedLoaded.value
        ? [...ALWAYS_LOADED, 'rejected']
        : ALWAYS_LOADED

    try {
      const responses = await Promise.all(
        queues.map((status) => bugsApi.list({ status, limit: PAGE_LIMIT })),
      )
      const next = { ...lists.value }
      queues.forEach((status, index) => {
        next[status] = responses[index].items
      })
      lists.value = next
      if (queues.includes('rejected')) rejectedLoaded.value = true
      loaded.value = true

      const current = next[queue.value]

      // Открытый баг мог уйти из перечня — например, его успел взять
      // кто-то другой. Тогда карточка закрывается: показывать отчёт,
      // которого больше нет в списке, нечестно.
      //
      // Но только когда список перечитали по просьбе: захлопнуть
      // открытую карточку посреди чтения, просто потому что подошёл
      // такт часов, — это отнять у человека то, на что он смотрит.
      // Такой баг всё равно уже не взять, и сервер это подтвердит.
      if (
        !silent &&
        selectedId.value !== null &&
        !current.some((bug) => bug.id === selectedId.value)
      ) {
        selectedId.value = null
      }
      // Тихое обновление, которое дошло, снимает прежнюю жалобу:
      // сервис отвечает — держать на экране старую ошибку незачем.
      error.value = null
      unavailable.value = false
    } catch (err) {
      // Сорвавшееся фоновое обновление молчит: перечень на экране
      // остался прежним, и подменять его баннером из-за одного
      // неудачного такта не за что. Ошибку покажет то обновление, о
      // котором попросили.
      if (!silent) {
        error.value = errorMessage(err)
        unavailable.value = err instanceof ApiError && err.isUnavailable
      }
    } finally {
      if (!silent) {
        loading.value = false
      }
    }
  }

  /** Обновление по часам: без индикатора и без баннера при сбое. */
  function refresh(): Promise<void> {
    return load(true)
  }

  /** Грузит перечень, если его ещё не читали. */
  async function ensureLoaded(): Promise<void> {
    if (loaded.value || loading.value) return
    await load()
  }

  /**
   * Убирает баг из перечня, не ходя в сеть.
   *
   * Нужно сразу после того, как баг взяли в работу: сервер уже отметил
   * его занятым, и следующая загрузка его не вернёт — но ждать её,
   * оставляя взятый баг в списке свободных, значило бы предлагать
   * взять его второй раз.
   */
  function forget(bugId: number): void {
    let found = false
    for (const status of Object.keys(lists.value) as BugQueue[]) {
      const list = lists.value[status]
      const index = list.findIndex((bug) => bug.id === bugId)
      if (index !== -1) {
        list.splice(index, 1)
        found = true
      }
    }
    if (found && selectedId.value === bugId) {
      selectedId.value = null
    }
  }

  /**
   * Кладёт баг в перечень, соответствующий его новому состоянию.
   *
   * Сервер вернул баг после решения — ждать перечитывания, оставляя
   * подтверждённый отчёт в очереди проверки, значило бы предлагать
   * проверить его второй раз.
   */
  function place(bug: Bug): void {
    for (const status of Object.keys(lists.value) as BugQueue[]) {
      lists.value[status] = lists.value[status].filter((item) => item.id !== bug.id)
    }

    const target = bug.status as BugQueue
    if (target in lists.value) {
      lists.value[target] = [bug, ...lists.value[target]]
    }

    // Карточка закрывается: баг ушёл из открытого перечня, и следующий
    // отчёт в очереди важнее того, по которому решение уже принято.
    if (selectedId.value === bug.id && target !== queue.value) {
      selectedId.value = null
    }
  }

  /**
   * Выполняет решение по багу.
   *
   * Отказ сервера показывается уведомлением, а не баннером: перечень
   * при этом не сломан, не удалось одно действие. Чаще всего это
   * значит, что баг успел поменяться — например, его уже взяли в
   * задачу, — поэтому перечень перечитывается.
   */
  async function review(bugId: number, action: () => Promise<Bug>): Promise<Bug | null> {
    if (reviewing.value !== null) return null

    reviewing.value = bugId
    try {
      const updated = await action()
      place(updated)
      return updated
    } catch (err) {
      useToastStore().show(errorMessage(err))
      if (err instanceof ApiError && (err.status === 409 || err.isNotFound)) {
        void refresh()
      }
      return null
    } finally {
      reviewing.value = null
    }
  }

  function confirm(bugId: number, comment?: string): Promise<Bug | null> {
    return review(bugId, () => bugsApi.confirm(bugId, comment?.trim() || undefined))
  }

  function reject(bugId: number, reason: BugRejectReason, comment?: string): Promise<Bug | null> {
    return review(bugId, () => bugsApi.reject(bugId, reason, comment?.trim() || undefined))
  }

  function reopen(bugId: number): Promise<Bug | null> {
    return review(bugId, () => bugsApi.reopen(bugId))
  }

  /**
   * Открывает перечень. Отклонённые при первом открытии догружаются:
   * держать их в памяти заранее незачем — к ним возвращаются редко.
   */
  function setQueue(next: BugQueue): void {
    if (queue.value === next) return
    queue.value = next
    selectedId.value = null
    if (next === 'rejected' && !rejectedLoaded.value) {
      void load()
    }
  }

  /**
   * Подписывается на изменения перечня и заводит фоновое обновление.
   *
   * Две половины одного: сокет приносит то, что сделала команда, —
   * мгновенно и точно; часы ловят то, что случилось в
   * feedback-service, о чём нам не расскажут. Ни одна из них сама по
   * себе перечень в порядке не удержит.
   */
  function subscribe(): void {
    const socket = getSocket()
    socket?.on(BugsChangedEvent, () => void refresh())

    startRefreshTimer()
  }

  /**
   * Снимает часы обновления.
   *
   * Слушателя сокета убирать не нужно — он уходит вместе с самим
   * соединением, — а вот таймер живёт своей жизнью и без остановки
   * продолжил бы ходить в сеть после выхода из системы.
   */
  function unsubscribe(): void {
    stopRefreshTimer()
  }

  let refreshTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Заводит часы, которые тикают только у открытой вкладки.
   *
   * В скрытой вкладке обновлять нечего: ни бейджа, ни списка не
   * видно, а браузер всё равно придушит её таймеры. Зато при
   * возвращении перечитываем сразу — вернувшийся к вкладке должен
   * увидеть свежее сейчас, а не через две минуты.
   */
  function startRefreshTimer(): void {
    if (refreshTimer !== null) return

    refreshTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void refresh()
    }, REFRESH_INTERVAL_MS)

    document.addEventListener('visibilitychange', onVisibility)
  }

  function stopRefreshTimer(): void {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
    document.removeEventListener('visibilitychange', onVisibility)
  }

  function onVisibility(): void {
    // Пока вкладка была скрыта, перечень мог устареть — не ждём такта.
    if (document.visibilityState === 'visible') {
      void refresh()
    }
  }

  function select(id: number | null): void {
    selectedId.value = id
  }

  function clearError(): void {
    error.value = null
    unavailable.value = false
  }

  return {
    lists,
    items,
    total,
    queue,
    queueCounts,
    attentionCount,
    reviewing,
    loading,
    error,
    unavailable,
    loaded,
    query,
    tagFilter,
    sortField,
    selectedId,
    selected,
    tagCounts,
    visible,
    load,
    refresh,
    ensureLoaded,
    subscribe,
    unsubscribe,
    forget,
    place,
    confirm,
    reject,
    reopen,
    setQueue,
    select,
    clearError,
  }
})
