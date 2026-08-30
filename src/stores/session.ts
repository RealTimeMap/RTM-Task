import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { staffApi } from '../api/staff'
import { ApiError, errorMessage } from '../api/client'
import { AuthError, login as authLogin, logout as authLogout, restoreToken } from '../api/auth'
import type { Staff } from '../types/staff'
import { canAssignAnyone, canCreateTask, canDeleteTask } from '../types/staff'

/** Почему интерфейс недоступен — определяет, что показать вместо него. */
export type SessionFailure = 'unauthorized' | 'forbidden' | 'unavailable'

/**
 * Сессия текущего сотрудника.
 *
 * Пароль проверяет auth-service платформы: форма входа отправляет туда
 * логин и пароль и получает Bearer-токен. Кто мы для сервиса задач —
 * решает шлюз, валидируя этот токен и подставляя заголовки X-User-*.
 */
export const useSessionStore = defineStore('session', () => {
  const staff = ref<Staff | null>(null)
  const members = ref<Staff[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const failure = ref<SessionFailure | null>(null)

  const isAuthenticated = computed(() => staff.value !== null)
  const staffId = computed(() => staff.value?.id ?? null)

  /** Права текущего сотрудника — зеркало серверной матрицы ролей. */
  const permissions = computed(() => {
    const role = staff.value?.role
    if (!role) {
      return { canCreate: false, canAssignAnyone: false, canDelete: false }
    }
    return {
      canCreate: canCreateTask(role),
      canAssignAnyone: canAssignAnyone(role),
      canDelete: canDeleteTask(role),
    }
  })

  /** Ищет сотрудника по id среди загруженных — для подписей в списках. */
  function memberById(id: number | null): Staff | null {
    if (id === null) return null
    return members.value.find((item) => item.id === id) ?? null
  }

  async function loadMembers(): Promise<void> {
    const response = await staffApi.list()
    members.value = response.items
  }

  /**
   * Загружает текущего сотрудника по имеющемуся токену.
   * Сервис заводит его сам при первом обращении, поэтому регистрации
   * в таск-менеджере не требуется.
   */
  async function load(): Promise<boolean> {
    if (!restoreToken()) {
      staff.value = null
      failure.value = 'unauthorized'
      return false
    }

    loading.value = true
    error.value = null
    failure.value = null

    try {
      staff.value = await staffApi.me()
      await loadMembers()
      return true
    } catch (err) {
      staff.value = null
      error.value = errorMessage(err)

      if (err instanceof ApiError) {
        failure.value = err.isUnauthorized
          ? 'unauthorized'
          : err.isForbidden
            ? 'forbidden'
            : 'unavailable'

        // Токен протух — держать его дальше незачем.
        if (err.isUnauthorized) {
          authLogout()
          error.value = null
        }
      } else {
        failure.value = 'unavailable'
      }
      return false
    } finally {
      loading.value = false
    }
  }

  /** Вход по логину и паролю через auth-service. */
  async function signIn(username: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      await authLogin({ username, password })
    } catch (err) {
      error.value = err instanceof AuthError ? err.message : errorMessage(err)
      loading.value = false
      return false
    }

    loading.value = false

    // Токен получен — теперь спрашиваем сервис задач, кем нас считают.
    return load()
  }

  function signOut(): void {
    authLogout()
    staff.value = null
    members.value = []
    error.value = null
    failure.value = 'unauthorized'
  }

  return {
    staff,
    members,
    loading,
    error,
    failure,
    isAuthenticated,
    staffId,
    permissions,
    memberById,
    loadMembers,
    load,
    signIn,
    signOut,
  }
})
