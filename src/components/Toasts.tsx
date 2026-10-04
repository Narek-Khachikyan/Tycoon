import React, { useEffect, useRef, useState } from 'react';
import { motionAllowed, useGameStore, type ToastMessage } from '../store/useGameStore';
import { ACHIEVEMENTS } from '../economy/achievements';

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

  useEffect(() => {
    const timer = setTimeout(dismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  // По имени анимации, а не по факту её окончания: входная toast-in завершается раньше
  // и удалять тост не должна.
  const handleAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.animationName === 'toast-out') onRemove(toast.id);
  };

  const ach = ACHIEVEMENTS.find((a) => a.id === toast.desc);

  return (
    <div
      onClick={dismiss}
      onAnimationEnd={handleAnimationEnd}
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
          {ach?.name ?? toast.desc}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {ach?.desc}
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

  // Веер снимается целиком: все искры стартуют и гаснут в один кадр, поэтому ждать последнюю
  // отдельно незачем, а вешать таймер нельзя — их и так убирает animationend.
  const handleFanEnd = () => setFan(null);

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
        <div className="burst-layer" onAnimationEnd={handleFanEnd}>
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
