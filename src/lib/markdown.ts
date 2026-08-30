/**
 * Рендеринг описаний задач.
 *
 * В базе лежит сырой markdown — так текст остаётся редактируемым и не
 * зависит от того, как мы его показываем. Разметка превращается в HTML
 * только здесь, на клиенте, и обязательно проходит очистку: описание
 * пишет пользователь, и без неё в него можно было бы вложить скрипт.
 */

import DOMPurify from 'dompurify'
import { Marked } from 'marked'

/**
 * Теги, которые может дать разметка. Набор намеренно узкий: описанию
 * задачи хватает выделения, списков, ссылок и кода — всё остальное
 * (картинки, произвольный HTML, таблицы) только увеличивает поверхность
 * для ошибок.
 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
  'hr',
  'input', // чек-боксы в списках задач
]

const ALLOWED_ATTR = ['href', 'title', 'type', 'checked', 'disabled', 'class']

const marked = new Marked({
  gfm: true,
  breaks: true, // перенос строки — это перенос строки, а не склейка абзаца
})

/** Ссылки открываются в новой вкладке и не передают referrer. */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer nofollow')
  }
})

/** Переводит markdown в безопасный HTML. */
export function renderMarkdown(source: string): string {
  if (!source.trim()) return ''

  const html = marked.parse(source, { async: false }) as string

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Ссылки только на привычные схемы: javascript: и data: сюда не пройдут.
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  })
}

/** Есть ли в тексте разметка — чтобы не включать предпросмотр впустую. */
export function hasMarkup(source: string): boolean {
  return /[*_`~[\]>#-]/.test(source)
}
