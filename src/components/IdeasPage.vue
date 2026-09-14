<script setup lang="ts">
/**
 * Копилка идей — замыслы по проекту, которые стоит обдумать.
 *
 * Устроена как список с карточкой подробностей сбоку — тем же приёмом,
 * что и страница багов: по идее нужно не только увидеть заголовок, но
 * и прочитать описание с обсуждением, а открывать ради этого модальное
 * окно поверх списка значило бы терять из виду остальные.
 */

import { computed, nextTick, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'

import AvatarBadge from './ui/AvatarBadge.vue'
import IdeaComments from './IdeaComments.vue'
import MarkdownEditor from './ui/MarkdownEditor.vue'
import MarkdownText from './ui/MarkdownText.vue'
import { useIdeasStore, type IdeaScope } from '../stores/ideas'
import { useSessionStore } from '../stores/session'
import { useToastStore } from '../stores/toast'
import { isNarrowScreen, shortDate, shortTime } from '../lib/presentation'
import { MAX_IDEA_TITLE, isValidIdeaTitle, type Idea } from '../types/idea'

const ideas = useIdeasStore()
const session = useSessionStore()
const toast = useToastStore()

const { visible, selected, loading, error, query, scope, openCount, doneCount } =
  storeToRefs(ideas)
const { permissions, staff } = storeToRefs(session)

onMounted(() => {
  void ideas.ensureLoaded()
})

/** Может ли текущий сотрудник заводить и отмечать идеи. */
const canWrite = computed(() => permissions.value.canCreate)

const scopeOptions: { key: IdeaScope; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'open', label: 'Не сделано' },
  { key: 'done', label: 'Сделано' },
]

function scopeCount(key: IdeaScope): number {
  if (key === 'open') return openCount.value
  if (key === 'done') return doneCount.value
  return ideas.items.length
}

/**
 * Узкий ли экран.
 *
 * На широком карточка стоит рядом со списком, поэтому повторный
 * щелчок по идее её закрывает. На телефоне она разворачивается поверх
 * списка — там закрывать нечем, кроме кнопки.
 */
const narrow = ref(isNarrowScreen())

function pick(idea: Idea): void {
  if (ideas.selectedId === idea.id && !narrow.value) {
    void ideas.select(null)
    return
  }
  void ideas.select(idea.id)
}

// --- Заведение новой идеи --------------------------------------------

const composing = ref(false)
const newTitle = ref('')
const newDescription = ref('')
const creating = ref(false)
const titleInput = ref<HTMLInputElement | null>(null)

const canCreate = computed(() => isValidIdeaTitle(newTitle.value) && !creating.value)

async function startCompose(): Promise<void> {
  composing.value = true
  await nextTick()
  titleInput.value?.focus()
}

function cancelCompose(): void {
  composing.value = false
  newTitle.value = ''
  newDescription.value = ''
}

async function submit(): Promise<void> {
  if (!canCreate.value) return

  creating.value = true
  try {
    const created = await ideas.create({
      title: newTitle.value.trim(),
      description: newDescription.value.trim() || undefined,
    })

    if (created) {
      cancelCompose()
      toast.show('Идея записана')
      // Открываем её сразу: человек только что сформулировал замысел,
      // и продолжение мысли чаще всего уходит в обсуждение.
      void ideas.select(created.id)
    }
  } finally {
    creating.value = false
  }
}

// --- Правка открытой идеи ---------------------------------------------

const editing = ref(false)
const editTitle = ref('')
const editDescription = ref('')
const savingEdit = ref(false)

/** Текст правит автор, чужой — только управляющая роль. */
const canEditSelected = computed(() => {
  const idea = selected.value
  if (!idea || !canWrite.value) return false
  return idea.authorId === staff.value?.id || permissions.value.canAssignAnyone
})

function startEdit(): void {
  const idea = selected.value
  if (!idea) return

  editTitle.value = idea.title
  editDescription.value = idea.description ?? ''
  editing.value = true
}

function cancelEdit(): void {
  editing.value = false
}

async function saveEdit(): Promise<void> {
  const idea = selected.value
  if (!idea || !isValidIdeaTitle(editTitle.value)) return

  savingEdit.value = true
  try {
    const updated = await ideas.update(idea.id, {
      title: editTitle.value.trim(),
      description: editDescription.value.trim(),
    })
    if (updated) {
      editing.value = false
      toast.show('Идея обновлена')
    }
  } finally {
    savingEdit.value = false
  }
}

/** Отмечает идею сделанной или возвращает в работу. */
async function toggleDone(idea: Idea, event?: Event): Promise<void> {
  // Щелчок по отметке не должен заодно открывать карточку: это два
  // разных намерения, и попасть в галочку мимо карточки невозможно.
  event?.stopPropagation()
  if (!canWrite.value) return

  const updated = await ideas.toggleDone(idea.id)
  if (updated) {
    toast.show(updated.done ? 'Идея отмечена сделанной' : 'Идея снова в работе')
  }
}

/** Удаляет идею: свою — автор, любую — управляющая роль. */
const canDeleteSelected = computed(() => {
  const idea = selected.value
  if (!idea) return false
  return idea.authorId === staff.value?.id || permissions.value.canDelete
})

const confirmingDelete = ref(false)

async function remove(): Promise<void> {
  const idea = selected.value
  if (!idea) return

  if (await ideas.removeIdea(idea.id)) {
    confirmingDelete.value = false
    toast.show('Идея удалена')
  }
}

function authorName(authorId: number): string {
  return session.memberById(authorId)?.fullName ?? `#${authorId}`
}

/** «23 авг., 14:05» — когда идею записали. */
function stamp(iso: string): string {
  return `${shortDate(iso)}, ${shortTime(iso)}`
}
</script>

<template>
  <div class="tk-fade ideas">
    <div class="ideas__bar">
      <label class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="rgba(233,233,237,.5)" stroke-width="1.8">
          <circle cx="11" cy="11" r="6.4" />
          <path d="M15.8 15.8L20 20" />
        </svg>
        <input
          v-model="query"
          type="search"
          placeholder="Поиск по идеям…"
          aria-label="Поиск идей"
        />
      </label>

      <div class="tk-scroll scopes" role="group" aria-label="Отбор по состоянию">
        <button
          v-for="option in scopeOptions"
          :key="option.key"
          class="tk-tap tk-plain scope"
          :class="{ 'scope--active': scope === option.key }"
          :aria-pressed="scope === option.key"
          @click="ideas.scope = option.key"
        >
          {{ option.label }}
          <span class="scope__count">{{ scopeCount(option.key) }}</span>
        </button>
      </div>

      <div class="ideas__spacer" />

      <button
        v-if="canWrite && !composing"
        class="tk-tap tk-plain add"
        @click="startCompose"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span class="add__text">Новая идея</span>
      </button>
    </div>

    <!-- Форма записи стоит над списком, а не в модальном окне: идею
         записывают на ходу, и окно поверх экрана для двух полей —
         лишний повод передумать. -->
    <form v-if="composing" class="tk-rise compose" @submit.prevent="submit">
      <input
        ref="titleInput"
        v-model="newTitle"
        class="compose__title"
        :maxlength="MAX_IDEA_TITLE"
        placeholder="Например: кэшировать список задач между переходами"
      />

      <MarkdownEditor
        v-model="newDescription"
        :rows="4"
        placeholder="Зачем это нужно и что даст. Поддерживается разметка: **жирный**, `код`, списки"
      />

      <div class="compose__actions">
        <button type="submit" class="tk-tap tk-plain compose__save" :disabled="!canCreate">
          {{ creating ? 'Записываем…' : 'Записать идею' }}
        </button>
        <button type="button" class="tk-plain compose__cancel" @click="cancelCompose">
          Отмена
        </button>
      </div>
    </form>

    <p v-if="error" class="banner" @click="ideas.clearError()">{{ error }}</p>

    <p v-if="loading && !visible.length" class="note">Загружаем идеи…</p>

    <p v-else-if="!visible.length && query.trim()" class="note">
      По запросу «{{ query.trim() }}» ничего не нашлось.
    </p>

    <p v-else-if="!visible.length && scope === 'done'" class="note">
      Сделанных идей пока нет.
    </p>

    <p v-else-if="!visible.length" class="note">
      Идей пока нет. Запишите первую — она не потеряется.
    </p>

    <div v-else class="ideas__body">
      <ul class="tk-scroll list">
        <li v-for="idea in visible" :key="idea.id">
          <div
            class="tk-tap card"
            :class="{ 'card--active': selected?.id === idea.id, 'card--done': idea.done }"
            role="button"
            tabindex="0"
            @click="pick(idea)"
            @keydown.enter="pick(idea)"
            @keydown.space.prevent="pick(idea)"
          >
            <!-- Отметка — самостоятельная цель: закрыть идею можно
                 прямо из списка, не открывая её. -->
            <button
              class="tk-tap check"
              :class="{ 'check--done': idea.done }"
              :disabled="!canWrite"
              :aria-pressed="idea.done"
              :title="idea.done ? 'Вернуть в работу' : 'Отметить сделанной'"
              @click="toggleDone(idea, $event)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6">
                <path d="M5 12.6l3.4 3.4L19 5.4" />
              </svg>
            </button>

            <div class="card__body">
              <span class="card__title">{{ idea.title }}</span>

              <span v-if="idea.description" class="card__desc">{{ idea.description }}</span>

              <span class="card__meta">
                <AvatarBadge :staff="session.memberById(idea.authorId)" :size="18" />
                <span class="card__author">{{ authorName(idea.authorId) }}</span>
                <span class="card__date">{{ shortDate(idea.createdAt) }}</span>

                <span v-if="idea.commentCount" class="card__comments">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
                    <path d="M20 12a7 7 0 01-7 7H8l-4 3v-4.6A7 7 0 018 5h5a7 7 0 017 7z" />
                  </svg>
                  {{ idea.commentCount }}
                </span>
              </span>
            </div>
          </div>
        </li>
      </ul>

      <aside v-if="selected" class="tk-rise detail">
        <header class="detail__head">
          <span class="detail__mark" :class="{ 'detail__mark--done': selected.done }">
            {{ selected.done ? 'СДЕЛАНО' : 'ИДЕЯ' }}
          </span>
          <span class="detail__code">#{{ selected.id }}</span>
          <span class="detail__spacer" />

          <button class="tk-tap detail__close" title="Закрыть" @click="ideas.select(null)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div class="tk-scroll detail__body">
          <template v-if="editing">
            <input
              v-model="editTitle"
              class="compose__title"
              :maxlength="MAX_IDEA_TITLE"
              placeholder="Заголовок идеи"
            />
            <MarkdownEditor v-model="editDescription" :rows="6" placeholder="Описание идеи" />
            <div class="compose__actions">
              <button
                type="button"
                class="tk-tap tk-plain compose__save"
                :disabled="!isValidIdeaTitle(editTitle) || savingEdit"
                @click="saveEdit"
              >
                {{ savingEdit ? 'Сохраняем…' : 'Сохранить' }}
              </button>
              <button type="button" class="tk-plain compose__cancel" @click="cancelEdit">
                Отмена
              </button>
            </div>
          </template>

          <template v-else>
            <h2 class="detail__title" :class="{ 'detail__title--done': selected.done }">
              {{ selected.title }}
            </h2>

            <MarkdownText
              v-if="selected.description"
              :source="selected.description"
              class="detail__desc"
            />
            <p v-else class="detail__desc detail__desc--empty">Описание не заполнено.</p>

            <dl class="facts">
              <div class="facts__row">
                <dt>Автор</dt>
                <dd>{{ authorName(selected.authorId) }}</dd>
              </div>
              <div class="facts__row">
                <dt>Записана</dt>
                <dd>{{ stamp(selected.createdAt) }}</dd>
              </div>
              <div v-if="selected.done && selected.doneAt" class="facts__row">
                <dt>Сделана</dt>
                <dd>
                  {{ stamp(selected.doneAt) }}
                  <template v-if="selected.doneById">
                    · {{ authorName(selected.doneById) }}
                  </template>
                </dd>
              </div>
            </dl>

            <div class="detail__actions">
              <button
                v-if="canWrite"
                class="tk-tap tk-plain detail__done"
                :class="{ 'detail__done--undo': selected.done }"
                @click="toggleDone(selected)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                  <path v-if="selected.done" d="M4 12h16" />
                  <path v-else d="M5 12.6l3.4 3.4L19 5.4" />
                </svg>
                {{ selected.done ? 'Вернуть в работу' : 'Отметить сделанной' }}
              </button>

              <button
                v-if="canEditSelected"
                class="tk-tap tk-plain detail__edit"
                @click="startEdit"
              >
                Изменить
              </button>

              <button
                v-if="canDeleteSelected && !confirmingDelete"
                class="tk-tap tk-plain detail__delete"
                @click="confirmingDelete = true"
              >
                Удалить
              </button>
            </div>

            <!-- Подтверждение прямо в карточке, а не системным окном:
                 браузерный confirm блокирует страницу и выглядит
                 чужеродно, а удаление идеи необратимо. -->
            <div v-if="confirmingDelete" class="confirm">
              <span>Удалить идею вместе с обсуждением?</span>
              <button class="tk-tap tk-plain confirm__yes" @click="remove">Удалить</button>
              <button class="tk-plain confirm__no" @click="confirmingDelete = false">
                Отмена
              </button>
            </div>

            <IdeaComments :idea-id="selected.id" :can-comment="canWrite" />
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.ideas {
  display: flex;
  flex-direction: column;
  gap: 14px;
  /* Страница занимает высоту области содержимого: список и карточка
     прокручиваются каждый у себя, а не тянут за собой весь экран. */
  height: 100%;
  min-height: 0;
}

.ideas__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  flex-wrap: wrap;
}

.ideas__spacer {
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

.scopes {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
}

.scope {
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

.scope--active {
  background: var(--accent-bg);
  border-color: var(--accent-border);
  color: var(--accent-ink);
}

.scope__count {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ink-40);
}

.scope--active .scope__count {
  color: inherit;
}

.add {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 13px;
  flex: none;
  border: 0;
  border-radius: var(--r-md);
  background: var(--accent-gradient);
  color: #fff;
  font-size: 12.5px;
  font-weight: 650;
  box-shadow: var(--accent-shadow);
}

.add svg {
  width: 15px;
  height: 15px;
}

.compose {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--r-lg);
  border: 1px solid var(--line-strong);
  background: var(--bg-modal);
}

.compose__title {
  height: 38px;
  padding: 0 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--line-strong);
  background: var(--fill-soft);
  color: var(--ink);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  outline: 0;
}

.compose__title:focus {
  border-color: var(--accent-border);
}

.compose__title::placeholder {
  color: var(--ink-30);
  font-weight: 500;
}

.compose__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.compose__save {
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--r-md);
  background: var(--accent-gradient);
  color: #fff;
  font-size: 12.5px;
  font-weight: 650;
  box-shadow: var(--accent-shadow);
}

.compose__save:disabled {
  opacity: 0.5;
  box-shadow: none;
}

.compose__cancel {
  border: 0;
  background: transparent;
  color: var(--ink-40);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}

.ideas__body {
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
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  width: 100%;
  padding: 12px 14px;
  border-radius: var(--r-lg);
  border: 1px solid var(--line-strong);
  background: var(--bg-modal);
  text-align: left;
  color: var(--ink);
  cursor: pointer;
}

.card--active {
  border-color: var(--accent-border);
  background: var(--accent-bg);
}

/* Сделанная идея приглушается, но остаётся читаемой: это история,
   а не мусор — к ней возвращаются, чтобы вспомнить, что уже решали. */
.card--done .card__title {
  color: var(--ink-45);
  text-decoration: line-through;
  text-decoration-color: var(--ink-30);
}

.check {
  width: 22px;
  height: 22px;
  flex: none;
  margin-top: 1px;
  display: grid;
  place-items: center;
  border: 1.5px solid var(--line-hover);
  border-radius: 6px;
  background: transparent;
  color: transparent;
  cursor: pointer;
}

.check svg {
  width: 13px;
  height: 13px;
}

.check:hover:not(:disabled) {
  border-color: var(--success);
  color: var(--ink-30);
}

.check--done {
  border-color: var(--success);
  background: var(--success-bg);
  color: var(--success-ink);
}

.check:disabled {
  cursor: default;
  opacity: 0.5;
}

.card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.card__title {
  font-size: 13px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: -0.01em;
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
  align-items: center;
  gap: 7px;
  margin-top: 1px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ink-30);
}

.card__author {
  color: var(--ink-40);
}

.card__comments {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  color: var(--ink-40);
}

.card__comments svg {
  width: 12px;
  height: 12px;
}

.detail {
  flex: none;
  width: clamp(360px, 34vw, 520px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left: 3px solid var(--accent);
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
  color: var(--accent-ink);
  background: var(--accent-bg);
}

.detail__mark--done {
  color: var(--success-ink);
  background: var(--success-bg);
}

.detail__code {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-70);
}

.detail__spacer {
  flex: 1;
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
  font-size: 15.5px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: -0.01em;
}

.detail__title--done {
  color: var(--ink-45);
  text-decoration: line-through;
  text-decoration-color: var(--ink-30);
}

.detail__desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink-70);
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
  width: 78px;
  color: var(--ink-40);
}

.facts__row dd {
  margin: 0;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.detail__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.detail__done {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--r-md);
  background: var(--success-bg);
  color: var(--success-ink);
  font-size: 12.5px;
  font-weight: 650;
}

.detail__done svg {
  width: 15px;
  height: 15px;
}

.detail__done--undo {
  background: var(--fill-hover);
  color: var(--ink-70);
}

.detail__edit,
.detail__delete {
  height: 34px;
  padding: 0 13px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--ink-60);
  font-size: 12.5px;
  font-weight: 600;
}

.detail__edit:hover {
  color: var(--ink);
}

.detail__delete:hover {
  border-color: rgba(229, 72, 77, 0.35);
  color: var(--danger-ink);
}

.confirm {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 10px;
  background: var(--danger-bg);
  color: var(--danger-ink);
  font-size: 12.5px;
  line-height: 1.4;
  flex-wrap: wrap;
}

.confirm__yes {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}

.confirm__no {
  border: 0;
  background: transparent;
  color: var(--ink-45);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.note {
  margin: 0;
  padding: 40px 0;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-45);
}

.banner {
  flex: none;
  background: var(--danger-bg);
  border: 1px solid rgba(229, 72, 77, 0.3);
  color: var(--danger-ink);
  border-radius: var(--r-lg);
  padding: 11px 14px;
  font-size: 12.5px;
  font-weight: 600;
  margin: 0;
  cursor: pointer;
}

/* Планшет и узкое окно: карточка не помещается рядом со списком —
   уводим её вниз, ограничив высоту, чтобы список остался виден. */
@media (max-width: 1180px) {
  .ideas__body {
    flex-direction: column;
  }

  .detail {
    width: 100%;
    flex: none;
    max-height: 52vh;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    border-top: 3px solid var(--accent);
  }
}

/*
  Телефон: панель раскладывается сеткой, карточка идеи разворачивается
  отдельным экраном под шапкой приложения.
*/
@media (max-width: 720px) {
  .ideas__bar {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }

  .search {
    min-width: 0;
    grid-column: 1 / -1;
    height: 38px;
  }

  .scopes {
    min-width: 0;
    /* Отрицательные поля вытягивают полосу под края экрана: обрезанная
       кнопка видна наполовину и приглашает прокрутить. */
    margin: 0 -12px;
    padding: 0 12px;
  }

  .scope {
    height: 36px;
  }

  .ideas__spacer {
    display: none;
  }

  .add {
    height: 36px;
  }

  /* Подпись прячется: рядом с полосой состояний на неё не остаётся
     места, а плюс понятен и без слова. */
  .add__text {
    display: none;
  }

  .add {
    width: 36px;
    padding: 0;
    justify-content: center;
  }

  /*
    Карточка раскрывается под шапкой приложения, а не поверх неё.

    inset: 0 клал бы её от самого верха окна — и шапка, которая выше по
    контексту наложения, накрывала бы строку с номером идеи вместе с
    кнопкой закрытия. С экрана тогда некуда вернуться.
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
    border-top: 3px solid var(--accent);
    border-radius: 0;
  }

  .detail__head {
    padding: 12px max(14px, env(safe-area-inset-right)) 12px
      max(16px, env(safe-area-inset-left));
  }

  .detail__body {
    padding: 16px max(14px, env(safe-area-inset-right))
      max(20px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left));
  }

  /* Цели под палец: 36px — минимум, при котором в кнопку попадаешь. */
  .detail__close {
    width: 38px;
    height: 38px;
  }

  .check {
    width: 26px;
    height: 26px;
  }

  .detail__done,
  .detail__edit,
  .detail__delete,
  .compose__save {
    height: 40px;
  }

  .compose__title {
    height: 42px;
  }
}

@media (pointer: coarse) {
  .detail__close {
    width: 38px;
    height: 38px;
  }

  .check {
    width: 26px;
    height: 26px;
  }
}
</style>
