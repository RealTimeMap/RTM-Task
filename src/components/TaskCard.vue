<script setup lang="ts">
import { computed } from 'vue'

import AvatarBadge from './ui/AvatarBadge.vue'
import TagChip from './ui/TagChip.vue'
import { TYPE_TONES, priorityTone, taskCode } from '../lib/presentation'
import { useSessionStore } from '../stores/session'
import { nextStatus, previousStatus, type Task } from '../types/task'

const props = withDefaults(
  defineProps<{
    task: Task
    draggable?: boolean
    dragging?: boolean
  }>(),
  { draggable: false, dragging: false },
)

const emit = defineEmits<{
  open: []
  move: [direction: 1 | -1]
  dragstart: []
  dragend: []
}>()

const session = useSessionStore()

/**
 * Перетаскивание переносит только идентификатор: полезная нагрузка
 * нужна лишь для того, чтобы браузер считал перенос валидным, а сама
 * задача берётся из стора по этому id.
 */
function onDragStart(event: DragEvent): void {
  if (!props.draggable) return

  event.dataTransfer?.setData('text/plain', String(props.task.id))
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
  emit('dragstart')
}

const type = computed(() => TYPE_TONES[props.task.type])
const priority = computed(() => priorityTone(props.task.priority))
const assignee = computed(() => session.memberById(props.task.assigneeId))

/**
 * Кнопки перехода гасятся по той же таблице переходов, что и на сервере.
 *
 * Отсутствие исполнителя движению не мешает: как и при перетаскивании,
 * ничью задачу в работе берёт на себя тот, кто её продвинул.
 */
const canGoForward = computed(() => nextStatus(props.task.status) !== null)

const canGoBack = computed(() => previousStatus(props.task.status) !== null)
</script>

<template>
  <article
    class="tk-card card"
    :class="{ 'card--draggable': draggable, 'card--dragging': dragging }"
    :draggable="draggable"
    @dragstart="onDragStart"
    @dragend="emit('dragend')"
  >
    <!--
      Тело карточки — не <button>: кнопка перехватывает mousedown и не даёт
      начать перетаскивание, поэтому взять карточку можно было бы только
      за узкую полоску футера. Роль и обработчик клавиатуры возвращают
      доступность, потерянную вместе с нативной кнопкой.
    -->
    <div
      class="tk-tap tk-plain card__body"
      role="button"
      tabindex="0"
      @click="emit('open')"
      @keydown.enter.prevent="emit('open')"
      @keydown.space.prevent="emit('open')"
    >
      <div class="card__meta">
        <TagChip :label="type.label" :ink="type.ink" :bg="type.bg" size="sm" />
        <span class="card__code">{{ taskCode(task.id) }}</span>
        <span class="card__spacer" />
        <span
          class="card__priority"
          :style="{ background: priority.dot }"
          :title="`Приоритет: ${priority.label}`"
        />
      </div>
      <h3 class="card__title">{{ task.title }}</h3>
    </div>

    <footer class="card__footer">
      <AvatarBadge :staff="assignee" :size="24" />
      <span class="card__assignee">
        {{ assignee?.fullName ?? 'Не назначено' }}
      </span>
      <span class="card__spacer" />

      <button
        class="tk-tap card__step"
        :disabled="!canGoBack"
        title="Вернуть на шаг назад"
        @click="emit('move', -1)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M14.5 5.5L8 12l6.5 6.5" />
        </svg>
      </button>
      <button
        class="tk-tap card__step"
        :disabled="!canGoForward"
        title="Продвинуть на шаг вперёд"
        @click="emit('move', 1)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M9.5 5.5L16 12l-6.5 6.5" />
        </svg>
      </button>
    </footer>
  </article>
</template>

<style scoped>
.card {
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  padding: 11px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  transition:
    border-color 0.16s,
    opacity 0.16s;
}

.card--draggable {
  cursor: grab;
}

.card--draggable:active {
  cursor: grabbing;
}

/* Перетаскиваемая карточка остаётся на месте приглушённой,
   чтобы было видно, откуда она уходит. */
.card--dragging {
  opacity: 0.4;
  border-color: var(--accent-border);
}

.card__body {
  display: flex;
  flex-direction: column;
  gap: 7px;
  text-align: left;
  width: 100%;
  padding: 0;
  border-radius: var(--r-sm);
}

/* При перетаскивании браузер иначе начинает выделять и тянуть текст
   вместо самой карточки. */
.card--draggable .card__body,
.card--draggable .card__footer {
  user-select: none;
}

.card__meta {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
}

.card__code {
  font-size: 10.5px;
  font-weight: 700;
  color: rgba(233, 233, 237, 0.35);
  white-space: nowrap;
}

.card__spacer {
  flex: 1;
}

.card__priority {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
}

.card__title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.35;
  margin: 0;
  text-wrap: pretty;
}

.card__footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card__assignee {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-40);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 110px;
}

.card__step {
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: var(--r-sm);
  border: 1px solid rgba(255, 255, 255, 0.09);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-70);
}

.card__step:disabled {
  opacity: 0.25;
  cursor: default;
}

.card__step:disabled:hover {
  background: transparent;
}

.card__step svg {
  width: 11px;
  height: 11px;
}

/*
  На тач-устройствах перетаскивание недоступно — HTML5 drag & drop
  на них не работает. Стрелки становятся основным способом двигать
  задачу, поэтому увеличиваем их до пригодного для пальца размера.
*/
@media (pointer: coarse) {
  .card {
    padding: 13px 14px 12px;
  }

  .card__step {
    width: 36px;
    height: 36px;
  }

  .card__step svg {
    width: 14px;
    height: 14px;
  }

  .card__title {
    font-size: 14.5px;
  }
}
</style>
