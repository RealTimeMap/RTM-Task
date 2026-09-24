<script setup lang="ts">
/**
 * Страница багов — перечень отчётов из feedback-service, из которых
 * заводят работу.
 *
 * Отчёт проходит проверку, прежде чем по нему заводят задачу: большая
 * часть присланного не воспроизводится, и задачи по таким отчётам были
 * бы пустой работой. Поэтому перечней три — «На проверке», «Готовы к
 * работе» и «Отклонённые», — и взять в работу можно только
 * подтверждённый баг.
 *
 * Отдельный экран, а не список внутри формы создания: багов приходит
 * больше, чем задач, и прежде чем взять один в работу, их разбирают —
 * читают, сравнивают, отсеивают. В выпадающем перечне на пол-экрана
 * такой разбор невозможен.
 *
 * Полного отчёта здесь нет и быть не может: логи отдаются только по
 * привязанному багу (GET /tasks/:id/bug). Поэтому страница показывает
 * всё, что есть в перечне, а журнал открывается уже в задаче — после
 * того как баг взяли.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import { BUG_TAG_ORDER, useBugsStore } from '../stores/bugs'
import { useSessionStore } from '../stores/session'
import { useTasksStore } from '../stores/tasks'
import { useToastStore } from '../stores/toast'
import {
  BUG_QUEUE_TITLES,
  BUG_REJECT_REASON_TITLES,
  BUG_TAG_TITLES,
  PRIORITY_ORDER,
  PROJECT_TITLES,
  bugRejectReasonTitle,
  bugStatusTitle,
  isNarrowScreen,
  priorityTone,
  shortDate,
  shortTime,
  taskCode,
} from '../lib/presentation'
import {
  BUG_QUEUE_ORDER,
  BUG_REJECT_REASONS,
  DEFAULT_PROJECT,
  MAX_BUG_REVIEW_COMMENT,
  PROJECT_ORDER,
  Priority,
  bugReviewActions,
  canTakeBug,
  type Bug,
  type BugQueue,
  type BugRejectReason,
  type BugTag,
  type TaskPriority,
  type TaskProject,
} from '../types/task'

const bugs = useBugsStore()
const tasks = useTasksStore()
const session = useSessionStore()
const toast = useToastStore()

const {
  visible,
  selected,
  loading,
  error,
  unavailable,
  query,
  tagFilter,
  sortField,
  tagCounts,
  queue,
  queueCounts,
  reviewing,
} = storeToRefs(bugs)
const { permissions, staff } = storeToRefs(session)

onMounted(() => {
  void bugs.ensureLoaded()
})

const queueOptions = computed(() =>
  BUG_QUEUE_ORDER.map((key: BugQueue) => ({
    key,
    label: BUG_QUEUE_TITLES[key],
    count: queueCounts.value[key],
  })),
)

/** Что сказать, когда в перечне пусто. У каждого перечня своё «пусто». */
const EMPTY_NOTES: Record<BugQueue, string> = {
  new: 'Непроверенных отчётов нет — очередь разобрана.',
  confirmed: 'Подтверждённых багов нет. Новые появятся здесь после проверки.',
  rejected: 'Отклонённых отчётов нет.',
}

const tagOptions = computed(() => {
  const keys: (BugTag | 'all')[] = ['all', ...BUG_TAG_ORDER]
  return keys.map((key) => ({
    key,
    label: key === 'all' ? 'Все' : BUG_TAG_TITLES[key],
    count: tagCounts.value[key] ?? 0,
  }))
})

/**
 * Параметры будущей задачи.
 *
 * Их спрашиваем прямо здесь, а не в форме создания: всё остальное —
 * название, описание, тип — берётся из самого бага, и гонять человека
 * через полную форму ради двух переключателей незачем.
 */
const project = ref<TaskProject>(DEFAULT_PROJECT)
const priority = ref<TaskPriority>(Priority.High)

/** Баг, по которому прямо сейчас создаётся задача. */
const taking = ref<number | null>(null)

/**
 * Узкий ли экран.
 *
 * На широком карточка отчёта стоит рядом со списком и ничего не
 * закрывает, поэтому повторный щелчок по багу её закрывает. На
 * телефоне она разворачивается поверх списка — там закрытие щелчком
 * по той же карточке недостижимо, её закрывают кнопкой.
 */
const narrow = ref(isNarrowScreen())

function pick(bug: Bug): void {
  bugs.select(bugs.selectedId === bug.id && !narrow.value ? null : bug.id)
}

/** Строки отчёта, которые есть что показать. */
const facts = computed(() => {
  const bug = selected.value
  if (!bug) return []

  const rows = [
    { label: 'Категория', value: BUG_TAG_TITLES[bug.tag] ?? bug.tag },
    { label: 'Платформа', value: bug.platform ?? '' },
    { label: 'Сборка', value: bug.build ?? '' },
    { label: 'Состояние', value: bug.status ? bugStatusTitle(bug.status) : '' },
    { label: 'Отправлен', value: `${shortDate(bug.createdAt)}, ${shortTime(bug.createdAt)}` },
    { label: 'Журнал', value: bug.hasLogs ? 'Приложен' : 'Не приложен' },
    { label: 'Проверен', value: bug.reviewedAt ? shortDate(bug.reviewedAt) : '' },
    { label: 'Причина', value: bug.rejectReason ? bugRejectReasonTitle(bug.rejectReason) : '' },
  ]

  // Пустые строки не показываем: «Сборка: —» ничего не сообщает,
  // а место занимает.
  return rows.filter((row) => row.value !== '')
})

/** Какие решения доступны открытому багу. */
const actions = computed(() =>
  selected.value ? bugReviewActions(selected.value.status) : null,
)

/**
 * Черновик решения: пояснение и причина отклонения.
 *
 * Одно поле пояснения на оба решения: подтверждая, пишут, как баг
 * воспроизвёлся, отклоняя — почему не вышло. Две формы с одним и тем
 * же полем только путали бы.
 */
const reviewComment = ref('')
const rejectReason = ref<BugRejectReason>('not_reproducible')

/**
 * Открыта ли форма отклонения.
 *
 * Отклонение — не соседняя кнопка, а отдельный шаг: ему нужна причина,
 * и промахнуться мимо «Подтвердить» по отчёту, над которым только что
 * сидели, слишком дорого.
 */
const rejecting = ref(false)

const commentTooLong = computed(() => reviewComment.value.length > MAX_BUG_REVIEW_COMMENT)

// Черновик принадлежит конкретному отчёту: пояснение к одному багу,
// оставшееся в поле при переходе к другому, ушло бы не туда.
watch(
  () => selected.value?.id,
  () => {
    reviewComment.value = ''
    rejectReason.value = 'not_reproducible'
    rejecting.value = false
  },
)

async function confirmBug(bug: Bug): Promise<void> {
  if (commentTooLong.value) return
  const updated = await bugs.confirm(bug.id, reviewComment.value)
  if (updated) toast.show(`Баг #${bug.id} подтверждён — он в «Готовы к работе»`)
}

async function rejectBug(bug: Bug): Promise<void> {
  if (commentTooLong.value) return
  const updated = await bugs.reject(bug.id, rejectReason.value, reviewComment.value)
  if (updated) toast.show(`Баг #${bug.id} отклонён: ${BUG_REJECT_REASON_TITLES[rejectReason.value]}`)
}

async function reopenBug(bug: Bug): Promise<void> {
  const updated = await bugs.reopen(bug.id)
  if (updated) toast.show(`Баг #${bug.id} возвращён на проверку`)
}

/**
 * Заводит задачу по багу и открывает её.
 *
 * Название и описание переносятся из отчёта: переписывать их руками
 * пришлось бы на каждом баге, а расхождение между задачей и отчётом
 * потом стоит дороже, чем неудобная формулировка от пользователя.
 * Исполнителем становится тот, кто взял баг: «взять в работу» — это и
 * значит взять его на себя.
 */
async function take(bug: Bug): Promise<void> {
  // Сервер отклонит неподтверждённый баг — не отправляем заведомо
  // неудачный запрос.
  if (taking.value !== null || !canTakeBug(bug)) return

  taking.value = bug.id
  try {
    const created = await tasks.create({
      title: bug.title,
      description: taskDescription(bug),
      type: 'bug',
      priority: priority.value,
      project: project.value,
      // Только на себя: назначать чужими руками отсюда нельзя — для
      // этого есть сама задача, где виден весь состав.
      assigneeId: staff.value?.id ?? null,
      bugId: bug.id,
    })

    if (!created) return

    // Сервер отметил баг занятым — из перечня свободных он ушёл.
    bugs.forget(bug.id)
    toast.show(`${taskCode(created.id)}: баг #${bug.id} взят в работу`)

    // Дальше человек идёт в задачу: там и журнал, и чек-лист, и
    // обсуждение. Оставлять его в перечне значило бы прятать то,
    // ради чего он сюда пришёл.
    tasks.view = 'board'
    tasks.select(created.id)
  } finally {
    taking.value = null
  }
}

/**
 * Описание задачи: текст отчёта и пояснение проверявшего.
 *
 * Пояснение — чаще всего шаги, которыми баг воспроизвёлся, — и есть то,
 * с чего начнёт исполнитель. Держать его только в отчёте значило бы
 * прятать самое полезное за лишним щелчком.
 */
function taskDescription(bug: Bug): string | undefined {
  const report = bug.description?.trim() ?? ''
  const review = bug.reviewComment?.trim() ?? ''
  if (!review) return report || undefined

  const note = `**Проверка:** ${review}`
  return report ? `${report}\n\n${note}` : note
}
</script>

<template>
  <div class="tk-fade bugs">
    <!-- Перечни по состоянию проверки. Счётчики видны на всех вкладках
         сразу: очередь проверки растёт, пока смотрят на готовые. -->
    <div class="tk-scroll queues" role="tablist" aria-label="Перечень багов">
      <button
        v-for="option in queueOptions"
        :key="option.key"
        role="tab"
        class="tk-tap tk-plain queue"
        :class="[`queue--${option.key}`, { 'queue--active': queue === option.key }]"
        :aria-selected="queue === option.key"
        @click="bugs.setQueue(option.key)"
      >
        {{ option.label }}
        <span v-if="option.key !== 'rejected' || option.count" class="queue__count">
          {{ option.count }}
        </span>
      </button>
    </div>

    <!-- Панель разбора: поиск, категории и порядок. Живёт здесь, а не
         в шапке: шапка обслуживает задачи, и её поиск ищет по ним. -->
    <div class="bugs__bar">
      <label class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="rgba(233,233,237,.5)" stroke-width="1.8">
          <circle cx="11" cy="11" r="6.4" />
          <path d="M15.8 15.8L20 20" />
        </svg>
        <input
          v-model="query"
          type="search"
          placeholder="Поиск по отчётам, #42…"
          aria-label="Поиск багов"
        />
      </label>

      <div class="tk-scroll tags" role="group" aria-label="Фильтр по категории">
        <button
          v-for="option in tagOptions"
          :key="option.key"
          class="tk-tap tk-plain tag"
          :class="{ 'tag--active': tagFilter === option.key }"
          :aria-pressed="tagFilter === option.key"
          @click="bugs.tagFilter = option.key"
        >
          {{ option.label }}
          <span class="tag__count">{{ option.count }}</span>
        </button>
      </div>

      <div class="bugs__spacer" />

      <label class="sortbar">
        <span class="sortbar__label">Порядок</span>
        <select v-model="sortField" class="sortbar__select">
          <option value="createdAt">Сначала свежие</option>
          <option value="tag">По категории</option>
        </select>
      </label>

      <button
        class="tk-tap tk-plain refresh"
        :disabled="loading"
        title="Перечитать перечень"
        @click="bugs.load()"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <path d="M20 12a8 8 0 11-2.3-5.6" />
          <path d="M20 4v4.5h-4.5" />
        </svg>
        <span class="refresh__text">Обновить</span>
      </button>
    </div>

    <p v-if="loading && !visible.length" class="note">Загружаем баги…</p>

    <!-- Сервис недоступен: пользователь ничего не сделал не так,
         и повтор имеет смысл — предупреждение, а не ошибка. -->
    <div v-else-if="unavailable" class="warning">
      <span>{{ error }}</span>
      <button class="tk-tap tk-plain warning__retry" @click="bugs.load()">Повторить</button>
    </div>

    <p v-else-if="error" class="note note--error">{{ error }}</p>

    <p v-else-if="!visible.length && query.trim()" class="note">
      По запросу «{{ query.trim() }}» ничего не нашлось.
    </p>

    <p v-else-if="!visible.length" class="note">{{ EMPTY_NOTES[queue] }}</p>

    <div v-else class="bugs__body">
      <ul class="tk-scroll list">
        <li v-for="bug in visible" :key="bug.id">
          <button
            class="tk-tap tk-plain card"
            :class="{ 'card--active': selected?.id === bug.id }"
            :aria-pressed="selected?.id === bug.id"
            @click="pick(bug)"
          >
            <span class="card__head">
              <span class="card__code">#{{ bug.id }}</span>
              <span class="card__tag" :class="`card__tag--${bug.tag}`">
                {{ BUG_TAG_TITLES[bug.tag] ?? bug.tag }}
              </span>
              <span class="card__spacer" />
              <span v-if="bug.hasLogs" class="card__logs" title="Журнал приложен">ЛОГ</span>
              <span class="card__date">{{ shortDate(bug.createdAt) }}</span>
            </span>

            <span class="card__title">{{ bug.title }}</span>

            <span v-if="bug.description" class="card__desc">{{ bug.description }}</span>

            <span v-if="bug.platform || bug.build" class="card__meta">
              <span v-if="bug.platform">{{ bug.platform }}</span>
              <span v-if="bug.build">сборка {{ bug.build }}</span>
            </span>

            <!-- Итог проверки виден прямо в перечне: отклонённые без
                 причины не разобрать, а пояснение к подтверждённому
                 помогает выбрать, что брать первым. -->
            <span v-if="bug.rejectReason" class="card__review card__review--rejected">
              {{ bugRejectReasonTitle(bug.rejectReason) }}
            </span>
            <span v-else-if="bug.reviewComment" class="card__review">
              {{ bug.reviewComment }}
            </span>
          </button>
        </li>
      </ul>

      <!-- Карточка отчёта: то, ради чего страница и нужна. -->
      <aside v-if="selected" class="tk-rise detail">
        <header class="detail__head">
          <span class="detail__mark">BUG</span>
          <span class="detail__code">#{{ selected.id }}</span>
          <span class="card__spacer" />
          <button class="tk-tap detail__close" title="Закрыть" @click="bugs.select(null)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div class="tk-scroll detail__body">
          <h2 class="detail__title">{{ selected.title }}</h2>

          <!-- Текст от пользователя: разметку не разбираем — это
               свободный текст из формы обратной связи, а не markdown.
               Переносы сохраняем: шаги воспроизведения пишут построчно. -->
          <p v-if="selected.description" class="detail__desc">{{ selected.description }}</p>
          <p v-else class="detail__desc detail__desc--empty">Описание не приложено.</p>

          <dl class="facts">
            <div v-for="row in facts" :key="row.label" class="facts__row">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </div>
          </dl>

          <div
            v-if="selected.reviewComment"
            class="verdict"
            :class="{ 'verdict--rejected': selected.status === 'rejected' }"
          >
            <span class="verdict__label">ПОЯСНЕНИЕ ПРОВЕРКИ</span>
            <p class="verdict__text">{{ selected.reviewComment }}</p>
          </div>

          <!-- Журнал остаётся за привязкой: сервис отдаёт его только по
               багу, который уже ведёт задача. Говорим об этом прямо,
               чтобы значок «ЛОГ» на карточке не выглядел обманом. -->
          <p v-if="selected.hasLogs" class="detail__hint">
            Журнал приложен — он откроется в задаче, когда баг возьмут в работу.
          </p>
        </div>

        <!-- Отклонение — отдельный шаг с причиной. Открывается и из
             очереди проверки, и из готовых к работе: подтверждение тоже
             бывает поспешным. -->
        <footer v-if="permissions.canReviewBugs && rejecting" class="detail__foot">
          <label class="param">
            <span class="param__label">ПРИЧИНА ОТКЛОНЕНИЯ</span>
            <select v-model="rejectReason" class="param__select">
              <option v-for="reason in BUG_REJECT_REASONS" :key="reason" :value="reason">
                {{ BUG_REJECT_REASON_TITLES[reason] }}
              </option>
            </select>
          </label>

          <textarea
            v-model="reviewComment"
            class="comment"
            :class="{ 'comment--error': commentTooLong }"
            rows="2"
            placeholder="Почему отклонён — необязательно"
            aria-label="Пояснение к отклонению"
          />

          <div class="decide">
            <button
              class="tk-tap tk-plain ghost"
              :disabled="reviewing !== null"
              @click="rejecting = false"
            >
              Отмена
            </button>
            <button
              class="tk-tap tk-plain reject"
              :disabled="reviewing !== null || commentTooLong"
              @click="rejectBug(selected)"
            >
              {{ reviewing === selected.id ? 'Отклоняем…' : 'Отклонить' }}
            </button>
          </div>
        </footer>

        <!-- Очередь проверки: главное действие — подтвердить. -->
        <footer
          v-else-if="permissions.canReviewBugs && actions?.confirm"
          class="detail__foot"
        >
          <textarea
            v-model="reviewComment"
            class="comment"
            :class="{ 'comment--error': commentTooLong }"
            rows="2"
            placeholder="Как воспроизвёлся — необязательно, попадёт в задачу"
            aria-label="Пояснение к подтверждению"
          />

          <button
            class="tk-tap tk-plain take"
            :disabled="reviewing !== null || commentTooLong"
            @click="confirmBug(selected)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1">
              <path d="M5 12.6l3.4 3.4L19 5.4" />
            </svg>
            {{ reviewing === selected.id ? 'Подтверждаем…' : 'Подтвердить — воспроизводится' }}
          </button>

          <button
            class="tk-tap tk-plain ghost ghost--danger"
            :disabled="reviewing !== null"
            @click="rejecting = true"
          >
            Отклонить…
          </button>
        </footer>

        <!-- Отклонённый: решение можно только пересмотреть. -->
        <footer
          v-else-if="permissions.canReviewBugs && selected.status === 'rejected'"
          class="detail__foot"
        >
          <button
            class="tk-tap tk-plain ghost"
            :disabled="reviewing !== null"
            @click="reopenBug(selected)"
          >
            {{ reviewing === selected.id ? 'Возвращаем…' : 'Вернуть на проверку' }}
          </button>
          <p class="take__note">Отчёт снова попадёт в очередь проверки.</p>
        </footer>

        <footer v-else-if="permissions.canCreate && canTakeBug(selected)" class="detail__foot">
          <div class="params">
            <label class="param">
              <span class="param__label">ПРОЕКТ</span>
              <select v-model="project" class="param__select">
                <option v-for="value in PROJECT_ORDER" :key="value" :value="value">
                  {{ PROJECT_TITLES[value] }}
                </option>
              </select>
            </label>

            <label class="param">
              <span class="param__label">ПРИОРИТЕТ</span>
              <select v-model="priority" class="param__select">
                <option v-for="value in PRIORITY_ORDER" :key="value" :value="value">
                  {{ priorityTone(value).label }}
                </option>
              </select>
            </label>
          </div>

          <button class="tk-tap tk-plain take" :disabled="taking !== null" @click="take(selected)">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1">
              <path d="M5 12.6l3.4 3.4L19 5.4" />
            </svg>
            {{ taking === selected.id ? 'Создаём задачу…' : 'Взять в работу' }}
          </button>

          <p class="take__note">Задача заведётся на вас с этим багом.</p>

          <div v-if="permissions.canReviewBugs && actions" class="decide">
            <button
              v-if="actions.reopen"
              class="tk-tap tk-plain ghost"
              :disabled="reviewing !== null || taking !== null"
              @click="reopenBug(selected)"
            >
              {{ reviewing === selected.id ? 'Возвращаем…' : 'На повторную проверку' }}
            </button>
            <button
              v-if="actions.reject"
              class="tk-tap tk-plain ghost ghost--danger"
              :disabled="reviewing !== null || taking !== null"
              @click="rejecting = true"
            >
              Отклонить…
            </button>
          </div>
        </footer>

        <!-- Наблюдатель читает отчёты, но не заводит работу: разбор и
             заведение — разные действия, и право на них разное. -->
        <footer v-else class="detail__foot">
          <p class="take__note">Вашей роли недоступны проверка отчётов и заведение задач.</p>
        </footer>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.bugs {
  display: flex;
  flex-direction: column;
  gap: 14px;
  /* Страница занимает высоту области содержимого: список и карточка
     прокручиваются каждый у себя, а не тянут за собой весь экран. */
  height: 100%;
  min-height: 0;
}

.queues {
  display: flex;
  gap: 4px;
  flex: none;
  padding: 3px;
  width: fit-content;
  max-width: 100%;
  overflow-x: auto;
  border-radius: var(--r-md);
  border: 1px solid var(--line-strong);
  background: var(--fill-soft);
}

.queue {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
  flex: none;
  border: 0;
  border-radius: calc(var(--r-md) - 3px);
  background: transparent;
  color: var(--ink-60);
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}

.queue--active {
  background: var(--bg-panel);
  color: var(--ink);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}

.queue__count {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  text-align: center;
  color: var(--ink-45);
  background: var(--fill-hover);
}

/* Очередь проверки — то, что ждёт человека: её счётчик выделен. */
.queue--new .queue__count {
  color: var(--warning-ink);
  background: var(--warning-bg);
}

.queue--confirmed .queue__count {
  color: var(--accent-ink);
  background: var(--accent-bg);
}

.bugs__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  flex-wrap: wrap;
}

.bugs__spacer {
  flex: 1;
}

.search {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--line-strong);
  background: var(--fill-soft);
  min-width: 220px;
}

.search svg {
  width: 15px;
  height: 15px;
  flex: none;
}

.search input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 12.5px;
}

.search input::placeholder {
  color: var(--ink-30);
}

.tags {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
}

.tag {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 11px;
  flex: none;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  background: transparent;
  color: var(--ink-60);
  font-size: 12px;
  font-weight: 600;
}

.tag--active {
  background: var(--danger-bg);
  border-color: rgba(229, 72, 77, 0.3);
  color: var(--danger-ink);
}

.tag__count {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ink-40);
}

.tag--active .tag__count {
  color: inherit;
}

.sortbar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-40);
}

.sortbar__select,
.param__select {
  height: 30px;
  padding: 0 8px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line-strong);
  background: var(--bg-panel);
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}

.refresh {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 11px;
  border-radius: var(--r-md);
  border: 1px solid var(--line-strong);
  background: transparent;
  color: var(--ink-60);
  font-size: 12px;
  font-weight: 600;
}

.refresh svg {
  width: 14px;
  height: 14px;
}

.refresh:disabled {
  opacity: 0.5;
}

.bugs__body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
  align-items: stretch;
}

.list {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0 4px 4px 0;
  list-style: none;
  overflow: auto;
  display: grid;
  /* Карточки сами решают, сколько их помещается в ряд: на широком
     экране разбирать баги сеткой быстрее, чем одной колонкой. */
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  grid-auto-rows: min-content;
  gap: 10px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  height: 100%;
  padding: 13px 14px;
  border-radius: var(--r-lg);
  border: 1px solid var(--line-strong);
  /* Красная кромка слева связывает карточку с типом «баг» — тот же
     язык, что у отчёта в задаче. */
  border-left: 3px solid rgba(229, 72, 77, 0.55);
  background: var(--bg-modal);
  text-align: left;
  color: var(--ink);
}

.card--active {
  border-color: var(--accent-border);
  border-left-color: var(--danger);
  background: var(--accent-bg);
}

.card__head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
}

.card__code {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-70);
}

.card__tag {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 5px;
  text-transform: uppercase;
}

.card__tag--logic {
  color: var(--danger-ink);
  background: var(--danger-bg);
}

.card__tag--ui {
  color: var(--violet-ink);
  background: var(--violet-bg);
}

.card__tag--feature {
  color: var(--cyan-ink);
  background: var(--cyan-bg);
}

.card__spacer {
  flex: 1;
}

.card__logs {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 5px;
  border-radius: 4px;
  color: var(--warning-ink);
  background: var(--warning-bg);
}

.card__date {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ink-40);
  white-space: nowrap;
}

.card__title {
  font-size: 13px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: -0.01em;
  /* Длинный заголовок не растягивает карточку: сетке нужны ряды
     примерно одной высоты, а целиком он читается в отчёте. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card__desc {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--ink-45);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card__meta {
  display: flex;
  gap: 10px;
  margin-top: auto;
  padding-top: 3px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ink-30);
}

.card__review {
  font-size: 11px;
  line-height: 1.4;
  color: var(--ink-45);
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--fill-hover);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card__review--rejected {
  width: fit-content;
  font-weight: 650;
  color: var(--danger-ink);
  background: var(--danger-bg);
}

.verdict {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 11px 12px;
  border-radius: 10px;
  border: 1px solid rgba(61, 220, 151, 0.25);
  background: var(--success-bg);
}

.verdict--rejected {
  border-color: rgba(229, 72, 77, 0.25);
  background: var(--danger-bg);
}

.verdict__label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.09em;
  color: var(--ink-40);
}

.verdict__text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ink-70);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.comment {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 52px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line-strong);
  background: var(--bg-panel);
  color: var(--ink);
  font: inherit;
  font-size: 12.5px;
  line-height: 1.45;
}

.comment::placeholder {
  color: var(--ink-30);
}

.comment--error {
  border-color: var(--danger);
}

.decide {
  display: flex;
  gap: 8px;
}

.decide > * {
  flex: 1;
}

.ghost {
  height: 34px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--line-strong);
  background: transparent;
  color: var(--ink-70);
  font-size: 12.5px;
  font-weight: 600;
}

.ghost--danger {
  color: var(--danger-ink);
  border-color: rgba(229, 72, 77, 0.3);
}

.ghost:disabled,
.reject:disabled {
  opacity: 0.55;
}

.reject {
  height: 34px;
  padding: 0 12px;
  border-radius: 10px;
  border: 0;
  background: var(--danger);
  color: #fff;
  font-size: 12.5px;
  font-weight: 650;
}

.detail {
  flex: none;
  width: clamp(340px, 30vw, 460px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left: 3px solid var(--danger);
  background: var(--bg-modal);
  overflow: hidden;
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.5);
}

.detail__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 13px 13px 12px 16px;
  border-bottom: 1px solid var(--line);
}

.detail__mark {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 3px 6px;
  border-radius: 5px;
  color: var(--danger-ink);
  background: var(--danger-bg);
}

.detail__code {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-70);
}

.detail__close {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ink-40);
}

.detail__close svg {
  width: 15px;
  height: 15px;
}

.detail__close:hover {
  background: var(--fill-hover);
  color: var(--ink);
}

.detail__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail__title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: -0.01em;
}

.detail__desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-70);
  /* Переносы из отчёта сохраняются, длинные ссылки без пробелов
     разрываются, а не распирают окно. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.detail__desc--empty {
  color: var(--ink-30);
  font-style: italic;
}

.facts {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px;
  border-radius: 10px;
  background: var(--fill-hover);
}

.facts__row {
  display: flex;
  gap: 10px;
  font-size: 12px;
}

.facts__row dt {
  flex: none;
  width: 92px;
  color: var(--ink-40);
}

.facts__row dd {
  margin: 0;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.detail__hint {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--warning-bg);
  color: var(--warning-ink);
  font-size: 11.5px;
  line-height: 1.45;
}

.detail__foot {
  flex: none;
  padding: 14px 16px 16px;
  border-top: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.params {
  display: flex;
  gap: 10px;
}

.param {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.param__label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.09em;
  color: var(--ink-40);
}

.param__select {
  width: 100%;
}

.take {
  height: 40px;
  border-radius: 11px;
  border: 0;
  background: var(--accent-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 650;
  color: #fff;
  box-shadow: var(--accent-shadow);
}

.take svg {
  width: 16px;
  height: 16px;
}

.take:disabled {
  opacity: 0.6;
}

.take__note {
  margin: 0;
  text-align: center;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ink-30);
}

.note {
  margin: 0;
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-45);
}

.note--error {
  color: var(--danger-ink);
}

.warning {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 13px;
  border-radius: var(--r-lg);
  background: var(--warning-bg);
  color: var(--warning-ink);
  font-size: 12.5px;
  line-height: 1.45;
}

.warning__retry {
  margin-left: auto;
  flex: none;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  text-decoration: underline;
}

/* Планшет и узкое окно: карточка отчёта не помещается рядом со
   списком — уводим её вниз, ограничив высоту, чтобы список остался
   виден. */
@media (max-width: 1180px) {
  .bugs__body {
    flex-direction: column;
  }

  .detail {
    width: 100%;
    flex: none;
    max-height: 48vh;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    border-top: 3px solid var(--danger);
  }
}

/* Телефон: отчёт — отдельный экран поверх списка. Складывать их в
   столбец здесь нельзя: список занимает весь экран, и карточку под ним
   пришлось бы искать прокруткой. */
@media (max-width: 720px) {
  /*
    Панель раскладывается сеткой, а не переносом flex.

    С flex-wrap полосе категорий приходилось задавать базис в 100%,
    чтобы она занимала свой ряд, — и она же с overflow-x переполняла
    его, выдавливая соседей за край экрана. Сетка задаёт ряды явно:
    поиск, категории, затем порядок с обновлением.
  */
  .bugs__bar {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }

  .search {
    min-width: 0;
    grid-column: 1 / -1;
    height: 38px;
  }

  /* Категории прокручиваются вбок: их больше, чем помещается, а
     переносить их в несколько рядов — отдать фильтрам треть экрана.
     Отрицательные поля вытягивают полосу под края, чтобы обрезанный
     чип был виден наполовину и приглашал прокрутить. */
  .tags {
    grid-column: 1 / -1;
    min-width: 0;
    margin: 0 -12px;
    padding: 0 12px;
    scroll-padding: 0 12px;
  }

  /* Порядок и обновление — один ряд на двоих: по отдельности они
     съедали два ряда ради двух органов управления. */
  .sortbar {
    min-width: 0;
  }

  /* Подпись «Порядок» уходит: рядом с кнопкой обновления она отнимала
     у списка столько ширины, что сам список значений не помещался и
     уезжал за край. Что это за поле, видно по его значению. */
  .sortbar__label {
    display: none;
  }

  .sortbar__select {
    flex: 1;
    min-width: 0;
    /* Без этого select на мобильном раздувается по самому длинному
       значению и выталкивает соседа за край экрана. */
    width: 100%;
  }

  .refresh {
    flex: none;
  }

  /* Подпись кнопки прячется: рядом с полем порядка на неё не остаётся
     места, а значок обновления понятен и без слова. */
  .refresh__text {
    display: none;
  }

  .bugs__spacer {
    display: none;
  }

  .list {
    grid-template-columns: 1fr;
  }

  /*
    Отчёт разворачивается под шапкой приложения, а не поверх неё.

    inset: 0 клал бы его от самого верха окна — и шапка, которая выше
    по контексту наложения, накрывала бы строку с номером бага вместе
    с кнопкой закрытия. С экрана тогда некуда вернуться: закрыть отчёт
    нечем. Отступ сверху равен высоте шапки.
  */
  .detail {
    position: fixed;
    top: var(--app-header-height, 59px);
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 30;
    width: 100%;
    max-height: none;
    border: 0;
    border-top: 3px solid var(--danger);
    border-radius: 0;
  }

  .detail__head {
    padding: 12px max(14px, env(safe-area-inset-right)) 12px
      max(16px, env(safe-area-inset-left));
  }

  .detail__body {
    padding: 16px max(14px, env(safe-area-inset-right)) 16px
      max(14px, env(safe-area-inset-left));
  }

  .detail__foot {
    padding-bottom: max(16px, env(safe-area-inset-bottom));
  }

  /* Цели под палец: 36px — минимум, при котором в кнопку попадаешь. */
  .detail__close {
    width: 38px;
    height: 38px;
  }

  .tag,
  .refresh,
  .queue {
    height: 36px;
  }

  /* Вкладки перечней растягиваются на ширину экрана: три коротких
     подписи помещаются, а пустое место справа выглядело бы обрывом. */
  .queues {
    width: auto;
  }

  .queue {
    flex: 1;
    justify-content: center;
    padding: 0 8px;
  }

  .ghost,
  .reject {
    height: 42px;
  }

  /*
    Параметры остаются в ряд, но подписи уходят внутрь полей.

    Столбцом футер занимал почти половину экрана — на два выпадающих
    списка, которые обычно не трогают: проект и приоритет угаданы по
    умолчанию. Отчёт важнее, поэтому место отдаётся ему.
  */
  .params {
    gap: 8px;
  }

  /* Подписи остаются — без них два одинаковых списка не различить, —
     но становятся мельче и прижимаются к своему полю. */
  .param__label {
    font-size: 9px;
  }

  .param {
    gap: 3px;
  }

  .param__select {
    height: 38px;
  }

  .detail__foot {
    gap: 8px;
    padding: 10px 14px max(12px, env(safe-area-inset-bottom));
  }

  .take {
    height: 46px;
  }

  /* Подпись под кнопкой на телефоне лишняя: то же самое сказано на
     самой кнопке, а ряд текста стоит места, нужного отчёту. */
  .take__note {
    display: none;
  }
}

@media (pointer: coarse) {
  .detail__close {
    width: 38px;
    height: 38px;
  }

  .tag,
  .refresh {
    height: 36px;
  }
}
</style>
