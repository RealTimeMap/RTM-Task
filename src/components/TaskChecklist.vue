<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { storeToRefs } from 'pinia'

import { useDiscussionStore } from '../stores/discussion'
import { MAX_CHECKLIST_ITEMS, MAX_CHECKLIST_TITLE } from '../types/task'

const props = defineProps<{ canEdit: boolean }>()

const discussion = useDiscussionStore()
const { checklist, doneCount, progress } = storeToRefs(discussion)

const draft = ref('')
const adding = ref(false)
const input = ref<HTMLInputElement | null>(null)

/** Пункт, который сейчас переименовывают. */
const editingId = ref<number | null>(null)
const editDraft = ref('')

const full = computed(() => checklist.value.length >= MAX_CHECKLIST_ITEMS)
const canAdd = computed(
  () => props.canEdit && !full.value && draft.value.trim().length > 0 && !adding.value,
)

async function addItem(): Promise<void> {
  if (!canAdd.value) return

  adding.value = true
  try {
    const item = await discussion.addItem(draft.value.trim())
    if (item) {
      draft.value = ''
      // Фокус остаётся в поле: пункты обычно добавляют подряд.
      await nextTick()
      input.value?.focus()
    }
  } finally {
    adding.value = false
  }
}

function startRename(id: number, title: string): void {
  if (!props.canEdit) return
  editingId.value = id
  editDraft.value = title
}

function cancelRename(): void {
  editingId.value = null
  editDraft.value = ''
}

async function commitRename(id: number): Promise<void> {
  const title = editDraft.value.trim()
  // Пустое имя — это не «удалить», а промах: оставляем как было.
  if (!title) {
    cancelRename()
    return
  }

  const item = checklist.value.find((entry) => entry.id === id)
  if (item && item.title === title) {
    cancelRename()
    return
  }

  if (await discussion.renameItem(id, title)) {
    cancelRename()
  }
}
</script>

<template>
  <section class="checklist">
    <div class="checklist__head">
      <h3 class="checklist__label">ЧЕК-ЛИСТ</h3>
      <span v-if="checklist.length" class="checklist__counter">
        {{ doneCount }} / {{ checklist.length }}
      </span>
    </div>

    <!-- Полоса прогресса: доля закрытых пунктов видна одним взглядом,
         без пересчёта строк глазами. -->
    <div v-if="checklist.length" class="progress" role="presentation">
      <div class="progress__fill" :style="{ width: `${Math.round(progress * 100)}%` }" />
    </div>

    <ul v-if="checklist.length" class="items">
      <li v-for="item in checklist" :key="item.id" class="item" :class="{ 'item--done': item.done }">
        <label class="item__check">
          <input
            type="checkbox"
            :checked="item.done"
            :disabled="!canEdit"
            @change="discussion.toggleItem(item.id, ($event.target as HTMLInputElement).checked)"
          />
        </label>

        <input
          v-if="editingId === item.id"
          v-model="editDraft"
          class="item__input"
          :maxlength="MAX_CHECKLIST_TITLE"
          @keydown.enter.prevent="commitRename(item.id)"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename(item.id)"
        />
        <button
          v-else
          type="button"
          class="tk-plain item__title"
          :disabled="!canEdit"
          @click="startRename(item.id, item.title)"
        >
          {{ item.title }}
        </button>

        <button
          v-if="canEdit"
          type="button"
          class="tk-tap tk-plain item__remove"
          title="Удалить пункт"
          @click="discussion.removeItem(item.id)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </li>
    </ul>

    <p v-else class="empty">Пунктов пока нет</p>

    <form v-if="canEdit" class="add" @submit.prevent="addItem">
      <input
        ref="input"
        v-model="draft"
        class="add__input"
        :maxlength="MAX_CHECKLIST_TITLE"
        :disabled="full"
        :placeholder="full ? `Предел — ${MAX_CHECKLIST_ITEMS} пунктов` : 'Добавить пункт'"
      />
      <button type="submit" class="tk-tap tk-plain add__submit" :disabled="!canAdd">
        Добавить
      </button>
    </form>
  </section>
</template>

<style scoped>
.checklist {
  display: flex;
  flex-direction: column;
}

.checklist__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.checklist__label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.11em;
  color: var(--ink-45);
  margin: 0;
}

.checklist__counter {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ink-60);
}

.progress {
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  margin-bottom: 10px;
}

.progress__fill {
  height: 100%;
  border-radius: 999px;
  background: var(--accent-gradient);
  transition: width 0.2s ease;
}

.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 3px 4px;
  border-radius: var(--r-sm);
}

.item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.item__check {
  display: flex;
  align-items: center;
  flex: none;
}

.item__check input {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
  cursor: pointer;
}

.item__check input:disabled {
  cursor: default;
}

.item__title {
  flex: 1;
  min-width: 0;
  text-align: left;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  color: rgba(233, 233, 237, 0.85);
  word-break: break-word;
  padding: 0;
}

.item__title:disabled {
  cursor: default;
}

/* Выполненный пункт гасится, но остаётся читаемым: он всё ещё часть
   плана, а не мусор. */
.item--done .item__title {
  color: var(--ink-45);
  text-decoration: line-through;
}

.item__input {
  flex: 1;
  min-width: 0;
  background: var(--fill-soft);
  border: 1px solid var(--accent-border);
  border-radius: var(--r-sm);
  outline: none;
  color: var(--ink);
  font-size: 13px;
  padding: 4px 7px;
}

.item__remove {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-40);
  /* Крестик появляется по наведению: постоянный ряд крестиков
     превращает список в панель управления вместо плана работ. */
  opacity: 0;
}

.item:hover .item__remove,
.item__remove:focus-visible {
  opacity: 1;
}

.item__remove:hover {
  color: var(--danger-ink);
}

.item__remove svg {
  width: 11px;
  height: 11px;
}

.empty {
  margin: 0;
  font-size: 12.5px;
  font-style: italic;
  color: var(--ink-40);
}

.add {
  display: flex;
  gap: 7px;
  margin-top: 10px;
}

.add__input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  outline: none;
  color: var(--ink);
  font-size: 13px;
}

.add__input:focus {
  border-color: var(--accent-border);
}

.add__input:disabled {
  opacity: 0.5;
}

.add__submit {
  flex: none;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--r-md);
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  color: var(--ink-70);
  font-size: 12.5px;
  font-weight: 600;
}

.add__submit:disabled {
  opacity: 0.45;
  cursor: default;
}

/*
  Узкий экран: поле ввода и кнопка перестают делить одну строку.

  В колонке шириной с телефон «Добавить» съедает половину места, и
  в поле остаётся десяток символов — набирать пункт неудобно. Кнопка
  уходит под поле на всю ширину.
*/
@media (max-width: 480px) {
  .add {
    flex-wrap: wrap;
  }

  .add__input {
    flex: 1 1 100%;
  }

  .add__submit {
    flex: 1 1 100%;
  }
}

/* Крестик под палец не появляется по наведению — показываем всегда. */
@media (pointer: coarse) {
  .item__remove {
    opacity: 1;
    width: 32px;
    height: 32px;
  }

  .item__check input {
    width: 19px;
    height: 19px;
  }

  .add__input,
  .add__submit {
    height: 42px;
  }
}
</style>
