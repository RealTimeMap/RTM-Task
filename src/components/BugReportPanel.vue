<script setup lang="ts">
/**
 * Отчёт о баге — отдельное окно рядом с задачей.
 *
 * Вынесено из колонки параметров: отчёт с логами не помещается в узкую
 * колонку, растягивает окно задачи по высоте и теряется среди
 * переключателей статуса и приоритета. Рядом с задачей он читается как
 * самостоятельный документ — а именно им и является.
 */

import { computed, ref } from 'vue'

import { BUG_TAG_TITLES, isNarrowScreen, shortDate } from '../lib/presentation'
import type { BugDetail } from '../types/task'

const props = defineProps<{
  bug: BugDetail | null
  loading: boolean
  error: string | null
  /**
   * Отчёт не загрузился из-за недоступности feedback-service.
   *
   * Отдельно от обычной ошибки: привязка бага цела, недоступен только
   * сам отчёт, и повтор имеет смысл.
   */
  unavailable?: boolean
  /** Можно ли отвязать баг: у завершённой задачи привязка не меняется. */
  canDetach: boolean
}>()

const emit = defineEmits<{ close: []; detach: []; retry: [] }>()

/** Разрешение экрана в читаемом виде. */
const screen = computed(() => {
  const bug = props.bug
  if (!bug) return ''
  // Значение показывается как есть: если пользователь прислал мусор,
  // переписывать его нельзя — иначе разработчик будет искать поломку
  // не там, где она случилась.
  if (bug.resolution) return bug.resolution
  if (bug.width && bug.height) return `${bug.width}x${bug.height}`
  return ''
})

/** Заряд батареи в процентах: в отчёте он приходит долей 0…1. */
const battery = computed(() => {
  const value = props.bug?.battery
  if (value === null || value === undefined) return ''
  // Значение приходит и долей, и уже процентами — приводим к одному виду.
  const percent = value <= 1 ? value * 100 : value
  return `${Math.round(percent)}%`
})

/** Строки отчёта, которые есть что показать. */
const facts = computed(() => {
  const bug = props.bug
  if (!bug) return []

  const rows: { label: string; value: string }[] = [
    { label: 'Платформа', value: bug.platform ?? '' },
    { label: 'ОС', value: bug.os ?? '' },
    { label: 'Сборка', value: bug.build ?? '' },
    { label: 'Экран', value: screen.value },
    { label: 'Батарея', value: battery.value },
    { label: 'Категория', value: BUG_TAG_TITLES[bug.tag] ?? bug.tag },
    { label: 'Отправлен', value: shortDate(bug.createdAt) },
    { label: 'От кого', value: bug.reporterId ? `#${bug.reporterId}` : 'Аноним' },
  ]

  // Пустые строки не показываем: «ОС: —» ничего не сообщает, а место
  // занимает.
  return rows.filter((row) => row.value !== '')
})

const logs = computed(() => props.bug?.logs ?? [])

/**
 * Переносить ли длинные строки журнала.
 *
 * На широком экране — нет: строка лога это одна запись, и разрыв
 * посередине мешает её читать, а хвост достаётся горизонтальной
 * прокруткой. На телефоне прокрутка внутри блока пальцем почти не
 * нащупывается и конфликтует с прокруткой страницы, поэтому там
 * переносим сразу. Переключатель остаётся в обоих случаях.
 */
const wrapLogs = ref(isNarrowScreen())

/** Журнал одной строкой — склеивать его в шаблоне неудобно. */
const logsText = computed(() => logs.value.join('\n'))
</script>

<template>
  <aside
    class="tk-rise report"
    role="dialog"
    aria-label="Отчёт о баге"
    @click.stop
  >
    <header class="report__head">
      <span class="report__mark">BUG</span>
      <span v-if="bug" class="report__code">#{{ bug.id }}</span>
      <span class="report__spacer" />

      <button
        v-if="canDetach"
        class="tk-tap tk-plain report__detach"
        title="Отвязать баг от задачи"
        @click="emit('detach')"
      >
        Отвязать
      </button>
      <button class="tk-tap report__close" title="Закрыть отчёт" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </header>

    <div class="tk-scroll report__body">
      <p v-if="loading" class="report__note">Загружаем отчёт…</p>

      <!-- Сервис недоступен: сам баг к задаче по-прежнему привязан,
           недоступны только подробности. Поэтому предупреждение с
           повтором, а не сообщение об ошибке. -->
      <div v-else-if="unavailable" class="report__warning">
        <span>{{ error }}</span>
        <button class="tk-tap tk-plain report__retry" @click="emit('retry')">Повторить</button>
      </div>

      <p v-else-if="error" class="report__note report__note--error">{{ error }}</p>

      <template v-else-if="bug">
        <h2 class="report__title">{{ bug.title }}</h2>

        <!-- Текст от пользователя. Разметку не разбираем: это свободный
             текст из формы обратной связи, а не markdown. Переносы
             сохраняем — шаги воспроизведения пишут построчно. -->
        <p v-if="bug.description" class="report__desc">{{ bug.description }}</p>

        <dl class="facts">
          <div v-for="row in facts" :key="row.label" class="facts__row">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>

        <section class="logs">
          <h3 class="report__label">
            ЖУРНАЛ
            <span v-if="logs.length" class="logs__count">{{ logs.length }}</span>
            <button
              v-if="logs.length"
              class="tk-tap tk-plain logs__wrap"
              :aria-pressed="wrapLogs"
              :title="wrapLogs ? 'Не переносить строки' : 'Переносить длинные строки'"
              @click="wrapLogs = !wrapLogs"
            >
              {{ wrapLogs ? 'В одну строку' : 'Переносить' }}
            </button>
          </h3>

          <pre
            v-if="logs.length"
            class="tk-scroll logs__body"
            :class="{ 'logs__body--wrap': wrapLogs }"
          >{{ logsText }}</pre>
          <p v-else class="report__note">Журнал не приложен.</p>
        </section>
      </template>
    </div>
  </aside>
</template>

<style scoped>
/*
  Окно отчёта — брат окна задачи, а не его часть: у него своя высота и
  своя прокрутка, поэтому длинный журнал не растягивает карточку задачи.
*/
.report {
  display: flex;
  flex-direction: column;
  flex: none;
  /* Ширины 380px не хватало: таблица фактов переносила значения на
     вторую строку, а журнал уезжал вбок почти сразу. Здесь окно тянется
     вместе с экраном, но не шире, чем нужно тексту. */
  width: clamp(420px, 32vw, 560px);
  /* Высоту задаёт ряд: align-items: stretch тянет отчёт до высоты
     задачи. Явный height здесь всё сломал бы — 100% считается от
     родителя с auto-высотой и схлопывается обратно к содержимому. */
  min-height: 0;
  background: var(--bg-modal);
  border: 1px solid rgba(255, 255, 255, 0.1);
  /* Красная кромка слева связывает окно с типом «баг» — по ней видно,
     что это не вторая задача, а отчёт к ней. */
  border-left: 3px solid var(--danger);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.6);
  cursor: default;
}

.report__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 14px 14px 12px 16px;
  border-bottom: 1px solid var(--line);
}

.report__mark {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 3px 6px;
  border-radius: 5px;
  color: var(--danger-ink);
  background: var(--danger-bg);
}

.report__code {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-70);
}

.report__spacer {
  flex: 1;
}

.report__detach {
  border: 0;
  background: transparent;
  color: var(--ink-40);
  font-size: 11px;
  cursor: pointer;
}

.report__detach:hover {
  color: var(--danger-ink);
}

.report__close {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ink-40);
  cursor: pointer;
}

.report__close svg {
  width: 15px;
  height: 15px;
}

.report__close:hover {
  background: var(--fill-hover);
  color: var(--ink);
}

.report__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/*
  Журнал забирает остаток высоты и прокручивается внутри себя. Так
  свободное место уходит логам — тому, ради чего отчёт и открывают, —
  а не превращается в пустоту под последней строкой.
*/
.logs {
  flex: 1;
  min-height: 120px;
  display: flex;
  flex-direction: column;
}

.report__title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: -0.01em;
}

.report__desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-70);
  /* Переносы из отчёта сохраняются, длинные ссылки без пробелов
     разрываются, а не распирают окно. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.report__label {
  margin: 0 0 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.07em;
  color: var(--ink-40);
}

.facts {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px;
  border-radius: 10px;
  background: var(--fill-hover);
}

.facts__row {
  display: flex;
  gap: 10px;
  font-size: 12px;
}

.facts__row dt {
  flex: none;
  width: 92px;
  color: var(--ink-40);
}

.facts__row dd {
  margin: 0;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.logs__wrap {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--ink-40);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0;
  cursor: pointer;
}

.logs__wrap:hover {
  color: var(--ink);
}

.logs__count {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--fill-hover);
  color: var(--ink-70);
  letter-spacing: 0;
}

/*
  Журнал прокручивается сам и не переносит строки: в логах перенос
  ломает читаемость — строка перестаёт совпадать с записью.
*/
.logs__body {
  margin: 0;
  padding: 12px;
  /* Журнал занимает всё оставшееся место секции: окно и так не выше
     задачи, а короткий лог не должен оставлять пустоту внизу. */
  flex: 1;
  min-height: 0;
  max-height: none;
  overflow: auto;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.35);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink-70);
}

/* С переносом строка не уезжает за край, но теряет однозначность:
   видно всё, ценой того, что одна запись занимает несколько строк. */
.logs__body--wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.report__note {
  margin: 0;
  font-size: 12px;
  color: var(--ink-40);
}

.report__note--error {
  color: var(--danger-ink);
}

.report__warning {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 10px;
  background: var(--warning-bg);
  color: var(--warning-ink);
  font-size: 12.5px;
  line-height: 1.45;
}

.report__retry {
  margin-left: auto;
  flex: none;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}

/*
  На узком экране окна складываются в столбец: два окна рядом не
  помещаются, а отчёт важнее ширины. Высоту ограничиваем, чтобы задача
  не уезжала за пределы экрана.
*/
/*
  На узком экране окна складываются в столбец: рядом они не помещаются.
  Здесь высоту задаёт уже не ряд, а само содержимое — с потолком, чтобы
  отчёт не выдавил задачу за пределы экрана.
*/
/*
  Планшет и узкое окно: два окна рядом не помещаются, отчёт уезжает под
  задачу. Высоту здесь задаёт уже не ряд, а содержимое — с потолком,
  чтобы отчёт не выдавил задачу за пределы экрана.
*/
@media (max-width: 1180px) {
  .report {
    width: 100%;
    height: auto;
    max-height: 45vh;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    border-top: 3px solid var(--danger);
  }

  /* Журнал в столбце не растягиваем: место нужнее задаче над ним. */
  .logs {
    flex: none;
  }

  .logs__body {
    flex: none;
    max-height: 180px;
  }
}

/*
  Телефон: отчёт разворачивается во весь экран поверх задачи.

  Складывать два окна в столбец здесь нельзя — окно задачи само занимает
  весь экран, и отчёт под ним пришлось бы искать прокруткой. Открытый
  отчёт — это отдельный экран, с которого возвращаются кнопкой закрытия,
  как из полноэкранной карточки.
*/
@media (max-width: 720px) {
  .report {
    position: fixed;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    max-height: 100%;
    border: 0;
    /* Красная кромка остаётся сверху: по ней видно, что это отчёт
       о баге, а не ещё одна задача. */
    border-top: 3px solid var(--danger);
    border-radius: 0;
  }

  .report__head {
    padding: 12px max(14px, env(safe-area-inset-right)) 12px
      max(16px, env(safe-area-inset-left));
  }

  /*
    Управление на телефоне крупнее. Размер привязан к ширине экрана, а не
    только к pointer: coarse — тот не срабатывает, например, в узком окне
    браузера на планшете с мышью, а промахиваться там так же неприятно.
  */
  .report__close {
    width: 38px;
    height: 38px;
  }

  .report__detach,
  .logs__wrap {
    min-height: 36px;
    padding: 0 8px;
  }

  .report__body {
    padding: 16px max(14px, env(safe-area-inset-right))
      max(24px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left));
  }

  /* На телефоне подпись и значение в столбец: 92px под подпись
     отнимали половину строки, и значения переносились. */
  .facts__row {
    flex-direction: column;
    gap: 1px;
  }

  .facts__row dt {
    width: auto;
  }

  /* Журнал забирает остаток экрана: ради него отчёт и открывают. */
  .logs {
    flex: 1;
    min-height: 140px;
  }

  .logs__body {
    flex: 1;
    max-height: none;
  }
}

/* Цели под палец: 36px — минимум, при котором в кнопку попадаешь. */
@media (pointer: coarse) {
  .report__close {
    width: 38px;
    height: 38px;
  }

  .report__detach,
  .logs__wrap {
    min-height: 36px;
    padding: 0 8px;
  }
}
</style>
