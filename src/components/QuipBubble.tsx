import React from 'react';
import { LABS } from '../data/labs';
import { QUIPS } from '../data/quips';
import { quipsSeenOf, useGameStore } from '../store/useGameStore';
import { MascotSprite } from './MascotSprite';
import { useDialogFocus } from './useDialogFocus';

/**
 * Пузырь реплики говорящей Модели: портрет Маскота говорящего плюс текст.
 *
 * Слой декоративный (pointerEvents none): пузырь живёт поверх Сцены и не должен
 * перехватывать клики по Глюкам и Золотому Токену. Когда Маскотов ещё нет, пузырь
 * встаёт по центру Сцены — у «пустого стола», и первая реплика видна до первой покупки.
 * Вход — pop пружиной, уход — fade с CSS-задержкой (см. quip-pop/quip-fade в index.css);
 * стор гасит поле уже после fade, при reducedMotion остаётся только opacity.
 */
export const QuipBubble: React.FC = () => {
  const lastQuip = useGameStore((s) => s.lastQuip);
  const agents = useGameStore((s) => s.state.agents);
  if (!lastQuip) return null;

  const empty = Object.values(agents).every((n) => (n ?? 0) <= 0);
  const lab = lastQuip.lab ? LABS[lastQuip.lab] : null;

  return (
    <div
      key={lastQuip.nonce}
      className="quip-bubble pixel-card"
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        ...(empty ? { top: '30%' } : { bottom: '104px' }),
        zIndex: 4,
        pointerEvents: 'none',
        maxWidth: 'min(320px, 86%)',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}
    >
      {lab && lastQuip.lab && <MascotSprite lab={lastQuip.lab} size={32} />}
      <div style={{ minWidth: 0 }}>
        {lab && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{lab.name}</div>
        )}
        <div style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{lastQuip.text}</div>
      </div>
    </div>
  );
};

interface QuipLogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * «Переписка»: собранные реплики говорящих Моделей с портретами Маскотов.
 *
 * Читает quipsSeen из состояния и QUIPS из данных: порядок — каталожный, счётчик —
 * «N собрано». Пустая — тоже состояние, а не отсутствие окна: новичок должен увидеть,
 * что коллекция существует, до первой реплики. Оформление — как остальные модалки
 * (скрим, pixel-card, вход toast-fade — только opacity, поэтому при reducedMotion
 * картина та же). Фокус — через useDialogFocus, как везде.
 */
export const QuipLogModal: React.FC<QuipLogProps> = ({ isOpen, onClose }) => {
  const state = useGameStore((s) => s.state);
  // Хук обязан стоять до раннего выхода: иначе окно то открывалось бы с ловушкой, то без неё.
  const cardRef = useDialogFocus<HTMLDivElement>(isOpen, onClose);
  if (!isOpen) return null;

  const seen = new Set(quipsSeenOf(state));
  const found = QUIPS.filter((q) => seen.has(q.id));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--bg-scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '16px',
        animation: 'toast-fade 0.18s ease-out',
      }}
      onClick={onClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiplog-title"
        className="pixel-card"
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px',
          gap: '14px',
          animation: 'toast-fade 0.18s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 id="quiplog-title" style={{ fontSize: '1.3rem', color: 'var(--gold)' }}>
            ПЕРЕПИСКА ({seen.size} собрано)
          </h2>
          <button
            className="pixel-btn"
            onClick={onClose}
            aria-label="Закрыть"
            title="Закрыть"
            style={{ padding: '4px 10px' }}
          >
            ✕
          </button>
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {found.length === 0 ? (
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Пока пусто — кликай, и Модели заговорят.
            </div>
          ) : (
            found.map((q) => (
              <div
                key={q.id}
                style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                <MascotSprite lab={q.lab} size={28} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {LABS[q.lab].name}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{q.text}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <button className="pixel-btn" onClick={onClose} style={{ alignSelf: 'flex-end' }}>
          Закрыть
        </button>
      </div>
    </div>
  );
};
