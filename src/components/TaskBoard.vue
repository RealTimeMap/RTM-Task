<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'

import TaskCard from './TaskCard.vue'
import { useSessionStore } from '../stores/session'
import { useTasksStore } from '../stores/tasks'
import { useToastStore } from '../stores/toast'
import { STATUS_TITLES, STATUS_TONES, taskCode } from '../lib/presentation'
import { STATUS_ORDER, canTransition, type Task, type TaskStatus } from '../types/task'

const emit = defineEmits<{ create: [status: TaskStatus] }>()

const tasks = useTasksStore()
const session = useSessionStore()
const toast = useToastStore()
const { columns, dragging } = storeToRefs(tasks)
const { permissions, staff } = storeToRefs(session)

/** Колонка, над которой сейчас находится курсор с карточкой. */
const hoveredColumn = ref<TaskStatus | null>(null)

/**
 * Указатель без точного позиционирования — палец. HTML5 drag & drop
 * на таких устройствах не работает, а атрибут draggable мешает
 * прокрутке и вызывает системное меню по долгому нажатию, поэтому
 * там перетаскивание выключаем: двигать задачи можно стрелками.
 */
const isTouch =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

/**
 * Сдвиг задачи стрелками на карточке. Ведёт себя так же, как
 * перетаскивание: ничью задачу, уходящую в работу, берёт на себя
 * тот, кто её продвинул.
 */
async function move(id: number, direction: 1 | -1): Promise<void> {
  const task = tasks.items.find((item) => item.id === id)
  const me = staff.value
  if (!task || !me) return

  const target = STATUS_ORDER[STATUS_ORDER.indexOf(task.status) + direction]
  if (!target) return

  const takesOwnership = target === 'working' && task.assigneeId === null

  const updated = await tasks.changeStatusAsOwner(id, target, me.id)
  if (!updated) return

  toast.show(
    takesOwnership
      ? `${taskCode(updated.id)} → ${STATUS_TITLES[updated.status]}, исполнитель — вы`
      : `${taskCode(updated.id)} → ${STATUS_TITLES[updated.status]}`,
  )
}

/**
 * Право менять задачу — то же, что проверяет сервер: автор, исполнитель
 * или управляющая роль. Карточку, которую всё равно не дадут двигать,
 * лучше не делать перетаскиваемой.
 */
function canEdit(task: Task): boolean {
  const me = staff.value
  if (!me) return false
  return task.creatorId === me.id || task.assigneeId === me.id || permissions.value.canAssignAnyone
}

/** Карточку можно тянуть, если есть права и указатель это позволяет. */
function isDraggable(task: Task): boolean {
  return !isTouch && canEdit(task)
}

/**
 * Можно ли отпустить задачу в эту колонку — по таблице переходов бэкенда.
 *
 * Правила «в работу только с исполнителем» здесь нет: ничью задачу,
 * перетащенную в работу, берёт на себя тот, кто её перетащил
 * (см. onDrop). Не хватать может только прав, и это решает сервер.
 *
 * Задача передаётся явно: во время drop состояние стора уже сброшено,
 * и читать перетаскиваемую задачу оттуда нельзя.
 */
function canDrop(task: Task | null, status: TaskStatus): boolean {
  if (!task || task.status === status) return false
  return canTransition(task.status, status)
}

/** Проверка для подсветки колонки во время перетаскивания. */
function canDropInto(status: TaskStatus): boolean {
  return canDrop(dragging.value, status)
}

/** Состояние колонки под курсором: подсветка приёма или запрета. */
function columnState(status: TaskStatus): 'idle' | 'allowed' | 'blocked' {
  if (!dragging.value || hoveredColumn.value !== status) return 'idle'
  return canDropInto(status) ? 'allowed' : 'blocked'
}

function onDragOver(event: DragEvent, status: TaskStatus): void {
  hoveredColumn.value = status

  if (!canDropInto(status)) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    return
  }

  // preventDefault разрешает drop — без него браузер его не пропустит.
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

/**
 * dragleave приходит и при переходе между дочерними элементами колонки,
 * из-за чего подсветка мигала бы. Сбрасываем её, только когда курсор
 * действительно вышел за пределы колонки.
 */
function onDragLeave(event: DragEvent, status: TaskStatus): void {
  const column = event.currentTarget as HTMLElement | null
  const next = event.relatedTarget as Node | null

  if (column && next && column.contains(next)) return
  if (hoveredColumn.value === status) {
    hoveredColumn.value = null
  }
}

async function onDrop(status: TaskStatus): Promise<void> {
  // Задачу забираем до сброса состояния: дальше стор её уже не отдаст.
  const task = dragging.value
  hoveredColumn.value = null
  tasks.endDrag()

  if (!task || !canDrop(task, status)) return

  const me = staff.value
  if (!me) return

  // Ничья задача, уходящая в работу, достаётся перетащившему:
  // без исполнителя сервер её в работу не пустит, а спрашивать
  // отдельно — лишний шаг для очевидного намерения.
  const takesOwnership = status === 'working' && task.assigneeId === null

  const updated = await tasks.changeStatusAsOwner(task.id, status, me.id)
  if (!updated) return

  toast.show(
    takesOwnership
      ? `${taskCode(updated.id)} → ${STATUS_TITLES[updated.status]}, исполнитель — вы`
      : `${taskCode(updated.id)} → ${STATUS_TITLES[updated.status]}`,
  )
}

function onDragEnd(): void {
  hoveredColumn.value = null
  tasks.endDrag()
}

/**
 * Подсказка на заблокированной колонке. Причина осталась одна:
 * переход не разрешён жизненным циклом задачи.
 */
const blockedHint = 'Недоступный переход'
</script>

<template>
  <div class="tk-fade board">
    <section
      v-for="column in columns"
      :key="column.status"
      class="column"
      :class="`column--${columnState(column.status)}`"
      @dragenter.prevent="hoveredColumn = column.status"
      @dragover="onDragOver($event, column.status)"
      @dragleave="onDragLeave($event, column.status)"
      @drop.prevent="onDrop(column.status)"
    >
      <header class="column__header">
        <span class="column__dot" :style="{ background: STATUS_TONES[column.status].dot }" />
        <h2 class="column__title">{{ STATUS_TITLES[column.status] }}</h2>
        <span class="column__count">{{ column.tasks.length }}</span>
      </header>

      <TaskCard
        v-for="task in column.tasks"
        :key="task.id"
        :task="task"
        :draggable="isDraggable(task)"
        :dragging="dragging?.id === task.id"
        @open="tasks.select(task.id)"
        @move="(direction) => move(task.id, direction)"
        @dragstart="tasks.startDrag(task.id)"
        @dragend="onDragEnd"
      />

      <p v-if="column.tasks.length === 0" class="column__empty">Пусто</p>

      <p v-if="columnState(column.status) === 'blocked'" class="column__blocked">
        {{ blockedHint }}
      </p>

      <button
        v-if="permissions.canCreate && !dragging"
        class="tk-tap tk-plain column__add"
        @click="emit('create', column.status)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Добавить
      </button>
    </section>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: repeat(3, minmax(280px, 1fr));
  gap: 16px;
  align-items: start;
  width: 100%;
}

/* Две колонки на средних экранах, одна — на узких: карточка перестаёт
   быть читаемой уже, чем ~280px.
   Нижняя граница — 820px, а не 720: при 768px (портретный iPad) вместе
   с постоянным сайдбаром на две колонки остаётся 532px, и жёсткий
   minmax(260px) вытолкнул бы доску за пределы контейнера. */
@media (max-width: 1100px) {
  .board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .board {
    grid-template-columns: 1fr;
  }
}

.column {
  background: rgba(255, 255, 255, 0.022);
  border: 1px solid var(--line);
  border-radius: var(--r-xl);
  padding: 12px 11px 11px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* Колонке нужна площадь для приёма карточки, даже если она пуста. */
  min-height: 160px;
  transition:
    background 0.16s,
    border-color 0.16s;
}

/* Колонка готова принять карточку */
.column--allowed {
  background: var(--accent-bg);
  border-color: var(--accent-border);
}

/* Переход в эту колонку запрещён */
.column--blocked {
  background: var(--danger-bg);
  border-color: rgba(229, 72, 77, 0.35);
}

.column__header {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 3px;
}

.column__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.column__title {
  flex: 1;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
  margin: 0;
}

.column__count {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-45);
  background: var(--fill-hover);
  border-radius: var(--r-sm);
  padding: 2px 7px;
}

.column__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 8px;
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-30);
  margin: 0;
}

.column__blocked {
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--danger-ink);
  margin: 0;
  padding: 6px 8px;
}

.column__add {
  height: 34px;
  border-radius: var(--r-md);
  border: 1px dashed rgba(255, 255, 255, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-45);
}

.column__add svg {
  width: 13px;
  height: 13px;
}

@media (pointer: coarse) {
  .column__add {
    height: 42px;
  }
}
</style>
