import React, { useEffect, useRef, useState } from 'react';
import { effectAllowed, motionAllowed, useGameStore } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { formatNumber } from '../economy/format';
import { Num } from './Num';

/** Карточка держится столько, затем кроссфейд выхода. */
const SHOW_MS = 2600;
const EXIT_MS = 220;
/** Тиканье Compute стартует на ударе и идёт чуть дольше секунды. */
const TICK_DELAY_MS = 450;
const TICK_MS = 1200;
/** Частиц немного и только при разрешённом движении и включённых частицах: CSS-гейт умеет
 *  остановить анимацию, но не убрать элемент, поэтому моты создаются лишь сюда. */
const MOTES = 14;

/**
 * Полноэкранный отклик на Престиж в духе экрана вознесения Cookie Clicker: затемнение,
 * карточка нового Поколения с тикающим Compute и восходящие искры.
 * Яркой вспышки на весь экран нет намеренно — это триггер фоточувствительности,
 * вуаль только затемняет. Клик гасит раньше (тоже через выход, не обрубом);
 * при reducedMotion остаются лишь кроссфейды opacity и сразу финальное число.
 */
export const PrestigeOverlay: React.FC = () => {
  const burst = useGameStore((s) => s.burst);
  const notation = useGameStore((s) => s.state.settings.notation);
  const [shown, setShown] = useState<{ generation: number; computeGain: number } | null>(null);
  const [exiting, setExiting] = useState(false);
  const [withMotion, setWithMotion] = useState(false);
  const [withMotes, setWithMotes] = useState(false);
  const gainRef = useRef<HTMLSpanElement>(null);
  const doneRef = useRef(0);

  // Выход — всегда через кроссфейд, а не обрубом: клик лишь переносит его раньше.
  const beginExit = () => {
    setExiting((was) => {
      if (!was) {
        window.clearTimeout(doneRef.current);
        doneRef.current = window.setTimeout(() => setShown(null), EXIT_MS);
      }
      return true;
    });
  };

  useEffect(() => {
    if (burst?.kind !== 'prestige' || !burst.prestige) return;
    const payload = burst.prestige;
    const motion = motionAllowed();
    setShown(payload);
    setExiting(false);
    setWithMotion(motion);
    // Моты — частицы, и выключатель игрока гасит их, не трогая тиканье Compute и масштаб карточки.
    setWithMotes(effectAllowed('particles'));
    // Счётчик пишет прямо в DOM-ноду, как счётчик Токенов: ре-рендер на каждый кадр не нужен.
    // Письмо идёт в textContent, поэтому класс pixel-font обязан стоять на самой этой ноде —
    // на обёртке он остался бы в Nunito, и число меняло бы начертание в момент старта
    // тиканья, то есть ровно тогда, когда игрок на него смотрит.
    let raf = 0;
    if (motion && payload.computeGain > 0) {
      const t0 = performance.now() + TICK_DELAY_MS;
      const step = (t: number) => {
        const p = Math.min(Math.max((t - t0) / TICK_MS, 0), 1);
        const eased = 1 - Math.pow(1 - p, 3);
        if (gainRef.current) {
          gainRef.current.textContent = formatNumber(Math.round(payload.computeGain * eased), notation);
        }
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    // Разовые таймеры, а не интервалы: показ → выход → unmount.
    const exit = window.setTimeout(() => beginExit(), SHOW_MS);
    doneRef.current = window.setTimeout(() => setShown(null), SHOW_MS + EXIT_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(exit);
      window.clearTimeout(doneRef.current);
    };
  }, [burst?.kind, burst?.nonce, notation]);

  if (!shown) return null;
  const gen = CATALOG[shown.generation];

  return (
    <div
      className={`prestige-veil${exiting ? ' prestige-veil--out' : ''}`}
      onClick={beginExit}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
        cursor: 'pointer',
      }}
    >
      {withMotes &&
        Array.from({ length: MOTES }, (_, i) => (
          <span
            key={i}
            className="prestige-mote"
            style={{
              left: `${(i * 71 + 7) % 100}%`,
              animationDelay: `${i * 70}ms`,
            }}
          />
        ))}
      <div className="prestige-card pixel-card" style={{ textAlign: 'center', padding: '28px 36px' }}>
        <div
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            letterSpacing: '4px',
            // Отступ первой строки равен межбуквенному: последняя буква разрядки тоже занимает
            // 4 px, и без компенсации центрированная надпись висела на 4 px левее середины.
            textIndent: '4px',
          }}
        >
          ПРЕСТИЖ
        </div>
        {/* Строка названия Поколения — в Nunito: слово «Поколение» кириллическое, а в
            Pixelify Sans её нет (ADR-0003), и в пиксельном начертании она молча уходила в
            фолбэк — слово обычным шрифтом рядом с пиксельным номером на одной строке.
            Пиксельным остаётся только число, ради которого этот приём и существует. */}
        <div style={{ fontSize: '1.6rem', color: 'var(--accent-color)' }}>
          Поколение <Num>{shown.generation + 1}</Num>: {gen.name}
        </div>
        <div style={{ fontSize: '1rem', color: 'var(--text-main)' }}>
          +<span ref={gainRef} className="pixel-font">
            {withMotion ? 0 : formatNumber(shown.computeGain, notation)}
          </span>{' '}
          Compute навсегда
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>нажми, чтобы продолжить</div>
      </div>
    </div>
  );
};
