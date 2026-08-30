<script setup lang="ts">
import { computed, ref } from 'vue'

import MarkdownText from './MarkdownText.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    rows?: number
  }>(),
  { placeholder: '', rows: 6 },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const textarea = ref<HTMLTextAreaElement | null>(null)
const preview = ref(false)

const hasText = computed(() => props.modelValue.trim().length > 0)

interface Tool {
  key: string
  title: string
  /** Разметка вокруг выделения. */
  wrap?: [string, string]
  /** Префикс строки — для списков и цитат. */
  prefix?: string
  icon: string
}

/**
 * Иконки заданы как path внутри 24×24: так они совпадают по стилю
 * с остальными кнопками интерфейса и не тянут шрифт иконок.
 */
const tools: Tool[] = [
  {
    key: 'bold',
    title: 'Полужирный',
    wrap: ['**', '**'],
    icon: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  },
  {
    key: 'italic',
    title: 'Курсив',
    wrap: ['_', '_'],
    icon: 'M14 5h-4M14 5l-4 14M14 19h-4',
  },
  {
    key: 'strike',
    title: 'Зачёркнутый',
    wrap: ['~~', '~~'],
    icon: 'M5 12h14M8 8a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3M16 16a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3',
  },
  {
    key: 'code',
    title: 'Код',
    wrap: ['`', '`'],
    icon: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  },
  {
    key: 'link',
    title: 'Ссылка',
    wrap: ['[', '](https://)'],
    icon: 'M10 13a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7L11 6.3M14 11a4 4 0 0 0-5.7 0L6 13.3a4 4 0 0 0 5.7 5.7L13 17.7',
  },
  {
    key: 'list',
    title: 'Список',
    prefix: '- ',
    icon: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  },
  {
    key: 'checklist',
    title: 'Список задач',
    prefix: '- [ ] ',
    icon: 'M4 7l2 2 3-3M4 16l2 2 3-3M13 8h7M13 17h7',
  },
  {
    key: 'quote',
    title: 'Цитата',
    prefix: '> ',
    icon: 'M7 15V9a3 3 0 0 1 3-3M14 15V9a3 3 0 0 1 3-3',
  },
]

/**
 * Применяет разметку к выделенному тексту.
 *
 * Работаем через textarea напрямую: нужно сохранить позицию курсора,
 * иначе после каждой кнопки он прыгал бы в конец.
 */
function apply(tool: Tool): void {
  const field = textarea.value
  if (!field) return

  const start = field.selectionStart
  const end = field.selectionEnd
  const value = props.modelValue
  const selected = value.slice(start, end)

  let next: string
  let cursorStart: number
  let cursorEnd: number

  if (tool.prefix) {
    // Префикс ставится в начало каждой выделенной строки.
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const block = value.slice(lineStart, end) || ''
    const prefixed = block
      .split('\n')
      .map((line) => (line.startsWith(tool.prefix!) ? line : tool.prefix + line))
      .join('\n')

    next = value.slice(0, lineStart) + prefixed + value.slice(end)
    cursorStart = lineStart
    cursorEnd = lineStart + prefixed.length
  } else if (tool.wrap) {
    const [open, close] = tool.wrap
    next = value.slice(0, start) + open + selected + close + value.slice(end)
    // Без выделения ставим курсор между маркерами, иначе — оборачиваем текст.
    cursorStart = start + open.length
    cursorEnd = cursorStart + selected.length
  } else {
    return
  }

  emit('update:modelValue', next)

  // Позицию восстанавливаем после того, как Vue обновит поле.
  requestAnimationFrame(() => {
    field.focus()
    field.setSelectionRange(cursorStart, cursorEnd)
  })
}

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <div class="editor">
    <div class="editor__toolbar">
      <button
        v-for="tool in tools"
        :key="tool.key"
        type="button"
        class="tk-tap editor__tool"
        :title="tool.title"
        :disabled="preview"
        @click="apply(tool)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
          <path :d="tool.icon" />
        </svg>
      </button>

      <span class="editor__spacer" />

      <button
        type="button"
        class="tk-tap tk-plain editor__toggle"
        :class="{ 'editor__toggle--active': preview }"
        :disabled="!hasText"
        @click="preview = !preview"
      >
        {{ preview ? 'Писать' : 'Предпросмотр' }}
      </button>
    </div>

    <div v-if="preview" class="tk-scroll editor__preview">
      <MarkdownText :source="modelValue" />
    </div>

    <textarea
      v-else
      ref="textarea"
      class="editor__input"
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      @input="onInput"
    />
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.editor__toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 7px;
  flex-wrap: wrap;
}

.editor__tool {
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-60);
}

.editor__tool svg {
  width: 15px;
  height: 15px;
}

.editor__tool:disabled {
  opacity: 0.35;
  cursor: default;
}

.editor__spacer {
  flex: 1;
}

.editor__toggle {
  height: 28px;
  padding: 0 10px;
  border-radius: var(--r-sm);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-60);
  white-space: nowrap;
}

.editor__toggle--active {
  background: var(--accent-bg);
  color: var(--accent-ink);
}

.editor__toggle:disabled {
  opacity: 0.4;
  cursor: default;
}

.editor__input {
  flex: 1;
  width: 100%;
  min-height: 96px;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--ink);
  font-size: 14px;
  line-height: 1.5;
  resize: vertical;
}

.editor__preview {
  flex: 1;
  min-height: 96px;
  max-height: 320px;
  overflow: auto;
  padding: 2px 0;
}

@media (pointer: coarse) {
  .editor__tool {
    width: 38px;
    height: 38px;
  }

  .editor__toggle {
    height: 36px;
  }
}
</style>
