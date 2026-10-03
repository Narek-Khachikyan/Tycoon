import React, { useRef } from 'react';
import { useGameStore } from '../store/useGameStore';
import { totalIncome, clickValue } from '../economy/engine';
import { formatNumber } from '../economy/format';

export const ClickColumn: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const clickPrompt = useGameStore((s) => s.clickPrompt);
  const floaters = useGameStore((s) => s.floaters);
  const chatHistory = useGameStore((s) => s.chatHistory);
  const btnRef = useRef<HTMLButtonElement>(null);

  const income = totalIncome(state);
  const cVal = clickValue(state, income);
  const notation = state.settings.notation;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + (Math.random() * 40 - 20);
    const y = rect.top + 10;
    clickPrompt(x, y);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '20px 16px',
        backgroundColor: 'var(--bg-panel)',
        borderRight: '2px solid var(--border-color)',
        minWidth: '320px',
        maxWidth: '380px',
        gap: '18px',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* Floating numbers */}
      {floaters.map((f) => (
        <div key={f.id} className="floater" style={{ left: f.x, top: f.y }}>
          {f.text}
        </div>
      ))}

      {/* Токены и Доход */}
      <div style={{ textAlign: 'center', width: '100%' }}>
        <div
          className="pixel-font"
          style={{
            fontSize: '2.2rem',
            fontWeight: 700,
            color: '#38bdf8',
            lineHeight: 1.1,
            textShadow: '0 0 12px rgba(56, 189, 248, 0.4)',
          }}
        >
          {formatNumber(state.tokens, notation)}
        </div>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '2px' }}>
          Токенов
        </div>
        <div
          className="pixel-font"
          style={{
            fontSize: '1.1rem',
            color: '#4ade80',
            marginTop: '8px',
            fontWeight: 600,
          }}
        >
          +{formatNumber(income, notation)} / сек
        </div>
      </div>

      {/* Большая кнопка Клика */}
      <button
        ref={btnRef}
        onClick={handleClick}
        className="pixel-btn pixel-btn-accent pulse-glow"
        style={{
          width: '100%',
          padding: '24px 16px',
          fontSize: '1.25rem',
          borderRadius: '8px',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <span style={{ fontSize: '2rem' }}>💬</span>
        <span>Отправить промпт</span>
        <span
          style={{
            fontSize: '0.85rem',
            color: '#bae6fd',
            fontWeight: 400,
            fontFamily: 'Nunito',
          }}
        >
          +{formatNumber(cVal, notation)} Токенов за клик
        </span>
      </button>

      {/* Чат-пузыри */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          marginTop: '6px',
          flex: 1,
        }}
      >
        <div
          className="pixel-font"
          style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}
        >
          Диалог с моделью:
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            overflowY: 'auto',
            maxHeight: '340px',
            paddingRight: '4px',
          }}
        >
          {chatHistory.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                fontSize: '0.85rem',
              }}
            >
              {/* Промпт игрока */}
              <div
                style={{
                  alignSelf: 'flex-end',
                  backgroundColor: '#0369a1',
                  color: '#f0f9ff',
                  padding: '6px 10px',
                  borderRadius: '12px 12px 2px 12px',
                  maxWidth: '85%',
                  wordBreak: 'break-word',
                }}
              >
                {item.userPrompt}
              </div>

              {/* Ответ ИИ */}
              <div
                style={{
                  alignSelf: 'flex-start',
                  backgroundColor: 'var(--bg-card)',
                  color: '#e2e8f0',
                  padding: '6px 10px',
                  borderRadius: '12px 12px 12px 2px',
                  border: '1px solid var(--border-color)',
                  maxWidth: '90%',
                  whiteSpace: 'pre-line',
                  wordBreak: 'break-word',
                }}
              >
                {item.aiResponse}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
