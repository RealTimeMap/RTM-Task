/**
 * Socket.IO-клиент к namespace /tasks.
 *
 * Аутентификация та же, что у REST: шлюз валидирует Bearer-токен и
 * подставляет заголовки пользователя, в том числе на рукопожатии сокета.
 * Клиент передаёт только токен, личность определяет шлюз.
 */

import { io, type Socket } from 'socket.io-client'

import { getToken } from './auth'
import type { Task, TaskFilters, TaskListResponse } from '../types/task'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? ''
const NAMESPACE = '/tasks'

/** События Server → Client. */
export const TaskEvents = {
  Created: 'taskCreated',
  Updated: 'taskUpdated',
  StatusChanged: 'taskStatusChanged',
  Reworked: 'taskReworked',
  Assigned: 'taskAssigned',
  Unassigned: 'taskUnassigned',
  Deleted: 'taskDeleted',

  CommentAdded: 'taskCommentAdded',
  CommentUpdated: 'taskCommentUpdated',
  CommentDeleted: 'taskCommentDeleted',

  ChecklistAdded: 'taskChecklistAdded',
  ChecklistUpdated: 'taskChecklistUpdated',
  ChecklistDeleted: 'taskChecklistDeleted',
} as const

export type TaskEventName = (typeof TaskEvents)[keyof typeof TaskEvents]

/** Ответ сервера на запрос клиента. */
type Ack<T> =
  | ({ success: true } & T)
  | { success: false; error: { code: string; message: string; field?: string } }

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error'

let socket: Socket | null = null

/** Подключается к namespace задач. */
export function connectSocket(): Socket {
  if (socket) {
    disconnectSocket()
  }

  const token = getToken()

  socket = io(`${SOCKET_URL}${NAMESPACE}`, {
    // Рукопожатие идёт через polling, и только потом соединение
    // поднимается до websocket. Это важно для аутентификации: HTTP-запрос
    // проходит через шлюз, который валидирует токен и проставляет
    // заголовки, а websocket-апгрейд наследует уже созданную сессию.
    transports: ['polling', 'websocket'],
    extraHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
    auth: token ? { token } : undefined,
    withCredentials: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  })

  return socket
}

export function disconnectSocket(): void {
  if (!socket) return
  socket.removeAllListeners()
  socket.disconnect()
  socket = null
}

export function getSocket(): Socket | null {
  return socket
}

/** Разворачивает ack: успех — данные, отказ — исключение. */
function unwrap<T>(ack: Ack<T>): T {
  if (!ack?.success) {
    const message = ack?.error?.message ?? 'Сокет вернул ошибку'
    throw new Error(message)
  }
  return ack as unknown as T
}

/**
 * Запрашивает список задач через сокет.
 * Совпадает по семантике с GET /tasks — тот же use case на сервере.
 */
export function requestTaskList(filters: TaskFilters = {}): Promise<TaskListResponse> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Сокет не подключён'))
      return
    }

    socket.emit('tasks:list', filters, (ack: Ack<{ tasks: TaskListResponse }>) => {
      try {
        resolve(unwrap(ack).tasks)
      } catch (error) {
        reject(error)
      }
    })
  })
}

/** Запрашивает одну задачу через сокет. */
export function requestTask(taskId: number): Promise<Task> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Сокет не подключён'))
      return
    }

    socket.emit('tasks:get', { taskId }, (ack: Ack<{ task: Task }>) => {
      try {
        resolve(unwrap(ack).task)
      } catch (error) {
        reject(error)
      }
    })
  })
}

/**
 * Подписывается на поток задач исполнителя.
 * Без assigneeId — общий поток; чужой поток доступен только менеджерам.
 */
export function subscribeToAssignee(assigneeId?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('Сокет не подключён'))
      return
    }

    socket.emit('tasks:subscribe', { assigneeId }, (ack: Ack<{ room: string }>) => {
      try {
        resolve(unwrap(ack).room)
      } catch (error) {
        reject(error)
      }
    })
  })
}
