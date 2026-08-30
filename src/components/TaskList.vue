<script setup lang="ts">
import { storeToRefs } from 'pinia'

import AvatarBadge from './ui/AvatarBadge.vue'
import TagChip from './ui/TagChip.vue'
import { useSessionStore } from '../stores/session'
import { useTasksStore } from '../stores/tasks'
import {
  STATUS_TONES,
  TYPE_TONES,
  priorityTone,
  shortDate,
  taskCode,
} from '../lib/presentation'

const tasks = useTasksStore()
const session = useSessionStore()
const { visible } = storeToRefs(tasks)
</script>

<template>
  <div class="tk-fade table">
    <div class="table__head" role="row">
      <span>ID</span>
      <span>ЗАДАЧА</span>
      <span>ТИП</span>
      <span>ИСПОЛНИТЕЛЬ</span>
      <span>СТАТУС</span>
      <span>ПРИОРИТЕТ</span>
      <span class="table__right">СОЗДАНА</span>
    </div>

    <button
      v-for="task in visible"
      :key="task.id"
      class="tk-row tk-tap tk-plain table__row"
      @click="tasks.select(task.id)"
    >
      <span class="table__code">{{ taskCode(task.id) }}</span>
      <span class="table__title">{{ task.title }}</span>

      <TagChip
        class="table__type"
        :label="TYPE_TONES[task.type].label"
        :ink="TYPE_TONES[task.type].ink"
        :bg="TYPE_TONES[task.type].bg"
      />

      <span class="table__assignee">
        <AvatarBadge :staff="session.memberById(task.assigneeId)" :size="24" />
        <span class="table__assignee-name">
          {{ session.memberById(task.assigneeId)?.fullName ?? 'Не назначено' }}
        </span>
      </span>

      <TagChip
        class="table__status"
        :label="STATUS_TONES[task.status].label"
        :ink="STATUS_TONES[task.status].ink"
        :bg="STATUS_TONES[task.status].bg"
      />

      <span class="table__priority">
        <span class="table__dot" :style="{ background: priorityTone(task.priority).dot }" />
        <span>{{ priorityTone(task.priority).short }}</span>
      </span>

      <span class="table__date">{{ shortDate(task.createdAt) }}</span>
    </button>

    <div v-if="visible.length === 0" class="table__empty">
      <p class="table__empty-title">Ничего не найдено</p>
      <p class="table__empty-hint">Сбросьте фильтры или измените запрос</p>
    </div>
  </div>
</template>

<style scoped>
.table {
  width: 100%;
  background: var(--fill-softer);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: var(--r-xl);
  overflow: hidden;
}

/* Планшет и небольшой десктоп: семь колонок уже не помещаются, но
   карточная раскладка ещё избыточна — таблица уезжает в горизонтальную
   прокрутку.

   Верхняя граница 1200, а не 1000: при 1024px вместе с сайдбаром на
   таблицу остаётся ~730px, и без прокрутки строки бы разъехались.
   Нижняя нужна, чтобы min-width не протёк в мобильную раскладку
   и не растянул карточки на 900px. */
@media (min-width: 721px) and (max-width: 1200px) {
  .table {
    overflow-x: auto;
  }

  .table__head,
  .table__row {
    min-width: 900px;
  }
}

/*
  На телефоне горизонтальная прокрутка таблицы нечитаема, поэтому
  строки превращаются в карточки: заголовок сверху, метки и
  исполнитель — под ним.
*/
@media (max-width: 720px) {
  .table {
    background: transparent;
    border: 0;
    border-radius: 0;
    overflow: visible;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .table__head {
    display: none;
  }

  .table__row {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas:
      'code    title'
      'type    status'
      'people  people';
    align-items: center;
    gap: 8px 10px;
    min-width: 0;
    padding: 13px 14px;
    background: var(--fill-soft);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-lg);
  }

  .table__code {
    grid-area: code;
  }

  .table__title {
    grid-area: title;
    white-space: normal;
    font-size: 14px;
    line-height: 1.35;
  }

  /* :deep — классы висят на корне дочернего компонента,
     обычный scoped-селектор до них не достаёт. */
  .table :deep(.table__type) {
    grid-area: type;
    justify-self: start;
  }

  .table :deep(.table__status) {
    grid-area: status;
    justify-self: start;
  }

  .table__assignee {
    grid-area: people;
  }

  /* Приоритет и дата в мобильной карточке избыточны — они видны
     в панели деталей. */
  .table__priority,
  .table__date {
    display: none;
  }
}

.table__head,
.table__row {
  display: grid;
  grid-template-columns:
    82px minmax(240px, 1.6fr) minmax(96px, 0.6fr) minmax(140px, 0.8fr)
    minmax(124px, 0.7fr) minmax(96px, 0.5fr) 84px;
  align-items: center;
  gap: 10px;
}

.table__head {
  padding: 11px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(233, 233, 237, 0.42);
  white-space: nowrap;
}

.table__row {
  width: 100%;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.045);
  text-align: left;
}

.table__code {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ink-45);
  white-space: nowrap;
}

.table__title {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table__assignee {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.table__assignee-name {
  font-size: 12.5px;
  font-weight: 600;
  color: rgba(233, 233, 237, 0.75);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table__priority {
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: rgba(233, 233, 237, 0.72);
}

.table__dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
}

.table__date {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-60);
  text-align: right;
  white-space: nowrap;
}

.table__right {
  text-align: right;
}

.table__empty {
  padding: 44px 16px;
  text-align: center;
}

.table__empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-60);
  margin: 0;
}

.table__empty-hint {
  font-size: 12px;
  font-weight: 500;
  color: rgba(233, 233, 237, 0.38);
  margin: 4px 0 0;
}
</style>
