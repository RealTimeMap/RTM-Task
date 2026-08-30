/**
 * Проверка клиентской таблицы переходов: она гасит недоступные цели
 * drag & drop, поэтому должна совпадать с сервером
 * (internal/domain/task/model.go).
 */

import { canTransition, nextStatus, previousStatus, type TaskStatus } from '../src/types/task'

type Case = [TaskStatus, TaskStatus, boolean]

const cases: Case[] = [
  ['new', 'working', true],
  ['working', 'review', true],
  ['review', 'complete', true],
  ['review', 'working', true],
  ['working', 'new', true],
  ['new', 'review', false],
  ['new', 'complete', false],
  ['working', 'complete', false],
  ['complete', 'working', false],
  ['complete', 'review', false],
  ['complete', 'new', false],
]

let failed = 0

for (const [from, to, expected] of cases) {
  const actual = canTransition(from, to)
  if (actual !== expected) {
    console.error(`FAIL: ${from} -> ${to}: ожидали ${expected}, получили ${actual}`)
    failed += 1
  }
}

const steps: [TaskStatus, TaskStatus | null, TaskStatus | null][] = [
  ['new', 'working', null],
  ['working', 'review', 'new'],
  ['review', 'complete', 'working'],
  ['complete', null, null],
]

for (const [status, forward, back] of steps) {
  if (nextStatus(status) !== forward) {
    console.error(`FAIL: nextStatus(${status}) = ${nextStatus(status)}, ожидали ${forward}`)
    failed += 1
  }
  if (previousStatus(status) !== back) {
    console.error(`FAIL: previousStatus(${status}) = ${previousStatus(status)}, ожидали ${back}`)
    failed += 1
  }
}

if (failed > 0) {
  console.error(`\n${failed} проверок не прошло`)
  process.exit(1)
}

console.log(`OK: ${cases.length + steps.length * 2} проверок переходов пройдено`)
