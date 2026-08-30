<script setup lang="ts">
import { computed } from 'vue'

import { avatarTint, initials } from '../../lib/presentation'
import type { Staff } from '../../types/staff'

const props = withDefaults(
  defineProps<{
    staff: Staff | null
    size?: number
  }>(),
  { size: 24 },
)

const label = computed(() => (props.staff ? initials(props.staff.fullName) : '—'))
const tint = computed(() => avatarTint(props.staff?.id ?? null))
const fontSize = computed(() => `${Math.round(props.size * 0.4)}px`)
</script>

<template>
  <div
    class="avatar"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      background: tint,
      fontSize,
    }"
    :title="staff?.fullName ?? 'Не назначено'"
  >
    {{ label }}
  </div>
</template>

<style scoped>
.avatar {
  flex: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #eaf2ff;
  letter-spacing: 0.02em;
}
</style>
