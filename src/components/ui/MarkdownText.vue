<script setup lang="ts">
import { computed } from 'vue'

import { renderMarkdown } from '../../lib/markdown'

const props = withDefaults(
  defineProps<{
    source: string
    /** Что показать, если текста нет. */
    placeholder?: string
  }>(),
  { placeholder: '' },
)

const html = computed(() => renderMarkdown(props.source))
const isEmpty = computed(() => html.value === '')
</script>

<template>
  <p v-if="isEmpty && placeholder" class="markdown markdown--empty">
    {{ placeholder }}
  </p>
  <!-- Содержимое очищено в renderMarkdown: DOMPurify с узким набором тегов. -->
  <div v-else-if="!isEmpty" class="markdown" v-html="html" />
</template>

<style scoped>
.markdown {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.55;
  color: rgba(233, 233, 237, 0.8);
  text-wrap: pretty;
  word-break: break-word;
}

.markdown--empty {
  font-style: italic;
  color: var(--ink-40);
  margin: 0;
}

.markdown :deep(p) {
  margin: 0 0 10px;
}

.markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown :deep(strong) {
  font-weight: 700;
  color: var(--ink);
}

.markdown :deep(em) {
  font-style: italic;
}

.markdown :deep(del) {
  color: var(--ink-45);
}

.markdown :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: rgba(255, 255, 255, 0.07);
  border-radius: 5px;
  padding: 1px 5px;
}

.markdown :deep(pre) {
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 10px 12px;
  overflow-x: auto;
  margin: 0 0 10px;
}

.markdown :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 12px;
  line-height: 1.5;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 0 0 10px;
  padding-left: 20px;
}

.markdown :deep(li) {
  margin-bottom: 3px;
}

/* Список задач: маркер убирается, остаётся сам чек-бокс. */
.markdown :deep(li:has(input[type='checkbox'])) {
  list-style: none;
  margin-left: -18px;
}

.markdown :deep(input[type='checkbox']) {
  margin-right: 7px;
  accent-color: var(--accent);
}

.markdown :deep(blockquote) {
  margin: 0 0 10px;
  padding-left: 12px;
  border-left: 2px solid var(--accent-border);
  color: var(--ink-60);
}

.markdown :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown :deep(hr) {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 12px 0;
}
</style>
