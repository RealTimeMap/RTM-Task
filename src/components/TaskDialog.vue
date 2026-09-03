<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import AvatarBadge from './ui/AvatarBadge.vue'
import MarkdownEditor from './ui/MarkdownEditor.vue'
import MarkdownText from './ui/MarkdownText.vue'
import TagChip from './ui/TagChip.vue'
import TaskChecklist from './TaskChecklist.vue'
import TaskComments from './TaskComments.vue'
import { useDiscussionStore } from '../stores/discussion'
import { useSessionStore } from '../stores/session'
import { useTasksStore } from '../stores/tasks'
import { useToastStore } from '../stores/toast'
import {
  PRIORITY_ORDER,
  STATUS_TITLES,
  TYPE_ORDER,
  TYPE_TITLES,
  TYPE_TONES,
  priorityTone,
  shortDate,
  taskCode,
} from '../lib/presentation'
import {
  STATUS_ORDER,
  canSendToRework,
  canTransition,
  isInRework,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from '../types/task'

const tasks = useTasksStore()
const session = useSessionStore()
const toast = useToastStore()
const discussion = useDiscussionStore()

const { selected } = storeToRefs(tasks)
const { members, permissions, staff } = storeToRefs(session)

const assigneePickerOpen = ref(false)

const editingDescription = ref(false)
const descriptionDraft = ref('')
const savingDescription = ref(false)

const reworkOpen = ref(false)
const reworkDraft = ref('')
const sendingRework = ref(false)

// Смена задачи закрывает вспомогательные панели: черновик описания
// относится к конкретной задаче и на другую не переносится.
watch(selected, (task) => {
  assigneePickerOpen.value = false
  editingDescription.value = false
  descriptionDraft.value = ''
  closeRework()

  // Обсуждение и чек-лист грузятся под открытую задачу: держать их
  // для всей доски незачем.
  if (task) {
    void discussion.open(task.id)
  } else {
    discussion.close()
  }
})

function startEditDescription(): void {
  descriptionDraft.value = selected.value?.description ?? ''
  editingDescription.value = true
}

function cancelDescription(): void {
  editingDescription.value = false
  descriptionDraft.value = ''
}

async function saveDescription(): Promise<void> {
  const task = selected.value
  if (!task) return

  savingDescription.value = true
  try {
    const updated = await tasks.update(task.id, { description: descriptionDraft.value })
    if (updated) {
      editingDescription.value = false
      toast.show(`${taskCode(updated.id)}: описание обновлено`)
    }
  } finally {
    savingDescription.value = false
  }
}

function openRework(): void {
  reworkDraft.value = ''
  reworkOpen.value = true
}

function closeRework(): void {
  reworkOpen.value = false
  reworkDraft.value = ''
}

const assignee = computed(() => session.memberById(selected.value?.assigneeId ?? null))
const creator = computed(() => session.memberById(selected.value?.creatorId ?? null))

/**
 * Право на изменение — та же логика, что и на сервере:
 * автор, исполнитель или управляющая роль.
 */
const canEdit = computed(() => {
  const task = selected.value
  const me = staff.value
  if (!task || !me) return false

  return task.creatorId === me.id || task.assigneeId === me.id || permissions.value.canAssignAnyone
})

/** Замечание к последней доработке, если задачу вернули и ещё не приняли. */
const rework = computed(() => {
  const task = selected.value
  if (!task || !isInRework(task)) return null

  return {
    note: task.reworkNote ?? '',
    author: session.memberById(task.reworkById ?? null)?.fullName ?? 'Неизвестно',
    at: task.reworkAt ? shortDate(task.reworkAt) : '',
  }
})

/**
 * Комментировать можно и завершённую задачу: вопросы к результату
 * возникают именно после сдачи, а правку самой задачи это не открывает.
 */
const canComment = computed(() => canEdit.value)

/**
 * Чек-лист закрытой задачи только для чтения: план работ относится
 * к незакрытой задаче, как и остальное её редактирование.
 */
const canEditChecklist = computed(() => canEdit.value && selected.value?.status !== 'complete')

/** Отправить в доработку можно завершённую задачу — и только тому, кто её ведёт. */
const canRework = computed(() => canEdit.value && !!selected.value && canSendToRework(selected.value))

async function submitRework(): Promise<void> {
  const task = selected.value
  if (!task) return

  sendingRework.value = true
  try {
    const updated = await tasks.sendToRework(task.id, reworkDraft.value.trim())
    if (updated) {
      closeRework()
      toast.show(`${taskCode(updated.id)} → ${STATUS_TITLES[updated.status]}: отправлена в доработку`)
    }
  } finally {
    sendingRework.value = false
  }
}

const meta = computed(() => {
  const task = selected.value
  if (!task) return []

  return [
    { label: 'Исполнитель', value: assignee.value?.fullName ?? 'Не назначено', ink: 'var(--ink)' },
    { label: 'Автор', value: creator.value?.fullName ?? `#${task.creatorId}`, ink: 'var(--ink-70)' },
    { label: 'Создана', value: shortDate(task.createdAt), ink: 'var(--ink-70)' },
    { label: 'Обновлена', value: shortDate(task.updatedAt), ink: 'var(--ink-70)' },
    { label: 'Версия', value: `v${task.version}`, ink: 'var(--ink-70)' },
  ]
})

/** Кнопки статусов: недоступные переходы гасятся заранее. */
const statusButtons = computed(() => {
  const task = selected.value
  if (!task) return []

  return STATUS_ORDER.map((status) => {
    const isCurrent = task.status === status
    const allowed = canTransition(task.status, status)
    const needsAssignee = status === 'working' && task.assigneeId === null

    return {
      status,
      label: STATUS_TITLES[status],
      active: isCurrent,
      disabled: isCurrent || !allowed || needsAssignee || !canEdit.value,
    }
  })
})

async function pickStatus(status: TaskStatus): Promise<void> {
  const task = selected.value
  if (!task) return

  const updated = await tasks.changeStatus(task.id, status)
  if (updated) {
    toast.show(`${taskCode(updated.id)} → ${STATUS_TITLES[updated.status]}`)
  }
}

async function pickType(type: TaskType): Promise<void> {
  const task = selected.value
  if (!task || task.type === type) return

  const updated = await tasks.update(task.id, { type })
  if (updated) {
    toast.show(`${taskCode(updated.id)}: тип — ${TYPE_TITLES[updated.type]}`)
  }
}

async function pickPriority(priority: TaskPriority): Promise<void> {
  const task = selected.value
  if (!task) return
  await tasks.setPriority(task.id, priority)
}

async function pickAssignee(staffId: number | null): Promise<void> {
  const task = selected.value
  if (!task) return

  const updated =
    staffId === null ? await tasks.unassign(task.id) : await tasks.assign(task.id, staffId)

  if (updated) {
    assigneePickerOpen.value = false
    toast.show(
      staffId === null
        ? `${taskCode(updated.id)}: исполнитель снят`
        : `${taskCode(updated.id)} назначена`,
    )
  }
}

async function removeTask(): Promise<void> {
  const task = selected.value
  if (!task) return

  const code = taskCode(task.id)
  if (!confirm(`Удалить задачу ${code}? Действие необратимо.`)) return

  if (await tasks.removeTask(task.id)) {
    toast.show(`${code} удалена`)
  }
}

/** Назначать другим может только менеджер; себя может взять любой. */
const assignableMembers = computed(() => {
  if (permissions.value.canAssignAnyone) return members.value
  return staff.value ? [staff.value] : []
})

/**
 * Escape закрывает окно — привычное поведение для модального диалога.
 * Слушатель висит на документе: фокус может быть в любом поле внутри.
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !selected.value) return

  // Escape снимает верхний открытый слой, а не закрывает всё сразу:
  // иначе один случайный нажим терял бы черновик описания.
  if (assigneePickerOpen.value) {
    assigneePickerOpen.value = false
    return
  }
  if (reworkOpen.value) {
    closeRework()
    return
  }
  if (editingDescription.value) {
    cancelDescription()
    return
  }
  tasks.select(null)
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div v-if="selected" class="overlay" @click="tasks.select(null)">
    <div
      class="tk-rise dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Детали задачи"
      @click.stop
    >
      <header class="dialog__head">
        <span class="dialog__code">{{ taskCode(selected.id) }}</span>
        <TagChip
          :label="TYPE_TONES[selected.type].label"
          :ink="TYPE_TONES[selected.type].ink"
          :bg="TYPE_TONES[selected.type].bg"
          size="sm"
        />
        <span class="dialog__spacer" />
        <button class="tk-tap dialog__close" title="Закрыть" @click="tasks.select(null)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <!-- Слева содержание задачи, справа её параметры: описание
           получает основное место, управление собрано в одном столбце. -->
      <div class="dialog__body">
        <div class="tk-scroll dialog__main">
          <h2 class="dialog__title">{{ selected.title }}</h2>

          <!-- Замечание к доработке: показывается до тех пор, пока задачу
               не приняли заново, потому что это и есть текущее задание. -->
          <section v-if="rework" class="rework">
            <div class="rework__head">
              <span class="rework__badge">НА ДОРАБОТКЕ</span>
              <span class="rework__meta">{{ rework.author }} · {{ rework.at }}</span>
            </div>
            <MarkdownText :source="rework.note" placeholder="" />
          </section>

          <section class="description">
            <div class="description__head">
              <h3 class="dialog__label">ОПИСАНИЕ</h3>
              <button
                v-if="canEdit && selected.status !== 'complete'"
                class="tk-tap tk-plain description__toggle"
                @click="editingDescription ? cancelDescription() : startEditDescription()"
              >
                {{ editingDescription ? 'Отмена' : 'Изменить' }}
              </button>
            </div>

            <template v-if="editingDescription">
              <MarkdownEditor
                v-model="descriptionDraft"
                :rows="8"
                placeholder="Поддерживается разметка: **жирный**, `код`, списки"
              />
              <button
                class="tk-tap tk-plain description__save"
                :disabled="savingDescription"
                @click="saveDescription"
              >
                {{ savingDescription ? 'Сохраняем…' : 'Сохранить описание' }}
              </button>
            </template>

            <MarkdownText
              v-else
              :source="selected.description ?? ''"
              placeholder="Описание не заполнено"
            />
          </section>

        </div>

        <!-- Обсуждение вынесено из левой колонки, хотя на широком экране
             и стоит под описанием: только прямой ребёнок сетки можно
             переставить в один столбец под управление задачей. -->
        <TaskComments class="tk-scroll dialog__comments" :can-comment="canComment" />

        <aside class="tk-scroll dialog__side">
        <section>
          <h3 class="dialog__label">СТАТУС</h3>
          <div class="status-grid">
            <button
              v-for="button in statusButtons"
              :key="button.status"
              class="tk-tap tk-plain option"
              :class="{ 'option--active': button.active }"
              :disabled="button.disabled"
              @click="pickStatus(button.status)"
            >
              {{ button.label }}
            </button>
          </div>

          <!-- Возврат в работу: единственный выход из «Завершена»,
               поэтому кнопка живёт рядом со статусами, а не среди действий. -->
          <template v-if="canRework">
            <button
              v-if="!reworkOpen"
              class="tk-tap tk-plain rework-button"
              @click="openRework"
            >
              Отправить в доработку
            </button>

            <div v-else class="rework-form">
              <h4 class="rework-form__label">Что нужно доделать</h4>
              <MarkdownEditor
                v-model="reworkDraft"
                :rows="4"
                placeholder="Опишите, что исправить"
              />
              <div class="rework-form__actions">
                <button
                  class="tk-tap tk-plain rework-form__submit"
                  :disabled="sendingRework || reworkDraft.trim().length < 5"
                  @click="submitRework"
                >
                  {{ sendingRework ? 'Отправляем…' : 'Вернуть в работу' }}
                </button>
                <button class="tk-tap tk-plain rework-form__cancel" @click="closeRework">
                  Отмена
                </button>
              </div>
            </div>
          </template>
        </section>

        <!-- Чек-лист рядом с управлением: это план работ, а не текст
             задачи, и отмечают пункты по ходу дела. -->
        <TaskChecklist class="dialog__checklist" :can-edit="canEditChecklist" />

        <section class="meta">
          <div v-for="(row, index) in meta" :key="row.label" class="meta__row" :class="{ 'meta__row--divided': index > 0 }">
            <span class="meta__label">{{ row.label }}</span>
            <span class="meta__value" :style="{ color: row.ink }">{{ row.value }}</span>
          </div>
        </section>

        <section>
          <h3 class="dialog__label">ТИП</h3>
          <!-- Типов пять — в ряд не помещаются, поэтому с переносом,
               как в форме создания. -->
          <div class="type-grid">
            <button
              v-for="option in TYPE_ORDER"
              :key="option"
              class="tk-tap tk-plain option option--type"
              :class="{ 'option--active': selected.type === option }"
              :disabled="!canEdit || selected.status === 'complete'"
              @click="pickType(option)"
            >
              <span class="option__dot" :style="{ background: TYPE_TONES[option].dot }" />
              {{ TYPE_TITLES[option] }}
            </button>
          </div>
        </section>

        <section>
          <h3 class="dialog__label">ПРИОРИТЕТ</h3>
          <div class="priority-row">
            <button
              v-for="value in PRIORITY_ORDER"
              :key="value"
              class="tk-tap tk-plain option option--compact"
              :class="{ 'option--active': selected.priority === value }"
              :disabled="!canEdit || selected.status === 'complete'"
              @click="pickPriority(value)"
            >
              <span class="option__dot" :style="{ background: priorityTone(value).dot }" />
              {{ priorityTone(value).short }}
            </button>
          </div>
        </section>

        <section>
          <h3 class="dialog__label">ИСПОЛНИТЕЛЬ</h3>

          <!-- Обёртка задаёт систему координат для списка: он
               раскрывается поверх содержимого, а не раздвигает его. -->
          <div class="assignee-field">
            <button
              class="tk-tap assignee"
              :disabled="selected.status === 'complete'"
              @click="assigneePickerOpen = !assigneePickerOpen"
            >
              <AvatarBadge :staff="assignee" :size="28" />
              <span class="assignee__name">{{ assignee?.fullName ?? 'Не назначено' }}</span>
              <svg
                class="assignee__chevron"
                :class="{ 'assignee__chevron--open': assigneePickerOpen }"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M6 9.5l6 6 6-6" />
              </svg>
            </button>

            <!-- Клик мимо списка закрывает его: раскрытый, он перекрывает
                 то, что под ним, и должен убираться так же легко. -->
            <div
              v-if="assigneePickerOpen"
              class="picker-scrim"
              @click="assigneePickerOpen = false"
            />

            <div v-if="assigneePickerOpen" class="tk-scroll picker">
              <button
                v-for="member in assignableMembers"
                :key="member.id"
                class="tk-tap tk-plain picker__item"
                :class="{ 'picker__item--active': member.id === selected.assigneeId }"
                @click="pickAssignee(member.id)"
              >
                <AvatarBadge :staff="member" :size="24" />
                <span class="picker__name">{{ member.fullName }}</span>
              </button>

              <button
                v-if="selected.assigneeId !== null"
                class="tk-tap tk-plain picker__item picker__item--clear"
                @click="pickAssignee(null)"
              >
                Снять исполнителя
              </button>
            </div>
          </div>
        </section>

        <button
          v-if="permissions.canDelete || selected.creatorId === staff?.id"
          class="tk-tap danger-button"
          @click="removeTask"
        >
          Удалить задачу
        </button>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: rgba(4, 5, 8, 0.72);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  animation: tkFade 0.16s ease both;
}

.dialog {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 920px;
  max-height: 100%;
  background: var(--bg-modal);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.6);
  cursor: default;
}

/* Две колонки: содержание задачи и её параметры.
   Каждая прокручивается сама — длинное описание не уносит вниз
   кнопки управления. */
/*
  Два столбца и две строки: слева описание, под ним обсуждение, справа
  во всю высоту — параметры задачи.

  Описание занимает ровно столько, сколько ему нужно (auto), а остаток
  высоты забирает обсуждение — так переписка прокручивается сама, не
  утягивая за собой заголовок и описание.
*/
.dialog__body {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  flex: 1;
}

.dialog__main {
  grid-column: 1;
  grid-row: 1;
  min-height: 0;
  overflow: auto;
  padding: 18px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dialog__comments {
  grid-column: 1;
  grid-row: 2;
  min-height: 0;
  overflow: auto;
  padding: 0 20px 24px;
}

.dialog__side {
  grid-column: 2;
  grid-row: 1 / -1;
}

.dialog__side {
  min-height: 0;
  overflow: auto;
  padding: 18px 20px 24px;
  border-left: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.018);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Ниже этой ширины две колонки не помещаются: параметры уезжают
   под описание, окно становится обычным вертикальным списком. */
@media (max-width: 900px) {
  .dialog__body {
    grid-template-columns: 1fr;
    /* Прокрутка переезжает на общий контейнер: две независимо
       скроллящиеся области в одном столбце только мешают. */
    overflow: auto;
    /* Колонки становятся секциями одного потока — это нужно, чтобы
       переставлять их по order (см. ниже). */
    display: flex;
    flex-direction: column;
  }

  .dialog__main,
  .dialog__side {
    overflow: visible;
  }

  .dialog__side {
    border-left: 0;
    border-top: 1px solid var(--line);
  }

  /*
    Обсуждение уезжает в самый низ, под управление задачей.

    В два столбца оно стоит рядом с параметрами и друг другу не мешает,
    но в одном столбце переписка растёт неограниченно — и чек-лист со
    статусом оказались бы под ней. До плана работ пришлось бы
    прокручивать всё обсуждение, хотя открывают задачу обычно ради него.
  */
  .dialog__main {
    display: flex;
    flex-direction: column;
    order: 1;
  }

  .dialog__side {
    order: 2;
  }

  .dialog__main,
  .dialog__comments,
  .dialog__side {
    grid-column: auto;
    grid-row: auto;
    /* Флекс-колонка иначе сжимает области под доступную высоту, и их
       содержимое вываливается наружу поверх соседних блоков: прокрутка
       здесь на общем контейнере, а не внутри каждой области. */
    flex: none;
  }

  .dialog__comments {
    order: 3;
    overflow: visible;
    padding: 16px 20px 24px;
    border-top: 1px solid var(--line);
  }

  /* Чек-лист поднимается к статусу: вместе они отвечают на вопрос
     «что сейчас с задачей», а мета и настройки — уже подробности. */
  .dialog__checklist {
    order: -1;
  }
}

/* На телефоне окно разворачивается во весь экран. */
@media (max-width: 720px) {
  .overlay {
    padding: 0;
    align-items: stretch;
  }

  .dialog {
    max-width: 100%;
    height: 100%;
    max-height: 100%;
    border: 0;
    border-radius: 0;
  }

  .dialog__head {
    padding-left: max(18px, env(safe-area-inset-left));
    padding-right: max(18px, env(safe-area-inset-right));
  }

  .dialog__main,
  .dialog__side {
    padding: 14px max(14px, env(safe-area-inset-right))
      max(20px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left));
  }

  /* Обсуждение идёт последним — нижний отступ обходит домашнюю полосу,
     иначе поле ввода упирается прямо в неё. */
  .dialog__comments {
    padding: 14px max(14px, env(safe-area-inset-right))
      max(24px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left));
  }

  /* Статусы в один столбец: две кнопки в ряд на узком экране
     обрезают подписи. */
  .status-grid {
    grid-template-columns: 1fr;
  }

  /* Типы по два в ряд: пять кнопок в столбец растянули бы окно,
     а в одну строку подписи не помещаются. */
  .type-grid .option--type {
    flex: 1 1 calc(50% - 4px);
  }
}

/* Цели под палец: 36px — минимум, при котором в кнопку попадаешь. */
@media (pointer: coarse) {
  .option {
    height: 42px;
  }

  .dialog__close {
    width: 38px;
    height: 38px;
  }

  .picker__item {
    height: 44px;
  }

  .assignee {
    height: 50px;
  }

  .danger-button {
    height: 48px;
  }
}

.dialog__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  padding: 15px 18px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-panel);
}

.dialog__code {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ink-45);
  white-space: nowrap;
}

.dialog__spacer {
  flex: 1;
}

.dialog__close {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-60);
}

.dialog__close svg {
  width: 13px;
  height: 13px;
}

.dialog__title {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.3;
  margin: 0;
  text-wrap: pretty;
}

.description {
  display: flex;
  flex-direction: column;
}

.description__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.description__toggle {
  margin-left: auto;
  margin-bottom: 8px;
  padding: 2px 8px;
  border-radius: var(--r-sm);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--accent-ink);
}

.description__save {
  margin-top: 8px;
  height: 38px;
  border-radius: var(--r-md);
  background: var(--accent-gradient);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}

.description__save:disabled {
  opacity: 0.5;
  cursor: default;
}

.dialog__label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.11em;
  color: var(--ink-45);
  margin: 0 0 8px;
}

.status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}

.priority-row {
  display: flex;
  gap: 7px;
}

/* Типы переносятся по строкам: пять кнопок в узкой колонке в один ряд
   не помещаются. Растут от содержимого, а не делят строку поровну —
   иначе перенесённая кнопка растянулась бы на всю ширину. */
.type-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.option--type {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 10px;
  font-size: 11.5px;
}

.option {
  height: 36px;
  border-radius: var(--r-md);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  color: var(--ink-70);
}

.option--compact {
  flex: 1;
  font-size: 12px;
}

.option--active {
  background: var(--accent-bg-strong);
  border-color: var(--accent-border);
  color: var(--accent-ink);
}

.option:disabled {
  opacity: 0.4;
  cursor: default;
}

.option:disabled:hover {
  background: var(--fill-soft);
}

.option--active:disabled {
  opacity: 1;
}

.option--active:disabled:hover {
  background: var(--accent-bg-strong);
}

.option__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.meta {
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  overflow: hidden;
}

.meta__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 13px;
}

.meta__row--divided {
  border-top: 1px solid rgba(255, 255, 255, 0.055);
}

.meta__label {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-45);
  white-space: nowrap;
}

.meta__value {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}

.assignee {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 46px;
  padding: 0 12px;
  border-radius: var(--r-lg);
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  color: var(--ink);
}

.assignee:disabled {
  opacity: 0.5;
  cursor: default;
}

.assignee__name {
  flex: 1;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.assignee svg {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--ink-45);
}

/* Стрелка разворачивается вверх, когда список открыт: без этого
   непонятно, что кнопка сейчас в раскрытом состоянии. */
.assignee__chevron {
  transition: transform 0.16s;
}

.assignee__chevron--open {
  transform: rotate(180deg);
}

.assignee-field {
  position: relative;
}

/*
  Список раскрывается поверх содержимого, а не в потоке: иначе он
  раздвигал бы блоки под собой и окно подпрыгивало при каждом открытии.
*/
/*
  Список раскрывается вверх, а не вниз: поле исполнителя стоит внизу
  колонки, и вниз он упёрся бы в её край — колонка прокручиваемая
  (overflow: auto) и обрезала бы содержимое. Вверх места достаточно.
*/
.picker {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* Непрозрачный фон обязателен: под списком лежит другое содержимое. */
  background: var(--bg-modal);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  padding: 6px;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.55);
  /* Длинный список команды не должен уезжать за пределы окна. */
  max-height: 240px;
  overflow-y: auto;
  animation: tkFade 0.14s ease both;
}


/* Ловит клик мимо списка. Прозрачная, но перекрывает всё окно —
   поэтому лежит ниже самого списка по z-index. */
.picker-scrim {
  position: fixed;
  inset: 0;
  z-index: 4;
}

.picker__item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 8px;
  border-radius: var(--r-md);
  width: 100%;
  text-align: left;
}

.picker__item--active {
  background: var(--accent-bg);
  color: var(--accent-ink);
}

.picker__item--clear {
  justify-content: center;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--danger-ink);
}

.picker__name {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.danger-button {
  height: 42px;
  border-radius: var(--r-lg);
  border: 1px solid rgba(229, 72, 77, 0.35);
  background: var(--danger-bg);
  color: var(--danger-ink);
  font-size: 13px;
  font-weight: 600;
}

.danger-button:hover {
  background: rgba(229, 72, 77, 0.2);
}
/* Замечание к доработке. Тон предупреждающий: это не оформление
   задачи, а невыполненное требование к уже сданной работе. */
.rework {
  margin-bottom: 18px;
  padding: 12px 14px;
  background: var(--warning-bg);
  border: 1px solid rgba(245, 196, 81, 0.28);
  border-left: 3px solid var(--warning);
  border-radius: var(--r-md);
}

.rework__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.rework__badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.11em;
  color: var(--warning-ink);
}

.rework__meta {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-45);
}

.rework-button {
  width: 100%;
  margin-top: 8px;
  height: 36px;
  border: 1px solid rgba(245, 196, 81, 0.32);
  border-radius: var(--r-md);
  background: var(--warning-bg);
  color: var(--warning-ink);
  font-size: 12.5px;
  font-weight: 600;
}

.rework-form {
  margin-top: 10px;
}

.rework-form__label {
  margin: 0 0 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.11em;
  color: var(--ink-45);
}

.rework-form__actions {
  display: flex;
  gap: 7px;
  margin-top: 8px;
}

.rework-form__submit {
  flex: 1;
  height: 36px;
  border-radius: var(--r-md);
  background: var(--accent-gradient);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
}

.rework-form__submit:disabled {
  opacity: 0.5;
  cursor: default;
}

.rework-form__cancel {
  height: 36px;
  padding: 0 12px;
  border-radius: var(--r-md);
  color: var(--ink-60);
  font-size: 12.5px;
  font-weight: 600;
}
</style>
