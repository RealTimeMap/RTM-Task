<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'

import { useSessionStore } from '../stores/session'
import type { SessionFailure } from '../stores/session'

const props = defineProps<{ failure: SessionFailure }>()

const session = useSessionStore()
const { loading, error } = storeToRefs(session)

const username = ref('')
const password = ref('')

const canSubmit = computed(
  () => username.value.trim().length > 0 && password.value.length > 0 && !loading.value,
)

/**
 * Доступ закрыт — значит вход прошёл, но пользователь не администратор
 * платформы. Форма тут не поможет, поэтому показываем объяснение.
 */
const isForbidden = computed(() => props.failure === 'forbidden')
const isUnavailable = computed(() => props.failure === 'unavailable')

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  await session.signIn(username.value.trim(), password.value)
  password.value = ''
}
</script>

<template>
  <div class="screen">
    <div class="tk-rise panel">
      <header class="panel__head">
        <div class="panel__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9">
            <path d="M5 12.6l3.4 3.4L19 5.4" />
            <path d="M5 19h9" />
          </svg>
        </div>
        <div>
          <h1 class="panel__title">RealTimeMap</h1>
          <p class="panel__sub">ЗАДАЧИ</p>
        </div>
      </header>

      <template v-if="isForbidden">
        <p class="panel__text">
          Вы вошли, но таск-менеджер доступен только администраторам платформы.
          Если доступ нужен по работе, обратитесь к администратору.
        </p>
        <button class="tk-tap tk-plain submit" @click="session.signOut()">
          Войти под другой учётной записью
        </button>
      </template>

      <template v-else>
        <p class="panel__text">
          {{
            isUnavailable
              ? 'Сервис задач сейчас недоступен. Попробуйте войти ещё раз через минуту.'
              : 'Войдите под учётной записью RealTimeMap.'
          }}
        </p>

        <form class="form" @submit.prevent="submit">
          <label class="field">
            <span class="field__label">ЛОГИН</span>
            <input
              v-model="username"
              class="field__input"
              autocomplete="username"
              placeholder="username"
              :disabled="loading"
              autofocus
            />
          </label>

          <label class="field">
            <span class="field__label">ПАРОЛЬ</span>
            <input
              v-model="password"
              class="field__input"
              type="password"
              autocomplete="current-password"
              placeholder="••••••••"
              :disabled="loading"
            />
          </label>

          <p v-if="error" class="panel__error">{{ error }}</p>

          <button type="submit" class="tk-tap tk-plain submit" :disabled="!canSubmit">
            {{ loading ? 'Входим…' : 'Войти' }}
          </button>
        </form>
      </template>
    </div>
  </div>
</template>

<style scoped>
.screen {
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg-app);
  /* Прокрутка внутри экрана: страница целиком не скроллится,
     а на низком окне форма не должна обрезаться. */
  overflow: auto;
}

.panel {
  width: 400px;
  max-width: 100%;
  background: var(--bg-shell);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-2xl);
  padding: 26px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 40px 90px rgba(0, 0, 0, 0.6);
}

.panel__head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.panel__mark {
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 13px;
  background: var(--accent-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel__mark svg {
  width: 21px;
  height: 21px;
}

.panel__title {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
}

.panel__sub {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(233, 233, 237, 0.38);
  margin: 1px 0 0;
}

.panel__text {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--ink-60);
  margin: 0;
  text-wrap: pretty;
}

.panel__error {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--danger-ink);
  background: var(--danger-bg);
  border: 1px solid rgba(229, 72, 77, 0.3);
  border-radius: var(--r-md);
  padding: 10px 12px;
  margin: 0;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: block;
  background: var(--fill-soft);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  padding: 10px 13px;
}

.field:focus-within {
  border-color: var(--accent-border);
}

.field__label {
  display: block;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--ink-45);
  margin-bottom: 3px;
}

.field__input {
  width: 100%;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--ink);
  font-size: 14px;
}

.field__input:disabled {
  opacity: 0.6;
}

.submit {
  height: 46px;
  border-radius: var(--r-lg);
  background: var(--accent-gradient);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  box-shadow: var(--accent-shadow);
}

.submit:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (max-width: 480px) {
  .screen {
    padding: 16px;
    align-items: flex-start;
    padding-top: 12vh;
  }

  .panel {
    padding: 22px 18px 20px;
    /* На маленьком экране тень и рамка только съедают место. */
    box-shadow: none;
  }
}

@media (pointer: coarse) {
  .submit {
    height: 52px;
  }

  .field {
    padding: 12px 14px;
  }
}
</style>
