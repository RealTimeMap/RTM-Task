<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'

import AvatarBadge from './ui/AvatarBadge.vue'
import MarkdownEditor from './ui/MarkdownEditor.vue'
import MarkdownText from './ui/MarkdownText.vue'
import { useDiscussionStore } from '../stores/discussion'
import { useSessionStore } from '../stores/session'
import { shortDate, shortTime } from '../lib/presentation'
import { MAX_COMMENT_LENGTH } from '../types/task'

const props = defineProps<{ canComment: boolean }>()

const discussion = useDiscussionStore()
const session = useSessionStore()

const { comments, loading } = storeToRefs(discussion)
const { permissions, staff } = storeToRefs(session)

const draft = ref('')
const sending = ref(false)

/** Комментарий, который сейчас правят. */
const editingId = ref<number | null>(null)
const editDraft = ref('')
const savingEdit = ref(false)

const canSend = computed(
  () =>
    props.canComment &&
    draft.value.trim().length > 0 &&
    // Предел тот же, что на сервере: отправлять заведомо отклоняемый
    // текст незачем.
    draft.value.trim().length <= MAX_COMMENT_LENGTH &&
    !sending.value,
)

/** Свой текст правит автор, чужой — только управляющая роль. */
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
    if (await discussion.addComment(draft.value.trim())) {
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
  if (!body) return

  savingEdit.value = true
  try {
    if (await discussion.editComment(id, body)) {
      cancelEdit()
    }
  } finally {
    savingEdit.value = false
  }
}

async function remove(id: number): Promise<void> {
  if (!confirm('Удалить комментарий? Действие необратимо.')) return
  await discussion.removeComment(id)
}
</script>

<template>
  <section class="comments">
    <div class="comments__head">
      <h3 class="comments__label">ОБСУЖДЕНИЕ</h3>
      <span v-if="comments.length" class="comments__counter">{{ comments.length }}</span>
    </div>

    <p v-if="loading && !comments.length" class="hint">Загружаем…</p>

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
            <MarkdownEditor v-model="editDraft" :rows="3" placeholder="Текст комментария" />
            <div class="comment__actions">
              <button
                type="button"
                class="tk-tap tk-plain comment__save"
                :disabled="savingEdit || !editDraft.trim()"
                @click="saveEdit(comment.id)"
              >
                {{ savingEdit ? 'Сохраняем…' : 'Сохранить' }}
              </button>
              <button type="button" class="tk-tap tk-plain comment__cancel" @click="cancelEdit">
                Отмена
              </button>
            </div>
          </template>

          <MarkdownText v-else :source="comment.body" />
        </div>
      </li>
    </ul>

    <p v-else class="empty">Комментариев пока нет</p>

    <!-- Форма внизу: обсуждение читается сверху вниз, и ответ
         пишется там, где заканчивается последняя реплика. -->
    <div v-if="canComment" class="composer">
      <MarkdownEditor
        v-model="draft"
        :rows="3"
        placeholder="Написать комментарий. Поддерживается разметка: **жирный**, `код`, списки"
      />
      <div class="composer__foot">
        <span class="composer__hint" :class="{ 'composer__hint--over': draft.length > MAX_COMMENT_LENGTH }">
          {{ draft.length }} / {{ MAX_COMMENT_LENGTH }}
        </span>
        <button type="button" class="tk-tap tk-plain composer__submit" :disabled="!canSend" @click="send">
          {{ sending ? 'Отправляем…' : 'Отправить' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.comments {
  display: flex;
  flex-direction: column;
}

.comments__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.comments__label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.11em;
  color: var(--ink-45);
  margin: 0;
}

.comments__counter {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--fill-soft);
  color: var(--ink-60);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.thread {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.comment {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.comment__body {
  flex: 1;
  min-width: 0;
}

.comment__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.comment__author {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
}

.comment__time {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-45);
}

.comment__edited {
  font-size: 11px;
  font-style: italic;
  color: var(--ink-40);
}

.comment__spacer {
  flex: 1;
}

.comment__action {
  padding: 1px 5px;
  border-radius: var(--r-sm);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-45);
}

.comment__action:hover {
  color: var(--accent-ink);
}

.comment__action--danger:hover {
  color: var(--danger-ink);
}

.comment__actions {
  display: flex;
  gap: 7px;
  margin-top: 8px;
}

.comment__save {
  height: 32px;
  padding: 0 12px;
  border-radius: var(--r-md);
  background: var(--accent-gradient);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
}

.comment__save:disabled {
  opacity: 0.5;
  cursor: default;
}

.comment__cancel {
  height: 32px;
  padding: 0 10px;
  border-radius: var(--r-md);
  color: var(--ink-60);
  font-size: 12.5px;
  font-weight: 600;
}

.empty,
.hint {
  margin: 0;
  font-size: 12.5px;
  font-style: italic;
  color: var(--ink-40);
}

.composer {
  margin-top: 16px;
  padding: 11px 13px;
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
}

.composer:focus-within {
  border-color: var(--accent-border);
}

.composer__foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.composer__hint {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-40);
}

.composer__hint--over {
  color: var(--danger-ink);
}

.composer__submit {
  margin-left: auto;
  height: 34px;
  padding: 0 14px;
  border-radius: var(--r-md);
  background: var(--accent-gradient);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
}

.composer__submit:disabled {
  opacity: 0.5;
  cursor: default;
}

/*
  Узкий экран: аватар убирается, а действия переносятся под подпись.

  Аватар съедает 36px ширины у каждой реплики — на телефоне это заметная
  доля строки, а имя автора рядом и так написано. Кнопки «Изменить» и
  «Удалить» при этом перестают тесниться в одну строку с датой.
*/
@media (max-width: 480px) {
  .comment > :first-child {
    display: none;
  }

  /* Действия остаются справа от подписи, а не переносятся отдельной
     строкой: без аватара места хватает, а лишняя строка на каждую
     реплику удлиняет и без того длинную ленту. */
  .comment__head {
    flex-wrap: nowrap;
  }

  .comment__author,
  .comment__time {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .comment__action {
    flex: none;
    padding-left: 0;
    padding-right: 0;
  }

  .comment__action + .comment__action {
    margin-left: 10px;
  }
}

@media (pointer: coarse) {
  .composer__submit {
    height: 42px;
  }

  .comment__action {
    padding: 6px 8px;
  }
}
</style>
