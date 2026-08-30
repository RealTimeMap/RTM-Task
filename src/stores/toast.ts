import { ref } from 'vue'
import { defineStore } from 'pinia'

const VISIBLE_MS = 2200

/** Короткие уведомления внизу экрана. Одновременно показывается одно. */
export const useToastStore = defineStore('toast', () => {
  const message = ref('')
  let timer: ReturnType<typeof setTimeout> | null = null

  function show(text: string): void {
    message.value = text
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      message.value = ''
      timer = null
    }, VISIBLE_MS)
  }

  function hide(): void {
    if (timer) clearTimeout(timer)
    timer = null
    message.value = ''
  }

  return { message, show, hide }
})
