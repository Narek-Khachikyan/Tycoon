import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motionAllowed, useGameStore, type ToastMessage } from '../store/useGameStore';

const TOAST_MS = 4000;

// 24 искры вокруг Достижения. Угол и дальность разводит золотой угол: по равномерной сетке
// веер встаёт в правильную розетку и читается как гирлянда, а не как вспышка.
const FAN_COUNT = 24;
const FAN = Array.from({ length: FAN_COUNT }, (_, i) => {
  const angle = (i * 2.399963) % (Math.PI * 2);
  const dist = 34 + ((i * 7) % 11) * 5;
  return { dx: Math.round(Math.cos(angle) * dist), dy: Math.round(Math.sin(angle) * dist), size: 4 + (i % 3) };
});

let fanCounter = 0;

/**
 * Одноразовая CSS-анимация, которая обязана довести элемент до конца.
 *
 * Снимает элемент только кадр анимации, и прерванная анимация кадра не порождает: правила
 * `[data-motion='reduced'] .toast-card--out { animation: none }` и
 * `[data-motion='reduced'] .burst-particle { animation: none }` при смене настройки на ходу
 * убивают идущую анимацию, а animationend после отмены не наступает уже никогда — карточка
 * (а с веером это ещё и слой `inset: 0` поверх всей игры) остаётся в DOM до конца сессии.
 *
 * Каналов три, таймеров нет:
 *   1. animationend — анимация дошла до конца;
 *   2. animationcancel — её сняли, то есть её больше не будет. Слушатель нативный: React 19
 *      не знает про это событие (свойства onAnimationCancel в типах нет), а по кольцу оно
 *      приходит ещё и от каждой искры веера, что и нужно — снимать веер целиком;
 *   3. настройка игрока, прочитанная из магазина: она меняется в том же коммите, что и
 *      data-motion, и потому снимает элемент раньше, чем браузер применит новые стили.
 *
 * Канала 1 в одиночку мало и потому, что системное «уменьшить движение» меняется без
 * действия игрока: магазин о нём не узнаёт, и событие от CSS остаётся единственным сигналом.
 *
 * Имя анимации нужно по делу: у карточки одновременно идут toast-in на ней самой и toast-flash
 * на ::before, и отменяются они тем же событием, что и toast-out.
 */
function useOneShot(started: boolean, name: string, settle: () => void) {
  const reducedMotion = useGameStore((s) => s.state.settings.reducedMotion);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (started && reducedMotion) settle();
  }, [started, reducedMotion, settle]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !started) return;
    const onCancel = (e: AnimationEvent) => {
      if (e.animationName === name) settle();
    };
    node.addEventListener('animationcancel', onCancel);
    return () => node.removeEventListener('animationcancel', onCancel);
  }, [started, name, settle]);

  // Кадр отбирается по имени анимации, а не по факту её окончания: входная анимация карточки
  // завершается раньше, и снимать по ней элемент нельзя.
  const onAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.animationName === name) settle();
  };

  return { ref, onAnimationEnd };
}

const ToastItem: React.FC<{ toast: ToastMessage; onRemove: (id: string) => void }> = ({
  toast,
  onRemove,
}) => {
  const [leaving, setLeaving] = useState(false);

  // Выходной кадр ставится только при разрешённом движении: без анимации тост обязан уйти
  // сразу, иначе animationend не наступит и карточка останется на экране навсегда.
  const dismiss = () => {
    if (motionAllowed()) setLeaving(true);
    else onRemove(toast.id);
  };

  const settle = useCallback(() => onRemove(toast.id), [onRemove, toast.id]);
  const { ref, onAnimationEnd } = useOneShot(leaving, 'toast-out', settle);

  useEffect(() => {
    const timer = setTimeout(dismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  // Название и описание приезжают в тосте текстом, а не id. Раньше компонент сам искал запись
  // в ACHIEVEMENTS, и теневой id — а он в другой таблице — выводился бы на экран как есть.
  return (
    <div
      ref={ref}
      onClick={dismiss}
      onAnimationEnd={onAnimationEnd}
      className={`pixel-card toast-card${leaving ? ' toast-card--out' : ''}`}
      style={{
        padding: '12px 14px',
        backgroundColor: 'var(--bg-card)',
        border: '2px solid var(--gold)',
        // Тень остаётся литералом и вдвое гуще карточной: тост висит поверх живой игры,
        // а --tint-strong у .pixel-card рассчитан на фон, лежащий сразу под панелью.
        boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: 'pointer',
        maxWidth: '320px',
      }}
    >
      <div style={{ fontSize: '1.6rem' }}>🏆</div>
      <div>
        <div className="pixel-font" style={{ fontSize: '0.85rem', color: 'var(--gold)' }}>
          {toast.title}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 600 }}>
          {toast.name}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {toast.desc}
        </div>
      </div>
    </div>
  );
};

export const Toasts: React.FC = () => {
  const toasts = useGameStore((s) => s.toasts);
  const removeToast = useGameStore((s) => s.removeToast);
  const burst = useGameStore((s) => s.burst);
  const stackRef = useRef<HTMLDivElement>(null);
  const [fan, setFan] = useState<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (burst?.kind !== 'achievement') return;
    if (!motionAllowed()) return;
    // Якорь — свежайшая карточка в стопке: она и есть отметка о Достижении, на неё и летят искры.
    const card = stackRef.current?.lastElementChild;
    const rect = card instanceof HTMLElement ? card.getBoundingClientRect() : null;
    setFan({
      id: ++fanCounter,
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    });
  }, [burst?.nonce]);

  // Веер снимается целиком: у искр одна и та же анимация без задержки, поэтому гаснут они
  // одним кадром и ждать последнюю отдельно незачем. Гасит его useOneShot — иначе отмена
  // анимации оставила бы слой `inset: 0` висеть до конца сессии.
  const stopFan = useCallback(() => setFan(null), []);
  const { ref: fanRef, onAnimationEnd: onFanEnd } = useOneShot(fan !== null, 'burst-fly', stopFan);

  if (toasts.length === 0 && !fan) return null;

  return (
    <>
      <div
        ref={stackRef}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 100,
        }}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={removeToast} />
        ))}
      </div>

      {fan && (
        <div className="burst-layer" ref={fanRef} onAnimationEnd={onFanEnd}>
          {FAN.map((p, i) => (
            <span
              key={`${fan.id}-${i}`}
              className="burst-particle"
              style={
                {
                  left: fan.x,
                  top: fan.y,
                  width: p.size,
                  height: p.size,
                  '--burst-dx': `${p.dx}px`,
                  '--burst-dy': `${p.dy}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
    </>
  );
};
