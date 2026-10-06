import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { currentGoals } from '../economy/goals';
import { Icon } from './Icon';
import { useT } from '../i18n/useT';

export const GoalsBanner: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const goals = currentGoals(state);
  const t = useT();

  const [announced, setAnnounced] = useState<string | null>(null);
  const lastTop = useRef<string | null | undefined>(undefined);
  const topId = goals[0]?.id;
  const topTitle = goals[0]?.title;
  const topHint = goals[0]?.hint;

  useEffect(() => {
    if (topId === lastTop.current) return;
    const firstFrame = lastTop.current === undefined;
    lastTop.current = topId;
    if (firstFrame) return;
    setAnnounced(
      topId === undefined
        ? t('Все шаги пройдены — дальше свободная игра.')
        : t('Следующая цель: {title}. {hint}', {
            title: topTitle ? t(topTitle) : '',
            hint: topHint ? t(topHint) : '',
          })
    );
  }, [topId, topTitle, topHint, t]);

  return (
    <>
      <div role="status" aria-live="polite" className="visually-hidden">
        {announced ?? ''}
      </div>
      {goals.length > 0 && (
        <section
          aria-label={t('Следующие шаги')}
          className="pixel-card"
          style={{
            padding: '10px 12px',
            marginBottom: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
            }}
          >
            <Icon name="bolt" size={13} />
            {t('Следующие шаги')}
          </div>
          {goals.map((g, i) => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span
                className="pixel-font"
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--accent-color)',
                  minWidth: '14px',
                  textAlign: 'right',
                }}
              >
                {i + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{t(g.title)}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t(g.hint)}</div>
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
};
