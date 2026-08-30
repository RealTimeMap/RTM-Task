/**
 * Проверка рендеринга описаний.
 *
 * Описание пишет пользователь, поэтому главное здесь — не форматирование,
 * а очистка: разметка не должна становиться каналом для вставки скриптов.
 */

import { JSDOM } from 'jsdom'

// DOMPurify нужен DOM: в Node его нет, подставляем до импорта модуля.
const dom = new JSDOM('')
;(globalThis as Record<string, unknown>).window = dom.window
;(globalThis as Record<string, unknown>).document = dom.window.document

const { renderMarkdown } = await import('../src/lib/markdown')

let failed = 0

const check = (name: string, condition: boolean, detail = '') => {
  if (!condition) {
    console.error(`FAIL: ${name}${detail ? `\n  ${detail}` : ''}`)
    failed += 1
  }
}

const contains = (name: string, source: string, expected: string) => {
  const html = renderMarkdown(source)
  check(name, html.includes(expected), `получили: ${html}`)
}

const excludes = (name: string, source: string, forbidden: string) => {
  const html = renderMarkdown(source)
  check(name, !html.toLowerCase().includes(forbidden.toLowerCase()), `получили: ${html}`)
}

// --- Форматирование ---
contains('жирный', '**важно**', '<strong>важно</strong>')
contains('курсив', '_наклонно_', '<em>наклонно</em>')
contains('зачёркнутый', '~~убрано~~', '<del>убрано</del>')
contains('строчный код', 'вызвать `render()`', '<code>render()</code>')
contains('маркированный список', '- первый\n- второй', '<li>первый</li>')
contains('нумерованный список', '1. раз\n2. два', '<ol>')
contains('цитата', '> замечание', '<blockquote>')
contains('блок кода', '```\nconst a = 1\n```', '<pre>')
contains('чек-бокс', '- [ ] сделать', '<input')
contains('ссылка', '[док](https://example.com)', 'href="https://example.com"')

// Перенос строки должен оставаться переносом: описания пишут списками
// без пустых строк между ними.
contains('перенос строки', 'первая\nвторая', '<br>')

// --- Безопасность ---
excludes('скрипт вырезается', '<script>alert(1)</script>', '<script')
excludes('обработчик события вырезается', '<img src=x onerror="alert(1)">', 'onerror')
excludes('javascript: в ссылке', '[клик](javascript:alert(1))', 'javascript:')
excludes('data: в ссылке', '[клик](data:text/html,<script>alert(1)</script>)', 'data:')
excludes('iframe вырезается', '<iframe src="https://evil.com"></iframe>', '<iframe')
excludes('картинки не разрешены', '![alt](https://example.com/a.png)', '<img')
excludes('таблицы не разрешены', '| a | b |\n|---|---|\n| 1 | 2 |', '<table')

// Экранирование: текст, похожий на HTML, показывается как текст.
const escaped = renderMarkdown('Сравнить a < b и b > c')
check('угловые скобки экранированы', escaped.includes('&lt;') || escaped.includes('&gt;'), escaped)

// --- Ссылки открываются безопасно ---
const link = renderMarkdown('[док](https://example.com)')
check('target=_blank', link.includes('target="_blank"'), link)
check('rel с noopener', link.includes('noopener'), link)

// --- Пустой ввод ---
check('пустая строка', renderMarkdown('') === '')
check('только пробелы', renderMarkdown('   \n  ') === '')

if (failed > 0) {
  console.error(`\n${failed} проверок не прошло`)
  process.exit(1)
}

console.log('OK: 24 проверки рендеринга markdown пройдено')
