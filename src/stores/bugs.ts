import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { bugsApi } from '../api/tasks'
import { ApiError, errorMessage } from '../api/client'
import { BugsChangedEvent, getSocket } from '../api/socket'
import type { Bug, BugTag } from '../types/task'

/**
 * Перечень багов feedback-service — то, из чего рождаются задачи типа
 * «баг».
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

export const useBugsStore = defineStore('bugs', () => {
  const items = ref<Bug[]>([])
  const total = ref(0)
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

    try {
      const response = await bugsApi.list({ limit: PAGE_LIMIT })
      items.value = response.items
      total.value = response.total
      loaded.value = true

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
        !response.items.some((bug) => bug.id === selectedId.value)
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
    const index = items.value.findIndex((bug) => bug.id === bugId)
    if (index === -1) return

    items.value.splice(index, 1)
    total.value = Math.max(0, total.value - 1)
    if (selectedId.value === bugId) {
      selectedId.value = null
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
    items,
    total,
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
    select,
    clearError,
  }
})
