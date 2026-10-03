import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px 12px',
        backgroundColor: '#0d0f17',
        borderTop: '1px solid var(--border-color)',
        fontSize: '0.78rem',
        color: 'var(--text-muted)',
        gap: '8px',
        flexWrap: 'wrap',
      }}
    >
      <span>
        Данные бенчмарков, задержек и цен предоставлены{' '}
        <a
          href="https://artificialanalysis.ai"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#38bdf8', textDecoration: 'none', fontWeight: 600 }}
        >
          Artificial Analysis ↗
        </a>
      </span>
      <span>•</span>
      <span>AI Tycoon MVP</span>
    </footer>
  );
};
