/**
 * Перевод доменных значений в визуальные: подписи, цвета, инициалы.
 * Палитра — из макета «RealTimeMap Tasks».
 */

import { Priority, type TaskPriority, type TaskStatus, type TaskType } from '../types/task'

interface Tone {
  label: string
  ink: string
  bg: string
  dot: string
}

export const TYPE_TONES: Record<TaskType, Tone> = {
  bug: {
    label: 'БАГ',
    ink: 'var(--danger-ink)',
    bg: 'var(--danger-bg)',
    dot: 'var(--danger)',
  },
  feature: {
    label: 'ФИЧА',
    ink: 'var(--accent-ink)',
    bg: 'var(--accent-bg)',
    dot: 'var(--accent)',
  },
  fix: {
    label: 'ФИКС',
    ink: 'var(--success-ink)',
    bg: 'var(--success-bg)',
    dot: 'var(--success)',
  },
}

export const STATUS_TONES: Record<TaskStatus, Tone> = {
  new: {
    label: 'НОВАЯ',
    ink: 'var(--ink-70)',
    bg: 'var(--fill-hover)',
    dot: 'rgba(255,255,255,.28)',
  },
  working: {
    label: 'В РАБОТЕ',
    ink: 'var(--accent-ink)',
    bg: 'var(--accent-bg)',
    dot: 'var(--accent)',
  },
  review: {
    label: 'НА ПРОВЕРКЕ',
    ink: 'var(--warning-ink)',
    bg: 'var(--warning-bg)',
    dot: 'var(--warning)',
  },
  complete: {
    label: 'ЗАВЕРШЕНА',
    ink: 'var(--success-ink)',
    bg: 'var(--success-bg)',
    dot: 'var(--success)',
  },
}

/** Подписи статусов в предложном виде — для кнопок и колонок. */
export const STATUS_TITLES: Record<TaskStatus, string> = {
  new: 'Новые',
  working: 'В работе',
  review: 'На проверке',
  complete: 'Завершены',
}

export const TYPE_TITLES: Record<TaskType, string> = {
  bug: 'Баг',
  feature: 'Фича',
  fix: 'Фикс',
}

interface PriorityTone {
  label: string
  short: string
  dot: string
}

export const PRIORITY_TONES: Record<number, PriorityTone> = {
  [Priority.Base]: { label: 'Критичный', short: 'Крит.', dot: 'var(--danger)' },
  [Priority.High]: { label: 'Высокий', short: 'Высокий', dot: 'var(--warning)' },
  [Priority.Medium]: { label: 'Средний', short: 'Средний', dot: 'var(--accent)' },
  [Priority.Low]: { label: 'Низкий', short: 'Низкий', dot: 'var(--ink-40)' },
}

export const PRIORITY_ORDER: TaskPriority[] = [
  Priority.Base,
  Priority.High,
  Priority.Medium,
  Priority.Low,
]

export function priorityTone(priority: number): PriorityTone {
  return PRIORITY_TONES[priority] ?? PRIORITY_TONES[Priority.Medium]
}

/** Градиенты аватаров: стабильно закреплены за сотрудником по его id. */
const AVATAR_TINTS = [
  'linear-gradient(150deg,#1cb6c8,#0d7c96)',
  'linear-gradient(150deg,#3c5a72,#22303f)',
  'linear-gradient(150deg,#2a4bd8,#1d3399)',
  'linear-gradient(150deg,#6b4df5,#4a35c9)',
  'linear-gradient(150deg,#c8621c,#96500d)',
]

export function avatarTint(staffId: number | null): string {
  if (staffId === null) return 'rgba(255,255,255,.09)'
  return AVATAR_TINTS[staffId % AVATAR_TINTS.length]
}

/** Инициалы из полного имени: первые буквы двух первых слов. */
export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Человекочитаемый код задачи, как в макете. */
export function taskCode(id: number): string {
  return `RTM-${id}`
}

/** Дата в коротком виде: «23 авг.». */
export function shortDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

/** Время в виде ЧЧ:ММ. */
export function shortTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** Склонение слова «задача» по числу. */
export function pluralTasks(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100

  if (mod10 === 1 && mod100 !== 11) return 'задача'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'задачи'
  return 'задач'
}
