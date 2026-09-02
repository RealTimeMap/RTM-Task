<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'

import AppHeader from './components/AppHeader.vue'
import AppSidebar from './components/AppSidebar.vue'
import CreateTaskModal from './components/CreateTaskModal.vue'
import LoginScreen from './components/LoginScreen.vue'
import TaskBoard from './components/TaskBoard.vue'
import TaskDialog from './components/TaskDialog.vue'
import TaskList from './components/TaskList.vue'
import ToastBar from './components/ui/ToastBar.vue'
import { useDiscussionStore } from './stores/discussion'
import { useSessionStore } from './stores/session'
import { useTasksStore } from './stores/tasks'

const session = useSessionStore()
const tasks = useTasksStore()
const discussion = useDiscussionStore()

const { isAuthenticated, failure } = storeToRefs(session)
const { view, loading, error } = storeToRefs(tasks)

const createOpen = ref(false)
const booting = ref(true)

/** Поднимает realtime и список задач для вошедшего сотрудника. */
async function startWorkspace(staffId: number): Promise<void> {
  tasks.connect(staffId)
  // Подписка на обсуждение вешается на тот же сокет — после connect,
  // иначе подписываться было бы не на что.
  discussion.subscribe()
  await tasks.load()
}

onMounted(async () => {
  // Токен мог сохраниться с прошлого визита — тогда вход не нужен.
  if (await session.load()) {
    await startWorkspace(session.staffId!)
  }
  booting.value = false
})

// Появление сотрудника — это успешный вход; исчезновение — выход или
// протухший токен. Оба перехода обслуживаются здесь, чтобы форма входа
// не знала о задачах, а стор задач — о способе аутентификации.
watch(
  () => session.staffId,
  async (staffId, previous) => {
    if (previous !== null) {
      discussion.close()
      tasks.disconnect()
    }
    if (staffId !== null) {
      await startWorkspace(staffId)
    }
  },
)

onBeforeUnmount(() => {
  tasks.disconnect()
})

function openCreate(): void {
  createOpen.value = true
  menuOpen.value = false
}

/**
 * На телефоне сайдбар выезжает поверх контента: постоянная колонка
 * съела бы половину экрана.
 */
const menuOpen = ref(false)
</script>

<template>
  <LoginScreen v-if="!booting && !isAuthenticated" :failure="failure ?? 'unauthorized'" />

  <div v-else-if="isAuthenticated" class="page">
    <div class="shell">
      <AppSidebar :open="menuOpen" @create="openCreate" @close="menuOpen = false" />

      <!-- Затемнение под выехавшим меню: заодно закрывает его по тапу. -->
      <div v-if="menuOpen" class="menu-scrim" @click="menuOpen = false" />

      <main class="main">
        <AppHeader @menu="menuOpen = true" />

        <div class="tk-scroll content">
          <p v-if="error" class="banner" @click="tasks.clearError()">
            {{ error }}
          </p>

          <p v-if="loading" class="hint">Загружаем задачи…</p>

          <template v-else>
            <TaskBoard v-if="view === 'board'" @create="openCreate" />
            <TaskList v-else />
          </template>
        </div>
      </main>

      <TaskDialog />
      <CreateTaskModal :open="createOpen" @close="createOpen = false" />
      <ToastBar />
    </div>
  </div>
</template>

<style scoped>
/* Приложение занимает всё окно: обрамление «карточки» из макета
   там было нужно, чтобы показать мокап на подложке, а живому сайту
   мешает — съедает высоту и упирает контент в 1440px. */
.page {
  height: 100dvh;
  background: var(--bg-shell);
}

.shell {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  overflow: hidden;
  color: var(--ink);
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.content {
  flex: 1;
  overflow: auto;
  padding: 20px 28px 28px;
}

.banner {
  background: var(--danger-bg);
  border: 1px solid rgba(229, 72, 77, 0.3);
  color: var(--danger-ink);
  border-radius: var(--r-lg);
  padding: 11px 14px;
  font-size: 12.5px;
  font-weight: 600;
  margin: 0 0 14px;
  cursor: pointer;
}

.hint {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-45);
  padding: 40px 0;
  text-align: center;
  margin: 0;
}

.menu-scrim {
  position: absolute;
  inset: 0;
  z-index: 25;
  background: rgba(4, 5, 8, 0.6);
  animation: tkFade 0.16s ease both;
}

@media (max-width: 1000px) {
  .content {
    padding: 16px 18px 22px;
  }
}

@media (max-width: 720px) {
  .content {
    /* Отступы учитывают вырез и домашнюю полосу: на весь экран
       раскрытый интерфейс иначе упирается прямо в них. */
    padding: 12px max(12px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom))
      max(12px, env(safe-area-inset-left));
  }
}
</style>
