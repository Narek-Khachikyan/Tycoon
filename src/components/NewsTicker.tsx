import React, { useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';

export const NewsTicker: React.FC = () => {
  const news = useGameStore((s) => s.news);
  const refreshNews = useGameStore((s) => s.refreshNews);

  useEffect(() => {
    const timer = setInterval(() => {
      refreshNews();
    }, 15000);
    return () => clearInterval(timer);
  }, [refreshNews]);

  return (
    <div
      onClick={refreshNews}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 14px',
        backgroundColor: '#0f111a',
        borderBottom: '1px solid var(--border-color)',
        fontSize: '0.9rem',
        cursor: 'pointer',
        gap: '8px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
      title="Нажмите, чтобы сменить новость"
    >
      <span style={{ color: '#fbbf24', fontWeight: 700 }}>📰 НОВОСТИ:</span>
      <span style={{ color: '#cbd5e1', textOverflow: 'ellipsis', overflow: 'hidden' }}>
        {news}
      </span>
    </div>
  );
};
