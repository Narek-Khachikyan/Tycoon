import React, { useEffect, useRef } from 'react';
import { motionAllowed, useGameStore } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { ACHIEVEMENTS, ordinaryEarned } from '../economy/achievements';
import { formatNumber } from '../economy/format';

interface HeaderProps {
  onOpenAchievements: () => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenAchievements,
  onOpenStats,
  onOpenSettings,
}) => {
  const state = useGameStore((s) => s.state);
  const toggleMute = useGameStore((s) => s.toggleMute);
  const burst = useGameStore((s) => s.burst);
  const badgeRef = useRef<HTMLButtonElement>(null);

  const gen = CATALOG[state.generation];
  // Числитель — ordinaryEarned, а не achievements.length: тени лежат в том же списке, и
  // прямой длиной счётчик шапал бы выше знаменателя. Знаменатель остаётся только обычный.
  const unlockedAchCount = ordinaryEarned(state);
  const totalAchCount = ACHIEVEMENTS.length;
  const isMuted = state.settings.muted;

  // Значок — единственное место на экране, где Достижение остаётся видимым после того, как
  // тост уйдёт, поэтому пульсирует он, а не тост: вспышка тоста длится полсекунды.
  useEffect(() => {
    if (burst?.kind !== 'achievement' || !motionAllowed()) return;
    const node = badgeRef.current;
    if (!node) return;
    node.classList.remove('ach-badge--pulse');
    void node.offsetWidth;
    node.classList.add('ach-badge--pulse');
    const done = () => node.classList.remove('ach-badge--pulse');
    node.addEventListener('animationend', done);
    return () => node.removeEventListener('animationend', done);
  }, [burst?.nonce]);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        backgroundColor: 'var(--bg-panel)',
        borderBottom: '2px solid var(--border)',
        flexWrap: 'wrap',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h1 className="pixel-font" style={{ fontSize: '1.4rem', color: 'var(--accent-color)', letterSpacing: '1px' }}>
          ⚡ AI TYCOON
        </h1>
        <span
          className="pixel-font"
          style={{
            fontSize: '0.85rem',
            backgroundColor: 'var(--tint-accent)',
            border: '1px solid var(--accent-color)',
            color: 'var(--accent-hover)',
            padding: '2px 8px',
            borderRadius: '4px',
          }}
        >
          Поколение {gen.id}: {gen.name} ({gen.period})
        </span>
        {state.compute > 0 && (
          <span
            className="pixel-font"
            style={{
              fontSize: '0.85rem',
              backgroundColor: 'var(--tint-gold)',
              border: '1px solid var(--gold)',
              color: 'var(--gold)',
              padding: '2px 8px',
              borderRadius: '4px',
            }}
            title="Бонус к доходу от Compute"
          >
            🧠 {formatNumber(state.compute)} Compute (+{state.compute}%)
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          className="pixel-btn"
          onClick={toggleMute}
          title={isMuted ? 'Включить звук' : 'Выключить звук'}
          style={{ padding: '6px 10px', fontSize: '0.9rem' }}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>

        <button
          ref={badgeRef}
          className="pixel-btn ach-badge"
          onClick={onOpenAchievements}
          style={{ padding: '6px 12px', fontSize: '0.9rem' }}
        >
          🏆 {unlockedAchCount}/{totalAchCount}
        </button>

        <button
          className="pixel-btn"
          onClick={onOpenStats}
          style={{ padding: '6px 12px', fontSize: '0.9rem' }}
        >
          📊 Инфо
        </button>

        <button
          className="pixel-btn"
          onClick={onOpenSettings}
          style={{ padding: '6px 12px', fontSize: '0.9rem' }}
        >
          ⚙️
        </button>
      </div>
    </header>
  );
};
