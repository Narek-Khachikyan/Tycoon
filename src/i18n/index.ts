/**
 * Перевод игрового текста.
 *
 * Русский остаётся исходным языком кода: строки не выезжают из модулей, в которых они
 * живут, а английский лежит в `en/` и переводится по одному ключу. Модуль сознательно
 * ничего не знает ни про React, ни про стор — язык приходит аргументом, поэтому один и тот
 * же `t` годится и компоненту, и чистой функции экономики.
 */

import { EN } from './en';
import type { Key, Lang, Message, Msg, Params } from './types';

export type { Key, Lang, Message, Params };
export { LANGS } from './types';

/**
 * Язык браузера — для игрока, у которого ещё нет сохранения и который поэтому ничего не
 * выбирал. Всё, кроме русского, читается как английский: других языков в игре нет, а
 * молчаливый откат на русский у игрока с немецкой или японской системой был бы хуже
 * английского, который он хотя бы понимает.
 */
export function browserLang(): Lang {
  if (typeof navigator === 'undefined') return 'ru';
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

/** Плейсхолдеры вида `{n}`. Только слово из букв и цифр: фигурные скобки в игровом
 *  тексте больше нигде не встречаются, и ловить их регуляркой — значит ловить лишнее. */
const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Подстановка параметров в уже выбранный шаблон.
 *
 * Неизвестный плейсхолдер остаётся на месте: это ошибка перевода, и видеть её в тексте
 * лучше, чем видеть `undefined` на месте слова.
 */
function fill(pattern: string, lang: Lang, params: Params): string {
  return pattern.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return typeof value === 'object' ? t(lang, value) : String(value);
  });
}

/**
 * Строка на языке игрока. Принимает и готовую фразу из таблицы, и шаблон со склейкой:
 * слова, которые собираются из Моделей, Лабораторий и чисел, заводятся через `msg`,
 * потому что в английском они стоят в другом порядке.
 *
 * Ключа, для которого нет перевода, `Key` не пропускает — но `Msg` может прийти из
 * словаря, собранного не нами, и тогда показывается русский шаблон: он уже написан и
 * показывать нечего.
 */
export function t(lang: Lang, message: Message, params?: Params): string {
  const rawKey = typeof message === 'string' ? message : message.key;
  const pattern = lang === 'en' ? (EN as Record<string, string>)[rawKey] : rawKey;
  const text = pattern ?? rawKey;
  return params ? fill(text, lang, params) : text;
}

/**
 * Фраза, склеенная из кусков. Отдельная функция, а не объект в поле таблицы, потому что
 * шаблон с плейсхолдерами без параметров — это опечатка, которую `t` не заметит, а
 * `msg` заставит назвать, что именно подставляется.
 */
export function msg(key: Key, params: Params): Msg {
  return { key, params };
}
