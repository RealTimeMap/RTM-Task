<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    ink: string
    bg: string
    size?: 'sm' | 'md'
  }>(),
  { size: 'md' },
)
</script>

<template>
  <span class="chip" :class="`chip--${size}`" :style="{ color: ink, background: bg }">
    {{ label }}
  </span>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  font-weight: 700;
  letter-spacing: 0.06em;
  border-radius: var(--r-sm);
  white-space: nowrap;
}

.chip--sm {
  font-size: 10px;
  padding: 3px 6px;
}

.chip--md {
  font-size: 10.5px;
  padding: 4px 8px;
}
</style>
