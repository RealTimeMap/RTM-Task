<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import AvatarBadge from './ui/AvatarBadge.vue'
import { useSessionStore } from '../stores/session'
import { useTasksStore, type ScopeMode, type ViewMode } from '../stores/tasks'
import { TYPE_ORDER, TYPE_TITLES, TYPE_TONES } from '../lib/presentation'
import { ROLE_LABELS } from '../types/staff'
import type { TaskType } from '../types/task'

withDefaults(defineProps<{ open?: boolean }>(), { open: false })

const emit = defineEmits<{ create: []; close: [] }>()

const session = useSessionStore()
const tasks = useTasksStore()
const { staff, permissions } = storeToRefs(session)
const { scope, view, typeFilter, typeCounts } = storeToRefs(tasks)

interface ViewOption {
  key: string
  label: string
  scope: ScopeMode
  view: ViewMode
}

const viewOptions: ViewOption[] = [
  { key: 'mine', label: 'Мои задачи', scope: 'mine', view: 'board' },
  { key: 'all', label: 'Все задачи', scope: 'all', view: 'board' },
  { key: 'list', label: 'Список задач', scope: 'all', view: 'list' },
]

const activeView = computed(() => {
  if (view.value === 'list') return 'list'
  return scope.value === 'mine' ? 'mine' : 'all'
})

async function pickView(option: ViewOption): Promise<void> {
  tasks.view = option.view
  await tasks.setScope(option.scope)
  // На телефоне меню перекрывает контент — после выбора его надо убрать.
  emit('close')
}

const typeOptions = computed(() => {
  const types: (TaskType | 'all')[] = ['all', ...TYPE_ORDER]

  return types.map((key) => ({
    key,
    label: key === 'all' ? 'Все типы' : TYPE_TITLES[key],
    count: typeCounts.value[key] ?? 0,
    dot: key === 'all' ? 'rgba(255,255,255,.2)' : TYPE_TONES[key].dot,
  }))
})

const roleLabel = computed(() => (staff.value ? ROLE_LABELS[staff.value.role] : ''))
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--open': open }">
    <header class="brand">
      <div class="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9">
          <path d="M5 12.6l3.4 3.4L19 5.4" />
          <path d="M5 19h9" />
        </svg>
      </div>
      <div class="brand__text">
        <div class="brand__name">RealTimeMap</div>
        <div class="brand__section">ЗАДАЧИ</div>
      </div>

      <button class="tk-tap brand__close" title="Закрыть меню" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </header>

    <div class="tk-scroll sidebar__body">
      <nav aria-label="Представление">
        <div class="group-title">ВИД</div>
        <div class="group">
          <button
            v-for="option in viewOptions"
            :key="option.key"
            class="tk-tap tk-plain nav-item"
            :class="{ 'nav-item--active': activeView === option.key }"
            :aria-current="activeView === option.key ? 'page' : undefined"
            @click="pickView(option)"
          >
            <span class="nav-item__dot" />
            <span class="nav-item__label">{{ option.label }}</span>
          </button>
        </div>
      </nav>

      <nav aria-label="Фильтр по типу">
        <div class="group-title">ТИП</div>
        <div class="group">
          <button
            v-for="option in typeOptions"
            :key="option.key"
            class="tk-tap tk-plain type-item"
            :class="{ 'type-item--active': typeFilter === option.key }"
            :aria-pressed="typeFilter === option.key"
            @click="tasks.typeFilter = option.key"
          >
            <span class="type-item__dot" :style="{ background: option.dot }" />
            <span class="type-item__label">{{ option.label }}</span>
            <span class="type-item__count">{{ option.count }}</span>
          </button>
        </div>
      </nav>
    </div>

    <footer class="sidebar__footer">
      <div class="user">
        <AvatarBadge :staff="staff" :size="32" />
        <div class="user__info">
          <div class="user__name">{{ staff?.fullName ?? '—' }}</div>
          <div class="user__role">
            <span class="user__status" />
            <span>{{ roleLabel }}</span>
          </div>
        </div>
        <button class="tk-tap user__exit" title="Выйти" @click="session.signOut()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
            <path d="M15 12H4M8 8l-4 4 4 4" />
            <path d="M13 4h6v16h-6" />
          </svg>
        </button>
      </div>

      <button
        v-if="permissions.canCreate"
        class="tk-tap tk-plain create-button"
        @click="emit('create')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span class="create-button-text">Новая задача</span>
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 240px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-right: 1px solid var(--line);
}

@media (max-width: 1000px) {
  .sidebar {
    width: 200px;
  }
}

/* Кнопка закрытия нужна только выехавшему меню. */
.brand__text {
  min-width: 0;
}

.brand__close {
  display: none;
  width: 32px;
  height: 32px;
  flex: none;
  margin-left: auto;
  border-radius: var(--r-md);
  align-items: center;
  justify-content: center;
  color: var(--ink-60);
}

.brand__close svg {
  width: 15px;
  height: 15px;
}

/* На телефоне сайдбар — выдвижная панель поверх контента: постоянная
   колонка съела бы половину экрана, а полоска с иконками не оставляет
   места подписям. */
@media (max-width: 720px) {
  .sidebar {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 26;
    width: 82vw;
    max-width: 300px;
    transform: translateX(-100%);
    transition: transform 0.22s cubic-bezier(0.22, 0.9, 0.24, 1);
    box-shadow: 24px 0 60px rgba(0, 0, 0, 0.55);
  }

  .sidebar--open {
    transform: translateX(0);
  }

  .brand__close {
    display: flex;
  }

  /* Меню выезжает от края экрана — учитываем вырез и домашнюю полосу. */
  .brand {
    padding-left: max(18px, env(safe-area-inset-left));
  }

  .sidebar__body {
    padding-left: max(10px, env(safe-area-inset-left));
  }

  .sidebar__footer {
    padding-left: max(12px, env(safe-area-inset-left));
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }

  /* Пункты крупнее: под палец нужна цель хотя бы 44px. */
  .nav-item {
    height: 46px;
  }

  .type-item {
    height: 44px;
  }

  .create-button {
    height: 48px;
  }
}

/* Цели под палец: кнопки закрытия меню и выхода нажимаются наравне
   с пунктами навигации. */
@media (pointer: coarse) {
  .brand__close {
    width: 40px;
    height: 40px;
  }

  .user__exit {
    width: 40px;
    height: 40px;
  }

  .user__exit svg {
    width: 16px;
    height: 16px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar {
    transition: none;
  }
}

.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 20px 18px 18px;
}

.brand__mark {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 11px;
  background: var(--accent-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand__mark svg {
  width: 18px;
  height: 18px;
}

.brand__name {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.brand__section {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(233, 233, 237, 0.38);
  margin-top: 1px;
}

.sidebar__body {
  flex: 1;
  overflow: auto;
  padding: 4px 10px;
}

.group-title {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--ink-30);
  padding: 0 8px 7px;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 14px;
}

.nav-item,
.type-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border-radius: var(--r-md);
  background: transparent;
  color: rgba(233, 233, 237, 0.65);
  text-align: left;
  width: 100%;
}

.nav-item {
  height: 38px;
}

.type-item {
  height: 36px;
}

.nav-item--active,
.type-item--active {
  background: var(--accent-bg);
  color: var(--accent-ink);
}

.nav-item__dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
}

.nav-item--active .nav-item__dot {
  background: var(--accent);
}

.nav-item__label {
  flex: 1;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
}

.type-item__dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 2px;
}

.type-item__label {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.type-item__count {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-40);
}

.sidebar__footer {
  padding: 12px;
  border-top: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.user {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 2px 4px;
}

.user__info {
  flex: 1;
  min-width: 0;
}

.user__name {
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user__role {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  font-size: 10.5px;
  font-weight: 600;
  color: rgba(233, 233, 237, 0.42);
  white-space: nowrap;
}

.user__status {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--success);
}

.user__exit {
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-45);
}

.user__exit svg {
  width: 14px;
  height: 14px;
}

.create-button {
  height: 42px;
  border-radius: 11px;
  background: var(--accent-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: #fff;
  box-shadow: var(--accent-shadow);
}

.create-button svg {
  width: 16px;
  height: 16px;
}
</style>
