import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { ACHIEVEMENTS } from '../economy/achievements';
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

  const gen = CATALOG[state.generation];
  const unlockedAchCount = state.achievements.length;
  const totalAchCount = ACHIEVEMENTS.length;
  const isMuted = state.settings.muted;

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        backgroundColor: 'var(--bg-panel)',
        borderBottom: '2px solid var(--border-color)',
        flexWrap: 'wrap',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <h1 className="pixel-font" style={{ fontSize: '1.4rem', color: '#38bdf8', letterSpacing: '1px' }}>
          ⚡ AI TYCOON
        </h1>
        <span
          className="pixel-font"
          style={{
            fontSize: '0.85rem',
            backgroundColor: 'rgba(56, 189, 248, 0.15)',
            border: '1px solid #38bdf8',
            color: '#7dd3fc',
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
              backgroundColor: 'rgba(251, 191, 36, 0.15)',
              border: '1px solid #fbbf24',
              color: '#fef08a',
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
          className="pixel-btn"
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
