<script setup lang="ts">
import { storeToRefs } from 'pinia'

import { useToastStore } from '../../stores/toast'

const toast = useToastStore()
const { message } = storeToRefs(toast)
</script>

<template>
  <div v-if="message" class="toast" role="status" aria-live="polite">
    {{ message }}
  </div>
</template>

<style scoped>
.toast {
  position: absolute;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  z-index: 50;
  max-width: calc(100% - 32px);
  background: rgba(18, 21, 29, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 13px;
  padding: 11px 17px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.6);
  animation: tkUp 0.18s ease both;
}

/* На узком экране длинный текст переносится вместо обрезки:
     места по горизонтали нет, по вертикали — сколько угодно. */
@media (max-width: 720px) {
  .toast {
    left: 12px;
    right: 12px;
    /* Над домашней полосой: иначе тост оказывается под ней. */
    bottom: max(18px, env(safe-area-inset-bottom));
    max-width: none;
    transform: none;
    text-align: center;
    white-space: normal;
  }
}
</style>
