import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px 12px',
        backgroundColor: 'var(--bg-void)',
        borderTop: '1px solid var(--border)',
        fontSize: '0.78rem',
        color: 'var(--text-muted)',
        gap: '8px',
        flexWrap: 'wrap',
      }}
    >
      <span>
        Данные бенчмарков, задержек и цен предоставлены{' '}
        {/* Цвет ссылки живёт в классе footer-aa-link, а не в inline: иначе inline-цвет
            перебил бы hover. Hover — только цвет, без движения. */}
        <a
          href="https://artificialanalysis.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-aa-link"
          style={{ textDecoration: 'none', fontWeight: 600 }}
        >
          Artificial Analysis ↗
        </a>
      </span>
      <span>•</span>
      <span>AI Tycoon MVP</span>
    </footer>
  );
};
