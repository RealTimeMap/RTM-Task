<script setup lang="ts">
/**
 * Обсуждение идеи.
 *
 * Отдельный компонент от TaskComments, а не общий с параметром: тот
 * завязан на стор обсуждения задач вместе с его realtime-подпиской и
 * счётчиками, которых у идей нет. Общий компонент пришлось бы
 * параметризовать хранилищем — и он перестал бы читаться в обоих
 * местах ради экономии полусотни строк разметки.
 */

import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'

import AvatarBadge from './ui/AvatarBadge.vue'
import MarkdownEditor from './ui/MarkdownEditor.vue'
import MarkdownText from './ui/MarkdownText.vue'
import { useIdeasStore } from '../stores/ideas'
import { useSessionStore } from '../stores/session'
import { shortDate, shortTime } from '../lib/presentation'
import { MAX_IDEA_COMMENT } from '../types/idea'

const props = defineProps<{ ideaId: number; canComment: boolean }>()

const ideas = useIdeasStore()
const session = useSessionStore()

const { comments, commentsLoading, commentsError } = storeToRefs(ideas)
const { permissions, staff } = storeToRefs(session)

const draft = ref('')
const sending = ref(false)

/** Реплика, которую сейчас правят. */
const editingId = ref<number | null>(null)
const editDraft = ref('')
const savingEdit = ref(false)

const canSend = computed(
  () =>
    props.canComment &&
    draft.value.trim().length > 0 &&
    // Предел тот же, что на сервере: отправлять заведомо отклоняемый
    // текст незачем.
    draft.value.trim().length <= MAX_IDEA_COMMENT &&
    !sending.value,
)

/** Свой текст правит автор, чужой удаляет только управляющая роль. */
function canManage(authorId: number): boolean {
  return authorId === staff.value?.id || permissions.value.canAssignAnyone
}

function authorName(authorId: number): string {
  return session.memberById(authorId)?.fullName ?? `#${authorId}`
}

/** «23 авг., 14:05» — дата и время рядом: реплики идут подряд. */
function stamp(iso: string): string {
  return `${shortDate(iso)}, ${shortTime(iso)}`
}

async function send(): Promise<void> {
  if (!canSend.value) return

  sending.value = true
  try {
    if (await ideas.addComment(props.ideaId, draft.value.trim())) {
      draft.value = ''
    }
  } finally {
    sending.value = false
  }
}

function startEdit(id: number, body: string): void {
  editingId.value = id
  editDraft.value = body
}

function cancelEdit(): void {
  editingId.value = null
  editDraft.value = ''
}

async function saveEdit(id: number): Promise<void> {
  const body = editDraft.value.trim()
  if (!body || body.length > MAX_IDEA_COMMENT) return

  savingEdit.value = true
  try {
    if (await ideas.updateComment(props.ideaId, id, body)) {
      cancelEdit()
    }
  } finally {
    savingEdit.value = false
  }
}

async function remove(id: number): Promise<void> {
  await ideas.removeComment(props.ideaId, id)
}
</script>

<template>
  <section class="comments">
    <div class="comments__head">
      <h3 class="comments__label">ОБСУЖДЕНИЕ</h3>
      <span v-if="comments.length" class="comments__counter">{{ comments.length }}</span>
    </div>

    <p v-if="commentsError" class="hint hint--error">{{ commentsError }}</p>

    <p v-if="commentsLoading && !comments.length" class="hint">Загружаем…</p>

    <ul v-else-if="comments.length" class="thread">
      <li v-for="comment in comments" :key="comment.id" class="comment">
        <AvatarBadge :staff="session.memberById(comment.authorId)" :size="26" />

        <div class="comment__body">
          <div class="comment__head">
            <span class="comment__author">{{ authorName(comment.authorId) }}</span>
            <span class="comment__time">{{ stamp(comment.createdAt) }}</span>
            <span v-if="comment.editedAt" class="comment__edited">изменено</span>

            <span class="comment__spacer" />

            <template v-if="canManage(comment.authorId) && editingId !== comment.id">
              <button
                type="button"
                class="tk-plain comment__action"
                @click="startEdit(comment.id, comment.body)"
              >
                Изменить
              </button>
              <button
                type="button"
                class="tk-plain comment__action comment__action--danger"
                @click="remove(comment.id)"
              >
                Удалить
              </button>
            </template>
          </div>

          <template v-if="editingId === comment.id">
            <MarkdownEditor v-model="editDraft" :rows="3" placeholder="Текст реплики" />
            <div class="comment__edit-actions">
              <button
                type="button"
                class="tk-tap tk-plain comment__save"
                :disabled="!editDraft.trim() || savingEdit"
                @click="saveEdit(comment.id)"
              >
                Сохранить
              </button>
              <button type="button" class="tk-plain comment__cancel" @click="cancelEdit">
                Отмена
              </button>
            </div>
          </template>

          <MarkdownText v-else :source="comment.body" class="comment__text" />
        </div>
      </li>
    </ul>

    <p v-else class="hint">Реплик пока нет.</p>

    <div v-if="canComment" class="composer">
      <MarkdownEditor v-model="draft" :rows="3" placeholder="Что думаете об этой идее?" />
      <button type="button" class="tk-tap tk-plain composer__send" :disabled="!canSend" @click="send">
        {{ sending ? 'Отправляем…' : 'Отправить' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.comments {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.comments__head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.comments__label {
  margin: 0;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  color: var(--ink-40);
}

.comments__counter {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--fill-hover);
  color: var(--ink-70);
  font-size: 10.5px;
  font-weight: 700;
}

.thread {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.comment {
  display: flex;
  gap: 9px;
}

.comment__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.comment__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.comment__author {
  font-size: 12px;
  font-weight: 650;
}

.comment__time {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ink-40);
}

.comment__edited {
  font-size: 10px;
  font-weight: 600;
  color: var(--ink-30);
  font-style: italic;
}

.comment__spacer {
  flex: 1;
}

.comment__action {
  border: 0;
  background: transparent;
  color: var(--ink-40);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.comment__action:hover {
  color: var(--ink);
}

.comment__action--danger:hover {
  color: var(--danger-ink);
}

.comment__text {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ink-70);
}

.comment__edit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.comment__save {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--r-sm);
  background: var(--accent-bg-strong);
  color: var(--accent-ink);
  font-size: 12px;
  font-weight: 650;
}

.comment__save:disabled {
  opacity: 0.5;
}

.comment__cancel {
  border: 0;
  background: transparent;
  color: var(--ink-40);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
}

.composer__send {
  align-self: flex-start;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--r-md);
  background: var(--accent-gradient);
  color: #fff;
  font-size: 12.5px;
  font-weight: 650;
  box-shadow: var(--accent-shadow);
}

.composer__send:disabled {
  opacity: 0.5;
  box-shadow: none;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--ink-40);
}

.hint--error {
  color: var(--danger-ink);
}

@media (max-width: 720px) {
  /* Цель под палец: на телефоне отправку нажимают большим пальцем. */
  .composer__send {
    align-self: stretch;
    height: 42px;
  }

  .comment__action {
    min-height: 32px;
    padding: 0 4px;
  }
}
</style>
