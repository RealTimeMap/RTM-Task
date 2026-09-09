<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import AvatarBadge from './ui/AvatarBadge.vue'
import MarkdownEditor from './ui/MarkdownEditor.vue'
import { useSessionStore } from '../stores/session'
import { useTasksStore } from '../stores/tasks'
import { useToastStore } from '../stores/toast'
import {
  BUG_TAG_TITLES,
  PRIORITY_ORDER,
  PROJECT_TITLES,
  PROJECT_TONES,
  TYPE_ORDER,
  TYPE_TITLES,
  TYPE_TONES,
  priorityTone,
  shortDate,
  taskCode,
} from '../lib/presentation'
import { bugsApi } from '../api/tasks'
import { ApiError, errorMessage } from '../api/client'
import {
  DEFAULT_PROJECT,
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_TITLE,
  PROJECT_ORDER,
  Priority,
  type Bug,
  type TaskPriority,
  type TaskProject,
  type TaskType,
} from '../types/task'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const tasks = useTasksStore()
const session = useSessionStore()
const toast = useToastStore()

const { members, permissions, staff } = storeToRefs(session)

const title = ref('')
const description = ref('')
const type = ref<TaskType>('bug')
const priority = ref<TaskPriority>(Priority.Medium)
const project = ref<TaskProject>(DEFAULT_PROJECT)
const assigneeId = ref<number | null>(null)
const submitting = ref(false)

/**
 * Перечень открытых багов и выбранный из них.
 *
 * Грузится лениво — только когда выбран тип «баг»: в остальных случаях
 * список не нужен, а запрос уходил бы на каждое открытие формы.
 */
const bugs = ref<Bug[]>([])
const bugId = ref<number | null>(null)
const bugsLoading = ref(false)
const bugsError = ref<string | null>(null)

/**
 * Перечень не загрузился из-за недоступности сервиса, а не из-за
 * запроса. Такой отказ временный: показываем предупреждение с повтором,
 * а не красную ошибку — пользователь ничего не сделал не так.
 */
const bugsUnavailable = ref(false)

/** Баги загружены хотя бы раз — чтобы не грузить их повторно. */
let bugsLoaded = false

async function loadBugs(): Promise<void> {
  if (bugsLoaded || bugsLoading.value) return

  bugsLoading.value = true
  bugsError.value = null
  bugsUnavailable.value = false
  try {
    const response = await bugsApi.list()
    bugs.value = response.items
    bugsLoaded = true
  } catch (err) {
    bugsError.value = errorMessage(err)
    bugsUnavailable.value = err instanceof ApiError && err.isUnavailable
  } finally {
    bugsLoading.value = false
  }
}

/** Повторяет загрузку перечня после сбоя сервиса. */
async function retryBugs(): Promise<void> {
  bugsLoaded = false
  await loadBugs()
}

/** Выбранный баг. Повторный щелчок по нему снимает выбор. */
function pickBug(id: number): void {
  bugId.value = bugId.value === id ? null : id
}

const selectedBug = computed(() => bugs.value.find((item) => item.id === bugId.value) ?? null)

/**
 * Заготовка чек-листа. Хранится как список строк, а не как сущности:
 * пункты ещё не существуют — задачи, к которой их привязать, пока нет.
 */
const checklist = ref<string[]>([])
const checklistDraft = ref('')
const checklistInput = ref<HTMLInputElement | null>(null)

const checklistFull = computed(() => checklist.value.length >= MAX_CHECKLIST_ITEMS)

/**
 * Добавляет пункт в заготовку.
 *
 * Повторы отбрасываются: две одинаковые строки в плане работ — почти
 * всегда случайное двойное нажатие, а не осознанный дубль.
 */
async function addChecklistItem(): Promise<void> {
  const title = checklistDraft.value.trim()
  if (!title || checklistFull.value) return
  if (checklist.value.includes(title)) {
    checklistDraft.value = ''
    return
  }

  checklist.value = [...checklist.value, title]
  checklistDraft.value = ''
  // Фокус остаётся в поле: пункты обычно вводят подряд.
  await nextTick()
  checklistInput.value?.focus()
}

function removeChecklistItem(index: number): void {
  checklist.value = checklist.value.filter((_, i) => i !== index)
}

const typeOptions: TaskType[] = TYPE_ORDER
const projectOptions: TaskProject[] = PROJECT_ORDER

/**
 * Перечень багов подтягивается, когда выбирают тип «баг», и очищается
 * при уходе с него: сервер принимает привязку только вместе с этим
 * типом, и оставленный выбор ушёл бы в заведомо отклонённый запрос.
 */
watch(type, (value) => {
  if (value === 'bug') {
    void loadBugs()
    return
  }
  bugId.value = null
})

/** Разработчик может назначить задачу только на себя. */
const assignableMembers = computed(() => {
  if (permissions.value.canAssignAnyone) return members.value
  return staff.value ? [staff.value] : []
})

const canSubmit = computed(() => title.value.trim().length >= 3 && !submitting.value)

// Каждое открытие начинается с чистой формы.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    title.value = ''
    description.value = ''
    type.value = 'feature'
    priority.value = Priority.Medium
    project.value = DEFAULT_PROJECT
    assigneeId.value = null
    bugId.value = null
    checklist.value = []
    checklistDraft.value = ''
  },
)

/** Пункты чек-листа вместе с недобавленным черновиком. */
function pendingChecklist(): string[] | undefined {
  const draft = checklistDraft.value.trim()
  const items =
    draft && !checklist.value.includes(draft) && !checklistFull.value
      ? [...checklist.value, draft]
      : checklist.value

  return items.length > 0 ? items : undefined
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return

  submitting.value = true
  try {
    const created = await tasks.create({
      title: title.value.trim(),
      description: description.value.trim() || undefined,
      type: type.value,
      priority: priority.value,
      project: project.value,
      assigneeId: assigneeId.value,
      // Баг уходит только с типом «баг»: с другим сервер его отклонит.
      bugId: type.value === 'bug' ? bugId.value : null,
      // Незакоммиченный ввод тоже уходит: пользователь набрал пункт и
      // нажал «Создать», не нажав «плюс» — терять его было бы обидно.
      checklist: pendingChecklist(),
    })

    if (created) {
      toast.show(`${taskCode(created.id)} создана`)
      emit('close')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="open" class="overlay" @click="emit('close')" @keydown.esc="emit('close')">
    <form class="tk-rise modal" @click.stop @submit.prevent="submit">
      <header class="modal__head">
        <h2 class="modal__title">Новая задача</h2>
      </header>

      <!-- Две колонки: слева текст задачи, справа её параметры.
           На узком экране схлопываются в одну. -->
      <div class="modal__columns">
        <div class="modal__column">
          <label class="field">
            <span class="field__label">НАЗВАНИЕ</span>
            <input
              v-model="title"
              class="field__input"
              placeholder="Например: маркер не обновляется после смены фильтра"
              autofocus
            />
          </label>

          <div class="field field--grow">
            <span class="field__label">ОПИСАНИЕ</span>
            <MarkdownEditor
              v-model="description"
              :rows="8"
              placeholder="Шаги воспроизведения или контекст. Поддерживается разметка: **жирный**, `код`, списки"
            />
          </div>

          <!-- Чек-лист прямо в форме: план работ обычно известен в момент
               заведения задачи, и заводить пункты отдельными запросами
               после создания — лишний круг. -->
          <div class="field">
            <span class="field__label">ЧЕК-ЛИСТ</span>

            <ul v-if="checklist.length" class="plan">
              <li v-for="(item, index) in checklist" :key="`${index}-${item}`" class="plan__item">
                <span class="plan__marker" />
                <span class="plan__title">{{ item }}</span>
                <button
                  type="button"
                  class="tk-tap tk-plain plan__remove"
                  title="Убрать пункт"
                  @click="removeChecklistItem(index)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            </ul>

            <div class="plan__add">
              <input
                ref="checklistInput"
                v-model="checklistDraft"
                class="field__input"
                :maxlength="MAX_CHECKLIST_TITLE"
                :disabled="checklistFull"
                :placeholder="
                  checklistFull
                    ? `Предел — ${MAX_CHECKLIST_ITEMS} пунктов`
                    : 'Что нужно сделать. Enter — добавить'
                "
                @keydown.enter.prevent="addChecklistItem"
              />
              <button
                type="button"
                class="tk-tap tk-plain plan__submit"
                :disabled="checklistFull || !checklistDraft.trim()"
                @click="addChecklistItem"
              >
                Добавить
              </button>
            </div>
          </div>

          <!-- Перечень открытых багов: показывается только для задач
               типа «баг», потому что привязать баг можно лишь к ним.
               Завершённые и уже занятые баги сюда не попадают - их
               отсеивает feedback-service. -->
          <div v-if="type === 'bug'" class="field">
            <span class="field__label">
              БАГ ИЗ FEEDBACK
              <span v-if="selectedBug" class="field__hint">— выбран #{{ selectedBug.id }}</span>
            </span>

            <p v-if="bugsLoading" class="bugs__note">Загружаем перечень…</p>

            <!-- Сервис недоступен: задачу всё равно можно завести, просто
                 без привязки. Поэтому предупреждение, а не ошибка. -->
            <div v-else-if="bugsUnavailable" class="bugs__warning">
              <span>{{ bugsError }} Задачу можно завести и без привязки.</span>
              <button type="button" class="tk-tap tk-plain bugs__retry" @click="retryBugs">
                Повторить
              </button>
            </div>

            <p v-else-if="bugsError" class="bugs__note bugs__note--error">{{ bugsError }}</p>
            <p v-else-if="!bugs.length" class="bugs__note">
              Открытых багов нет — задачу можно завести и без привязки.
            </p>

            <ul v-else class="bugs">
              <li v-for="bug in bugs" :key="bug.id">
                <button
                  type="button"
                  class="tk-tap tk-plain bug"
                  :class="{ 'bug--active': bugId === bug.id }"
                  @click="pickBug(bug.id)"
                >
                  <span class="bug__head">
                    <span class="bug__code">#{{ bug.id }}</span>
                    <span class="bug__tag">{{ BUG_TAG_TITLES[bug.tag] ?? bug.tag }}</span>
                    <span class="bug__date">{{ shortDate(bug.createdAt) }}</span>
                  </span>
                  <span class="bug__title">{{ bug.title }}</span>
                  <!-- Короткая выжимка из отчёта: по ней видно, тот ли
                       это баг, ещё до привязки. Полный отчёт с логами
                       показывает карточка задачи. -->
                  <span v-if="bug.description" class="bug__desc">{{ bug.description }}</span>
                  <span v-if="bug.platform || bug.build" class="bug__meta">
                    {{ [bug.platform, bug.build].filter(Boolean).join(' · ') }}
                  </span>
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div class="modal__column">
          <div class="modal__grid">
            <section>
              <h3 class="modal__label">ТИП</h3>
              <div class="options">
                <button
                  v-for="option in typeOptions"
                  :key="option"
                  type="button"
                  class="tk-tap tk-plain option"
                  :class="{ 'option--active': type === option }"
                  @click="type = option"
                >
                  <span class="option__dot" :style="{ background: TYPE_TONES[option].dot }" />
                  {{ TYPE_TITLES[option] }}
                </button>
              </div>
            </section>

            <section>
              <h3 class="modal__label">ПРОЕКТ</h3>
              <div class="options">
                <button
                  v-for="option in projectOptions"
                  :key="option"
                  type="button"
                  class="tk-tap tk-plain option"
                  :class="{ 'option--active': project === option }"
                  @click="project = option"
                >
                  <span class="option__dot" :style="{ background: PROJECT_TONES[option].dot }" />
                  {{ PROJECT_TITLES[option] }}
                </button>
              </div>
            </section>

            <section>
              <h3 class="modal__label">ПРИОРИТЕТ</h3>
              <div class="options">
                <button
                  v-for="value in PRIORITY_ORDER"
                  :key="value"
                  type="button"
                  class="tk-tap tk-plain option"
                  :class="{ 'option--active': priority === value }"
                  @click="priority = value"
                >
                  <span class="option__dot" :style="{ background: priorityTone(value).dot }" />
                  {{ priorityTone(value).short }}
                </button>
              </div>
            </section>

            <section>
              <h3 class="modal__label">ИСПОЛНИТЕЛЬ</h3>
              <div class="assignees">
                <button
                  type="button"
                  class="tk-tap tk-plain assignee"
                  :class="{ 'assignee--active': assigneeId === null }"
                  @click="assigneeId = null"
                >
                  <span class="assignee__empty">—</span>
                  <span class="assignee__name">Без исполнителя</span>
                </button>

                <button
                  v-for="member in assignableMembers"
                  :key="member.id"
                  type="button"
                  class="tk-tap tk-plain assignee"
                  :class="{ 'assignee--active': assigneeId === member.id }"
                  @click="assigneeId = member.id"
                >
                  <AvatarBadge :staff="member" :size="24" />
                  <span class="assignee__name">{{ member.fullName }}</span>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      <footer class="modal__actions">
        <button type="button" class="tk-tap button button--ghost" @click="emit('close')">
          Отмена
        </button>
        <button type="submit" class="tk-tap tk-plain button button--primary" :disabled="!canSubmit">
          {{ submitting ? 'Создаём…' : 'Создать задачу' }}
        </button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: rgba(4, 5, 8, 0.72);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: tkFade 0.16s ease both;
  padding: 24px;
}

.modal {
  /* Окно тянется по ширине экрана: на широком мониторе поля перестают
     жаться в узкую колонку, но предел не даёт строке ввода растянуться
     до нечитаемой длины. */
  width: 100%;
  max-width: 900px;
  max-height: 100%;
  overflow: auto;
  background: var(--bg-modal);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 22px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.6);
  cursor: default;
}

.field__hint {
  color: var(--ink-40);
  font-weight: 500;
}

/* Перечень багов прокручивается: их может быть много, а форма не должна
   растягиваться на весь экран из-за одного списка. */
.bugs {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}

.bug {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  text-align: left;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 9px;
  background: var(--fill-hover);
  color: inherit;
}

.bug--active {
  border-color: var(--danger);
  background: var(--danger-bg);
}

.bug__head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--ink-40);
}

.bug__code {
  font-weight: 700;
  color: var(--danger-ink);
}

.bug__tag {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.bug__date {
  margin-left: auto;
}

.bug__title {
  font-size: 13px;
  line-height: 1.35;
}

/* Описание в две строки: перечень должен оставаться перечнем, а не
   превращаться в ленту отчётов. */
.bug__desc {
  font-size: 11px;
  line-height: 1.4;
  color: var(--ink-70);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.bug__meta {
  font-size: 11px;
  color: var(--ink-40);
}

.bugs__note {
  margin: 0;
  font-size: 12px;
  color: var(--ink-40);
}

.bugs__note--error {
  color: var(--danger-ink);
}

/* Недоступность сервиса — предупреждение, а не отказ: работа
   продолжается, просто без привязки бага. */
.bugs__warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 9px;
  background: var(--warning-bg);
  color: var(--warning-ink);
  font-size: 12px;
  line-height: 1.4;
}

.bugs__retry {
  margin-left: auto;
  flex: none;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}

.modal__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal__title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
}

.modal__columns {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 16px;
  align-items: start;
}

.modal__column {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

/* На узком экране колонки складываются в одну — тот же порог, что
   и у окна задачи: раскладка меняется по одной причине. */
@media (max-width: 900px) {
  .modal__columns {
    grid-template-columns: 1fr;
  }
}

/* На телефоне окно разворачивается во весь экран: карточка с полями
   в маленьком вьюпорте всё равно упирается в края, а поля ввода
   поднимают клавиатуру и требуют места. */
@media (max-width: 720px) {
  .overlay {
    padding: 0;
    align-items: stretch;
  }

  .modal {
    max-width: 100%;
    height: 100%;
    max-height: 100%;
    border: 0;
    border-radius: 0;
    padding: 16px max(14px, env(safe-area-inset-right))
      max(20px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left));
  }

  .assignees {
    /* Исполнители в столбец: длинные имена не влезают в ряд. */
    flex-direction: column;
  }

  .assignee {
    width: 100%;
  }

  /* Перечень багов на телефоне выше: 220px оставляли полтора пункта,
     и выбирать приходилось вслепую, прокручивая крошечное окошко. */
  .bugs {
    max-height: 45vh;
  }

  /* Карточка бага — цель под палец. Размер привязан к ширине экрана,
     а не только к pointer: coarse: тот не срабатывает в узком окне
     браузера с мышью, а промахиваться там так же неприятно. */
  .bug {
    padding: 11px 12px;
  }
}

@media (pointer: coarse) {
  .option {
    height: 42px;
  }

  .assignee {
    height: 48px;
  }

  .button {
    height: 50px;
  }

  /* 16px не даёт iOS увеличивать масштаб при фокусе на поле. */
  .field__input {
    font-size: 16px;
  }

  /* Карточка бага — цель под палец: в неё попадают, а не целятся. */
  .bug {
    padding: 10px 12px;
  }
}

.field {
  display: block;
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  padding: 11px 14px;
}

/* Описание занимает остаток высоты левой колонки, чтобы форма
   не выглядела обрезанной снизу. */
.field--grow {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.field--grow .field__input--area {
  flex: 1;
}

.field:focus-within {
  border-color: var(--accent-border);
}

.field__label {
  display: block;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--ink-45);
  margin-bottom: 3px;
}

.field__input {
  width: 100%;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--ink);
  font-size: 14.5px;
}

.field__input--area {
  resize: vertical;
  line-height: 1.5;
  font-size: 14px;
}

/* Тип и приоритет — друг под другом: они попадают в узкую правую
   колонку, где два ряда кнопок рядом уже не читаются. */
.modal__grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.modal__label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--ink-45);
  margin: 0 0 8px;
}

/* Перенос: типов пять, и «Рефакторинг» с «Обновлением» в одну строку
   уже не помещаются — без wrap кнопки сжимались и текст вылезал. */
.options {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.option {
  /* Растём от содержимого, а не делим строку поровну: иначе кнопка,
     перенесённая на вторую строку, растянулась бы на всю ширину. */
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 10px;
  height: 36px;
  border-radius: var(--r-md);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  color: var(--ink-70);
}

.option--active {
  background: var(--accent-bg-strong);
  border-color: var(--accent-border);
  color: var(--accent-ink);
}

.option__dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
}

/* Заготовка чек-листа. Пункты ещё не существуют на сервере, поэтому
   без отметок «выполнено» — только состав списка. */
.plan {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.plan__item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  border-radius: var(--r-sm);
  padding: 2px 4px;
}

.plan__item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.plan__marker {
  width: 12px;
  height: 12px;
  flex: none;
  border-radius: 3px;
  border: 1.5px solid var(--line-strong);
}

.plan__title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: rgba(233, 233, 237, 0.85);
  word-break: break-word;
}

.plan__remove {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-40);
  opacity: 0;
}

.plan__item:hover .plan__remove,
.plan__remove:focus-visible {
  opacity: 1;
}

.plan__remove:hover {
  color: var(--danger-ink);
}

.plan__remove svg {
  width: 11px;
  height: 11px;
}

.plan__add {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plan__submit {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--r-sm);
  color: var(--accent-ink);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}

.plan__submit:disabled {
  opacity: 0.4;
  cursor: default;
}

@media (pointer: coarse) {
  .plan__remove {
    opacity: 1;
    width: 32px;
    height: 32px;
  }

  .plan__submit {
    height: 38px;
  }
}

.assignees {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}

.assignee {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 10px;
  border-radius: var(--r-md);
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  color: var(--ink-70);
}

.assignee--active {
  background: var(--accent-bg);
  border-color: var(--accent-border);
  color: var(--accent-ink);
}

.assignee__empty {
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.09);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}

.assignee__name {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.modal__actions {
  display: flex;
  gap: 10px;
  margin-top: 2px;
}

.button {
  height: 46px;
  border-radius: var(--r-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
}

.button--ghost {
  flex: 1;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(233, 233, 237, 0.75);
}

.button--primary {
  flex: 1.4;
  background: var(--accent-gradient);
  color: #fff;
  box-shadow: var(--accent-shadow);
}

.button--primary:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
