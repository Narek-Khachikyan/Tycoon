import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Ловушка фокуса для модального окна: фокус входит в окно, не выходит за него, Esc закрывает,
 * а при закрытии фокус возвращается на кнопку, которая окно открыла.
 *
 * Нативный `<dialog>` здесь не подошёл бы. Он поднимает окно в top layer, который рисуется
 * выше любого `z-index`, и тост о Достижении — а он по слою живёт выше модалок — оказался бы
 * за затемнением, хотя игра продолжает начислять Достижения под открытым окном.
 *
 * `closable: false` выключает Esc: окно Оффлайн-отчёта закрывается только своей кнопкой,
 * потому что игрок должен забрать начисленное и увидеть, сколько.
 */
export function useDialogFocus<T extends HTMLElement>(
  isOpen: boolean,
  onClose: () => void,
  closable = true,
) {
  const ref = useRef<T>(null);
  // Обработчик в рефе, а не в зависимостях: onClose пересоздаётся на каждом рендере оболочки,
  // и с ним в зависимостях эффект перезапускался бы двадцать раз в секунду — фокус всякий раз
  // возвращался бы на первую кнопку окна.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = ref.current;
    node?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!closable) return;
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Цикл замыкается на краях окна. Внутри ничего не трогаем: иначе Shift+Tab не дошёл бы
      // до последней кнопки, а обычный Tab — до первой.
      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Без возврата фокус падал бы на body, и следующий Tab начинал игру сначала.
      opener?.focus();
    };
  }, [isOpen, closable]);

  return ref;
}
