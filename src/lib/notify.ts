/**
 * Звуковые и системные уведомления о новых задачах и комментариях.
 *
 * Звук синтезируется через Web Audio, а не проигрывается из файла:
 * короткий сигнал из двух тонов не стоит ни сетевого запроса, ни
 * бинарника в репозитории, и его громкость легко держать негромкой.
 *
 * Браузер не даёт проигрывать звук, пока пользователь не взаимодействовал
 * со страницей: AudioContext создаётся приостановленным. Поэтому контекст
 * поднимается лениво, при первом же клике или нажатии клавиши, — до этого
 * момента уведомления беззвучны, и это нормально.
 */

/** Ключ, под которым хранится настройка звука. */
const SOUND_STORAGE_KEY = 'rtm-task:sound'

/** Громкость сигнала. Уведомление не должно перекрикивать музыку. */
const PEAK_GAIN = 0.07

/** Тип события, о котором уведомляем. У каждого свой сигнал. */
export type NoticeKind = 'task' | 'comment'

/**
 * Голос сигнала: две ноты подряд.
 *
 * Новая задача звучит вверх (что-то появилось и требует внимания),
 * комментарий — ниже и мягче: это реплика в уже известной задаче,
 * а не новая работа.
 */
const VOICES: Record<NoticeKind, { notes: number[]; step: number }> = {
  task: { notes: [660, 880], step: 0.09 },
  comment: { notes: [520, 415], step: 0.08 },
}

let context: AudioContext | null = null

/** Настройка звука. По умолчанию включён. */
let enabled = restoreEnabled()

function restoreEnabled(): boolean {
  try {
    // Отсутствие записи означает «ещё не выбирали» — звук включён.
    return localStorage.getItem(SOUND_STORAGE_KEY) !== 'off'
  } catch {
    // Приватный режим и недоступное хранилище не повод молчать.
    return true
  }
}

export function isSoundEnabled(): boolean {
  return enabled
}

export function setSoundEnabled(value: boolean): void {
  enabled = value
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, value ? 'on' : 'off')
  } catch {
    // Настройка не сохранится, но в этой сессии будет работать.
  }
  // Включение — это и есть тот жест пользователя, которого ждёт браузер.
  if (value) void resumeAudio()
}

/** Тип конструктора AudioContext с учётом префикса Safari. */
type AudioContextConstructor = typeof AudioContext

function audioContextClass(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null

  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor
    webkitAudioContext?: AudioContextConstructor
  }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

/**
 * Поднимает звуковой контекст.
 *
 * Вызывается из обработчика пользовательского жеста: до него браузер
 * держит контекст приостановленным и звук не пропускает.
 */
export async function resumeAudio(): Promise<void> {
  const Ctor = audioContextClass()
  if (!Ctor) return

  if (!context) {
    context = new Ctor()
  }
  if (context.state === 'suspended') {
    try {
      await context.resume()
    } catch {
      // Жест не засчитан — попробуем на следующем.
    }
  }
}

/**
 * Проигрывает короткий сигнал.
 *
 * Сбой синтеза не должен всплывать наружу: уведомление — вещь
 * второстепенная, и молчание лучше исключения в консоли на каждое
 * событие.
 */
export function playChime(kind: NoticeKind = 'task'): void {
  if (!enabled || !context || context.state !== 'running') return

  try {
    const voice = VOICES[kind]
    const start = context.currentTime

    voice.notes.forEach((frequency, index) => {
      const at = start + index * voice.step
      const oscillator = context!.createOscillator()
      const gain = context!.createGain()

      // Синус без обертонов звучит мягко — сигнал не должен резать слух.
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, at)

      // Плавная атака и затухание: щелчок на резком старте громче
      // самого сигнала.
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + voice.step + 0.12)

      oscillator.connect(gain).connect(context!.destination)
      oscillator.start(at)
      oscillator.stop(at + voice.step + 0.15)
    })
  } catch {
    // Звук не обязателен — тишина не ломает работу.
  }
}

/** Состояние разрешения на системные уведомления. */
export type NoticePermission = 'unsupported' | 'default' | 'granted' | 'denied'

export function noticePermission(): NoticePermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission as NoticePermission
}

/**
 * Запрашивает разрешение на системные уведомления.
 *
 * Вызывается только из обработчика действия пользователя: браузеры
 * отклоняют запрос, пришедший сам по себе, и после отказа второй раз
 * уже не спросят.
 */
export async function requestNoticePermission(): Promise<NoticePermission> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default') {
    return Notification.permission as NoticePermission
  }

  try {
    return (await Notification.requestPermission()) as NoticePermission
  } catch {
    return 'denied'
  }
}

/**
 * Показывает системное уведомление.
 *
 * tag схлопывает повторы: несколько событий по одной задаче заменяют
 * друг друга, а не копятся стопкой в центре уведомлений.
 */
export function showNotice(title: string, body: string, tag: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  // Вкладка на виду — пользователь и так всё видит, всплывающее окно
  // поверх неё было бы шумом. Звук при этом остаётся.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return

  try {
    new Notification(title, { body, tag, icon: '/favicon.svg' })
  } catch {
    // Часть браузеров запрещает конструктор вне service worker.
  }
}

/**
 * Уведомляет о событии: звук плюс системное окно, если вкладка скрыта.
 */
export function notify(
  kind: NoticeKind,
  title: string,
  body: string,
  tag: string,
): void {
  playChime(kind)
  showNotice(title, body, tag)
}

/**
 * Поднимает звук на первом же действии пользователя.
 *
 * Слушатели одноразовые: после первого жеста контекст уже запущен,
 * и держать их дальше незачем.
 */
export function armAudioOnFirstGesture(): void {
  if (typeof window === 'undefined') return

  const arm = (): void => {
    void resumeAudio()
  }

  for (const event of ['pointerdown', 'keydown'] as const) {
    window.addEventListener(event, arm, { once: true, passive: true })
  }
}
