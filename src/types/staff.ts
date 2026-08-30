/**
 * Контракт сотрудников — зеркало internal/domain/role.
 */

export type StaffRole = 'admin' | 'manager' | 'developer' | 'viewer'

export interface Staff {
  id: number
  email: string
  fullName: string
  role: StaffRole
  isActive: boolean
  createdAt: string
}

export interface StaffListResponse {
  items: Staff[]
}

export interface CreateStaffPayload {
  email: string
  fullName: string
  role: StaffRole
}

/**
 * Права ролей. Повторяют матрицу из internal/domain/role/model.go —
 * UI прячет недоступные действия, но решение всё равно за сервером.
 */
export function canCreateTask(role: StaffRole): boolean {
  return role === 'admin' || role === 'manager' || role === 'developer'
}

export function canAssignAnyone(role: StaffRole): boolean {
  return role === 'admin' || role === 'manager'
}

export function canDeleteTask(role: StaffRole): boolean {
  return role === 'admin' || role === 'manager'
}

export function canEditForeignTask(role: StaffRole): boolean {
  return role === 'admin' || role === 'manager'
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  developer: 'Разработчик',
  viewer: 'Наблюдатель',
}
