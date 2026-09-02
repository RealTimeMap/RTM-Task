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
import type { SortField } from '../types/task'

const tasks = useTasksStore()
const session = useSessionStore()
const { visible, sort } = storeToRefs(tasks)

/**
 * Заголовки таблицы. Сортируемые несут поле — по нему строится
 * кнопка; остальные остаются подписями.
 *
 * Исполнителя и название сортировать нельзя: сервер такого порядка
 * не поддерживает, а сортировать одну загруженную страницу на клиенте
 * значило бы врать при пагинации.
 */
const columns: { label: string; field?: SortField; right?: boolean }[] = [
  { label: 'ID' },
  { label: 'ЗАДАЧА' },
  { label: 'ТИП', field: 'type' },
  { label: 'ИСПОЛНИТЕЛЬ' },
  { label: 'СТАТУС', field: 'status' },
  { label: 'ПРИОРИТЕТ', field: 'priority' },
  { label: 'СОЗДАНА', field: 'createdAt', right: true },
]

/** Поля сортировки для выпадающего списка на узком экране. */
const sortOptions: { field: SortField; label: string }[] = [
  { field: 'priority', label: 'Приоритет' },
  { field: 'status', label: 'Статус' },
  { field: 'type', label: 'Тип' },
  { field: 'createdAt', label: 'Дата создания' },
]

function pickSort(event: Event): void {
  tasks.setSort((event.target as HTMLSelectElement).value as SortField)
}

function toggleOrder(): void {
  tasks.setSort(sort.value.field, sort.value.order === 'asc' ? 'desc' : 'asc')
}
</script>

<template>
  <div class="tk-fade table">
    <div class="table__head" role="row">
      <template v-for="column in columns" :key="column.label">
        <button
          v-if="column.field"
          type="button"
          class="tk-plain sorter"
          :class="{ 'sorter--active': sort.field === column.field, 'sorter--right': column.right }"
          :aria-sort="
            sort.field === column.field
              ? sort.order === 'asc'
                ? 'ascending'
                : 'descending'
              : 'none'
          "
          @click="tasks.setSort(column.field)"
        >
          {{ column.label }}
          <!-- Стрелка только у активной колонки: значок на каждой
               превратил бы шапку в частокол. -->
          <svg
            v-if="sort.field === column.field"
            class="sorter__arrow"
            :class="{ 'sorter__arrow--desc': sort.order === 'desc' }"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.6"
          >
            <path d="M12 5v14M6.5 11.5L12 6l5.5 5.5" />
          </svg>
        </button>
        <span v-else :class="{ 'table__right': column.right }">{{ column.label }}</span>
      </template>
    </div>

    <!-- На узком экране шапка скрыта, а строки становятся карточками —
         сортировать кликом по колонке там негде. -->
    <div class="sortbar">
      <span class="sortbar__label">Сортировка</span>
      <select class="sortbar__select" :value="sort.field" @change="pickSort">
        <option v-for="option in sortOptions" :key="option.field" :value="option.field">
          {{ option.label }}
        </option>
      </select>
      <button
        type="button"
        class="tk-tap tk-plain sortbar__order"
        :title="sort.order === 'asc' ? 'По возрастанию' : 'По убыванию'"
        @click="toggleOrder"
      >
        <svg
          class="sorter__arrow"
          :class="{ 'sorter__arrow--desc': sort.order === 'desc' }"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.6"
        >
          <path d="M12 5v14M6.5 11.5L12 6l5.5 5.5" />
        </svg>
      </button>
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

/* Заголовок-кнопка: выглядит как подпись, но кликается и несёт стрелку
   направления. Только у сортируемых колонок — по названию и исполнителю
   сервер порядок не строит. */
.sorter {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
  white-space: nowrap;
}

.sorter:hover {
  color: rgba(233, 233, 237, 0.75);
}

.sorter--active {
  color: var(--accent-ink);
}

.sorter--right {
  justify-content: flex-end;
}

.sorter__arrow {
  width: 11px;
  height: 11px;
  flex: none;
  transition: transform 0.16s;
}

.sorter__arrow--desc {
  transform: rotate(180deg);
}

/* На широком экране сортировку задаёт шапка таблицы — панель не нужна. */
.sortbar {
  display: none;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.sortbar__label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--ink-45);
}

.sortbar__select {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 8px;
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 600;
  outline: none;
}

.sortbar__select:focus {
  border-color: var(--accent-border);
}

.sortbar__order {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: var(--r-md);
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-70);
}

@media (pointer: coarse) {
  .sortbar__select,
  .sortbar__order {
    height: 42px;
  }

  .sortbar__order {
    width: 42px;
  }
}

/* Планшет и небольшой десктоп: семь колонок уже не помещаются, но
   карточная раскладка ещё избыточна — таблица уезжает в горизонтальную
   прокрутку.

   Порог 1200: ниже него семи колонкам не хватает места даже с учётом
   сайдбара (на 1024px таблице остаётся ~730px из нужных 900), и строки
   разъезжались бы. Горизонтальная прокрутка вместо этого читается плохо,
   поэтому строки становятся карточками — как на телефоне, но в две
   колонки и со всеми полями: места здесь хватает. */
@media (max-width: 1200px) {
  .table {
    background: transparent;
    border: 0;
    border-radius: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 10px;
  }

  .table__head {
    display: none;
  }

  /* Кликать по колонкам больше негде — показываем выбор списком.
     Растягиваем на всю ширину сетки, чтобы он не встал карточкой
     в один ряд с задачами. */
  .sortbar {
    display: flex;
    grid-column: 1 / -1;
  }

  .table__row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'code   title   date'
      'type   status  prio'
      'people people  people';
    align-items: center;
    gap: 8px 10px;
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

  .table__priority {
    grid-area: prio;
    justify-self: end;
  }

  .table__date {
    grid-area: date;
  }
}

/*
  Телефон: та же карточная раскладка, но в один столбец и без
  второстепенных полей — ширины на них уже не хватает.
*/
@media (max-width: 720px) {
  /* Одна карточка в ряд: на телефоне на две не хватает ширины. */
  .table {
    grid-template-columns: 1fr;
  }

  .table__row {
    grid-template-columns: auto 1fr;
    grid-template-areas:
      'code    title'
      'type    status'
      'people  people';
  }

  /* Приоритет и дата в мобильной карточке избыточны — они видны
     в окне задачи, а место дороже. */
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
