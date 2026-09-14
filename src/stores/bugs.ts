import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { bugsApi } from '../api/tasks'
import { ApiError, errorMessage } from '../api/client'
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

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    unavailable.value = false

    try {
      const response = await bugsApi.list({ limit: PAGE_LIMIT })
      items.value = response.items
      total.value = response.total
      loaded.value = true

      // Открытый баг мог уйти из перечня — например, его успел взять
      // кто-то другой. Тогда карточка закрывается: показывать отчёт,
      // которого больше нет в списке, нечестно.
      if (selectedId.value !== null && !response.items.some((bug) => bug.id === selectedId.value)) {
        selectedId.value = null
      }
    } catch (err) {
      error.value = errorMessage(err)
      unavailable.value = err instanceof ApiError && err.isUnavailable
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
   * Помечает перечень устаревшим, не трогая показанное.
   *
   * Нужно, когда состав свободных багов изменился где-то ещё — баг
   * отвязали от задачи, и он вернулся в перечень. Перечитывать его
   * сразу незачем: страница может быть закрыта, а вот следующий заход
   * на неё должен показать уже новый состав, а не то, что осталось
   * с прошлого раза.
   */
  function invalidate(): void {
    loaded.value = false
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
    ensureLoaded,
    invalidate,
    forget,
    select,
    clearError,
  }
})
