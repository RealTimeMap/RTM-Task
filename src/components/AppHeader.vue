<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import { useTasksStore } from '../stores/tasks'
import { STATUS_TITLES, STATUS_TONES, pluralTasks } from '../lib/presentation'
import type { TaskStatus } from '../types/task'

const emit = defineEmits<{ menu: [] }>()

const tasks = useTasksStore()
const { scope, view, query, statusFilter, visible, total, completedCount, connection } =
  storeToRefs(tasks)

const title = computed(() => {
  if (view.value === 'list') return 'Список задач'
  return scope.value === 'mine' ? 'Мои задачи' : 'Все задачи'
})

const subtitle = computed(() => {
  const count = visible.value.length
  const base = `${count} ${pluralTasks(count)}`

  if (scope.value === 'mine') {
    return `${base} · ${completedCount.value} завершено`
  }
  return `${base} из ${total.value}`
})

const statusOptions = computed(() => {
  const statuses: (TaskStatus | 'all')[] = ['all', 'working', 'review', 'complete']

  return statuses.map((key) => ({
    key,
    label: key === 'all' ? 'Все' : STATUS_TITLES[key],
    dot: key === 'all' ? 'rgba(255,255,255,.25)' : STATUS_TONES[key].dot,
  }))
})

/** Индикатор живого соединения — видно, приходят ли обновления. */
const connectionTone = computed(() => {
  switch (connection.value) {
    case 'connected':
      return { color: 'var(--success)', title: 'Обновления приходят в реальном времени' }
    case 'connecting':
      return { color: 'var(--warning)', title: 'Подключение к серверу событий…' }
    case 'error':
      return { color: 'var(--danger)', title: 'Нет соединения с сервером событий' }
    default:
      return { color: 'var(--ink-30)', title: 'Соединение не установлено' }
  }
})
</script>

<template>
  <header class="header">
    <button class="tk-tap header__menu" title="Меню" @click="emit('menu')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>

    <div class="header__titles">
      <h1 class="header__title">{{ title }}</h1>
      <div class="header__subtitle">{{ subtitle }}</div>
    </div>

    <span
      class="header__pulse"
      :style="{ background: connectionTone.color }"
      :title="connectionTone.title"
    />

    <div class="header__spacer" />

    <label class="search">
      <svg viewBox="0 0 24 24" fill="none" stroke="rgba(233,233,237,.5)" stroke-width="1.8">
        <circle cx="11" cy="11" r="6.4" />
        <path d="M15.8 15.8L20 20" />
      </svg>
      <input
        v-model="query"
        type="search"
        placeholder="Поиск задач, RTM-12…"
        aria-label="Поиск задач"
      />
    </label>

    <div class="tk-scroll filters" role="group" aria-label="Фильтр по статусу">
      <button
        v-for="option in statusOptions"
        :key="option.key"
        class="tk-tap tk-plain filter"
        :class="{ 'filter--active': statusFilter === option.key }"
        :aria-pressed="statusFilter === option.key"
        @click="tasks.statusFilter = option.key"
      >
        <span class="filter__dot" :style="{ background: option.dot }" />
        {{ option.label }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 60px;
  flex: none;
  padding: 0 28px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-panel);
  /* Шапка липкая: при длинном списке задач поиск и фильтры
     остаются под рукой. */
  position: sticky;
  top: 0;
  z-index: 10;
}

.header__titles {
  flex: none;
  white-space: nowrap;
}

.header__title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
}

.header__subtitle {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-40);
  margin-top: 1px;
}

.header__pulse {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  align-self: center;
}

.header__spacer {
  flex: 1;
}

.search {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 38px;
  padding: 0 13px;
  width: 264px;
  flex: none;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid var(--line-strong);
  border-radius: 11px;
}

.search:focus-within {
  border-color: var(--accent-border);
}

.search svg {
  width: 15px;
  height: 15px;
  flex: none;
}

.search input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--ink);
  font-size: 13px;
}

.search input::-webkit-search-cancel-button {
  appearance: none;
}

.filters {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  overflow-x: auto;
  padding-bottom: 2px;
}

.filter {
  flex: none;
  height: 38px;
  padding: 0 12px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  color: rgba(233, 233, 237, 0.68);
}

.filter--active {
  background: var(--accent-bg-strong);
  border-color: var(--accent-border);
  color: var(--accent-ink);
}

.filter__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.header__menu {
  display: none;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: var(--r-md);
  align-items: center;
  justify-content: center;
  color: var(--ink-70);
}

.header__menu svg {
  width: 18px;
  height: 18px;
}

@media (max-width: 1000px) {
  .header {
    padding: 0 16px;
    gap: 10px;
  }

  .search {
    width: 190px;
  }
}

/* На телефоне шапка становится двухъярусной: сверху заголовок и поиск,
   снизу фильтры — в одну строку они не помещаются. */
@media (max-width: 720px) {
  .header {
    height: auto;
    flex-wrap: wrap;
    align-items: center;
    padding: 10px 12px;
    gap: 10px;
    row-gap: 8px;
  }

  .header__menu {
    display: flex;
  }

  .header__titles {
    flex: 1;
    min-width: 0;
  }

  .header__title {
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header__subtitle {
    display: none;
  }

  .header__spacer {
    display: none;
  }

  /* Поиск и фильтры переносятся на второй ряд во всю ширину. */
  .search {
    order: 3;
    width: 100%;
    height: 40px;
  }

  .filters {
    order: 4;
    width: 100%;
    /* Обрезка ряда фильтров краем экрана — подсказка,
       что его можно листать. */
    margin: 0 -12px;
    padding: 0 12px 2px;
  }

  .filter {
    height: 36px;
  }
}

/* Цели под палец. Высота фильтров задаётся только здесь, чтобы она
   не спорила с компактной раскладкой узкого экрана. */
@media (pointer: coarse) {
  .header__menu {
    width: 42px;
    height: 42px;
  }

  .search {
    height: 44px;
  }

  .filter {
    height: 40px;
    padding: 0 14px;
  }
}
</style>
