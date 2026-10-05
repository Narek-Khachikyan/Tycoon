import React, { useEffect, useRef, useState } from 'react';
import { motionAllowed, useGameStore } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { CHALLENGES, canStartChallenge } from '../economy/challenges';
import { formatNumber } from '../economy/format';
import { clickColWidth, shopColWidth, THREE_COL_MIN } from '../layout';
import { Num } from './Num';

/** Карточка держится столько, затем кроссфейд выхода. */
const SHOW_MS = 2600;
const EXIT_MS = 220;
/** Тиканье Compute стартует на ударе и идёт чуть дольше секунды. */
const TICK_DELAY_MS = 450;
const TICK_MS = 1200;
/** Частиц немного и только при разрешённом движении: CSS-гейт умеет остановить
 *  анимацию, но не убрать элемент, поэтому моты создаются лишь сюда. */
const MOTES = 14;

/**
 * Выбор испытания на свежем забеге. Испытание стартует только здесь: ядро разрешает его
 * лишь пока забег свежий, и блок виден ровно пока canStartChallenge. Несвежий забег скрывает
 * блок целиком, а не гасит кнопки: выбирать там уже нечего. После выбора ядро само выводит
 * забег из «свежих», поэтому локального состояния у блока нет — видимость читается из стора.
 *
 * Карточка не вуаль: игра под ней идёт, и выбор не блокирует Клик. Лежит над колонной Офиса,
 * а не над магазином: офис — единственная колонка с декоративной картинкой, и перекрывать её
 * ничего не теряет, тогда как над магазином карточка закрывала список Моделей — самый нужный
 * контент первых минут. Ширина колонн берётся из layout, иначе якоря разошлись бы с раскладкой.
 */
const ChallengePicker: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const startChallenge = useGameStore((s) => s.startChallenge);
  if (!canStartChallenge(state)) return null;
  // `canStartChallenge` — это про ДОПУСТИМОСТЬ, а не про момент вопроса, и на первом забеге эти
  // два смысла разошлись: условие требует `runClicks === 0`, то есть панель была верна только
  // пока игрок не сделал ничего. Она перекрывала Сцену, стояла поверх неё `position: fixed` и
  // перехватывала клики, а текст объяснял Престиж — до которого на первом забеге ещё 83 минуты.
  // Замерено на свежем сейве: панель видна с нулевого клика и исчезает после первого, то есть
  // ровно тогда, когда игрок начал играть.
  //
  // Спрашивать имеет смысл после первого Престижа: к этому моменту Престиж уже знаком, а забег
  // только что начался — ровно то окно, для которого условие «свежий забег» и писалось.
  if (state.generation === 0) return null;
  // Без слушателя ресайза: стор тикает каждые 50 мс, и подписка на состояние перерисовывает
  // карточку так часто, что ширина читается свежей без нового таймера.
  const vw = typeof window === 'undefined' ? THREE_COL_MIN : window.innerWidth;
  const single = vw < THREE_COL_MIN;
  return (
    <div
      style={{
        position: 'fixed',
        left: single ? '12px' : clickColWidth(vw) + 12,
        right: single ? '12px' : shopColWidth(vw) + 12,
        bottom: single ? '132px' : '72px',
        zIndex: 40,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        className="pixel-card"
        style={{
          pointerEvents: 'auto',
          width: '100%',
          maxWidth: '320px',
          padding: '12px 14px',
          backgroundColor: 'var(--bg-card)',
          border: '2px solid var(--gold)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
      <div style={{ fontSize: '0.9rem', color: 'var(--gold)' }}>Испытание Забега</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        Особое условие до следующего Престижа. Награда за прохождение — +10% к Доходу навсегда.
      </div>
      {CHALLENGES.map((c) => (
        <button
          key={c.id}
          className="pixel-btn"
          onClick={() => startChallenge(c.id)}
          style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '2px' }}
        >
          <span style={{ fontSize: '0.85rem' }}>{c.name}</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.desc}</span>
        </button>
      ))}
      <button
        className="pixel-btn"
        onClick={() => startChallenge(null)}
        style={{ color: 'var(--text-muted)' }}
      >
        Без испытания
      </button>
      </div>
    </div>
  );
};

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
  const [shown, setShown] = useState<{
    generation: number;
    computeGain: number;
    challengeId?: 'no-synergy' | 'no-click';
  } | null>(null);
  const [exiting, setExiting] = useState(false);
  const [withMotion, setWithMotion] = useState(false);
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
    // Счётчик пишет прямо в DOM-ноду, как счётчик Токенов: ре-рендер на каждый кадр не нужен.
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

  if (!shown) return <ChallengePicker />;
  const gen = CATALOG[shown.generation];
  // Престиж с активным испытанием: подтверждение называет его награду. Название и процент
  // читаются из таблицы ядра, а не из полезной нагрузки: стор привозит только id.
  const challenge = shown.challengeId
    ? CHALLENGES.find((c) => c.id === shown.challengeId)
    : undefined;

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
      {withMotion &&
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
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', letterSpacing: '4px' }}>
          ПРЕСТИЖ
        </div>
        {/* Без pixel-font: строка целиком кириллическая, а в Pixelify Sans нет даже «П»,
            и буквы брали бы запасной шрифт по одной — микс внутри строки (ADR-0003).
            Пиксельным остаётся число ниже, обёрнутое в Num. */}
        <div style={{ fontSize: '1.6rem', color: 'var(--accent-color)' }}>
          Поколение {shown.generation + 1}: {gen.name}
        </div>
        <div style={{ fontSize: '1rem', color: 'var(--text-main)' }}>
          +<span ref={gainRef}>
            <Num>{withMotion ? 0 : shown.computeGain}</Num>
          </span>{' '}
          Compute навсегда
        </div>
        {challenge && (
          <div style={{ fontSize: '0.85rem', color: 'var(--gold)' }}>
            Испытание пройдено: {challenge.name} — награда +{challenge.rewardPct}% к Доходу навсегда
          </div>
        )}
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>нажми, чтобы продолжить</div>
      </div>
    </div>
  );
};
