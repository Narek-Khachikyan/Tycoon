import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { currentGoals } from '../economy/goals';

/**
 * «Следующие цели» — до трёх строк: название цели и приглушённая подсказка.
 * Строки чисто информационные: клик ничего не делает, анимаций нет вообще,
 * поэтому при выключенном движении глушить нечего. Пусто — рендерит null.
 */
export const GoalsBanner: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const goals = currentGoals(state);
  if (goals.length === 0) return null;

  return (
    <section
      aria-label="Следующие цели"
      className="pixel-card"
      style={{
        padding: '10px 12px',
        marginBottom: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div style={{ fontSize: '0.95rem', color: 'var(--text-main)', fontWeight: 700 }}>
        Следующие цели
      </div>
      {goals.map((g) => (
        <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{g.title}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{g.hint}</div>
        </div>
      ))}
    </section>
  );
};
