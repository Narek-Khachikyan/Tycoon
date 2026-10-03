import React, { useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { ACHIEVEMENTS } from '../economy/achievements';
import { exportSave } from '../economy/save';
import { formatDuration, formatNumber } from '../economy/format';
import { CATALOG } from '../economy/catalog';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AchievementsModal: React.FC<ModalProps> = ({ isOpen, onClose }) => {
  const state = useGameStore((s) => s.state);
  if (!isOpen) return null;

  const unlockedSet = new Set(state.achievements);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        className="pixel-card"
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px',
          gap: '14px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="pixel-font" style={{ fontSize: '1.3rem', color: '#fbbf24' }}>
            🏆 ДОСТИЖЕНИЯ ({state.achievements.length} / {ACHIEVEMENTS.length})
          </h2>
          <button className="pixel-btn" onClick={onClose} style={{ padding: '4px 10px' }}>
            ✕
          </button>
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {ACHIEVEMENTS.map((a) => {
            const unlocked = unlockedSet.has(a.id);
            return (
              <div
                key={a.id}
                style={{
                  backgroundColor: unlocked ? 'rgba(34, 197, 94, 0.1)' : 'var(--bg-card)',
                  border: unlocked ? '1px solid #22c55e' : '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ fontSize: '1.5rem' }}>{unlocked ? '🏆' : '🔒'}</div>
                <div style={{ flex: 1 }}>
                  <div
                    className="pixel-font"
                    style={{ fontSize: '0.95rem', color: unlocked ? '#86efac' : '#94a3b8' }}
                  >
                    {a.name}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{a.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const StatsModal: React.FC<ModalProps> = ({ isOpen, onClose }) => {
  const state = useGameStore((s) => s.state);
  if (!isOpen) return null;

  const now = Date.now();
  const playTimeSec = (now - state.startedAt) / 1000;
  const runTimeSec = (now - state.runStartedAt) / 1000;
  const notation = state.settings.notation;
  const totalAgents = Object.values(state.agents).reduce((a, b) => a + b, 0);

  const statRows = [
    ['Токенов сейчас', formatNumber(state.tokens, notation)],
    ['Токенов за текущий Забег', formatNumber(state.runTokens, notation)],
    ['Токенов за всё время', formatNumber(state.totalTokens, notation)],
    ['Кликов за Забег', state.runClicks.toLocaleString('ru-RU')],
    ['Кликов за всё время', state.clicks.toLocaleString('ru-RU')],
    ['Агентов в текущем офисе', totalAgents.toString()],
    ['Апгрейдов куплено', state.upgrades.length.toString()],
    ['Текущее Поколение', `${CATALOG[state.generation].id}: ${CATALOG[state.generation].name}`],
    ['Максимальное Поколение', `${CATALOG[state.maxGeneration].id}: ${CATALOG[state.maxGeneration].name}`],
    ['Престижей совершено', state.prestiges.toString()],
    ['Всего Compute', `${state.compute} (+${state.compute}% к доходу)`],
    ['Перков открыто', `${state.perks.length} / 13`],
    ['Время в текущем Забеге', formatDuration(runTimeSec)],
    ['Время за всё время игры', formatDuration(playTimeSec)],
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        className="pixel-card"
        style={{
          width: '100%',
          maxWidth: '520px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px',
          gap: '14px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="pixel-font" style={{ fontSize: '1.3rem', color: '#38bdf8' }}>
            📊 СТАТИСТИКА
          </h2>
          <button className="pixel-btn" onClick={onClose} style={{ padding: '4px 10px' }}>
            ✕
          </button>
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {statRows.map(([label, val]) => (
            <div
              key={label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 8px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '4px',
                fontSize: '0.85rem',
              }}
            >
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span className="pixel-font" style={{ color: '#f8fafc', fontWeight: 600 }}>
                {val}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const SettingsModal: React.FC<ModalProps> = ({ isOpen, onClose }) => {
  const state = useGameStore((s) => s.state);
  const setNotation = useGameStore((s) => s.setNotation);
  const toggleMute = useGameStore((s) => s.toggleMute);
  const importSaveData = useGameStore((s) => s.importSaveData);
  const resetGame = useGameStore((s) => s.resetGame);

  const [importCode, setImportCode] = useState('');
  const [copyStatus, setCopyStatus] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleExport = () => {
    const code = exportSave(state);
    navigator.clipboard.writeText(code).then(() => {
      setCopyStatus(true);
      setTimeout(() => setCopyStatus(false), 2000);
    });
  };

  const handleImport = () => {
    setErrorMsg('');
    if (!importCode.trim()) return;
    const ok = importSaveData(importCode.trim());
    if (ok) {
      setImportCode('');
      onClose();
    } else {
      setErrorMsg('Неверный код сохранения!');
    }
  };

  const handleReset = () => {
    if (window.confirm('Вы уверены, что хотите сбросить весь прогресс игры? Это действие необратимо!')) {
      resetGame();
      onClose();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        className="pixel-card"
        style={{
          width: '100%',
          maxWidth: '500px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px',
          gap: '16px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="pixel-font" style={{ fontSize: '1.3rem', color: '#f8fafc' }}>
            ⚙️ НАСТРОЙКИ
          </h2>
          <button className="pixel-btn" onClick={onClose} style={{ padding: '4px 10px' }}>
            ✕
          </button>
        </div>

        {/* Настройка нотации чисел */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>Формат больших чисел</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              1.23 M или 1.23e6
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => setNotation('short')}
              className={`pixel-btn ${state.settings.notation === 'short' ? 'pixel-btn-accent' : ''}`}
              style={{ padding: '6px 10px', fontSize: '0.85rem' }}
            >
              Буквы (M, B)
            </button>
            <button
              onClick={() => setNotation('sci')}
              className={`pixel-btn ${state.settings.notation === 'sci' ? 'pixel-btn-accent' : ''}`}
              style={{ padding: '6px 10px', fontSize: '0.85rem' }}
            >
              1e6
            </button>
          </div>
        </div>

        {/* Настройка звука */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>8-битный звук</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Звуковые эффекты клика и событий
            </div>
          </div>
          <button
            onClick={toggleMute}
            className={`pixel-btn ${!state.settings.muted ? 'pixel-btn-accent' : ''}`}
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
          >
            {state.settings.muted ? 'Выключен 🔇' : 'Включен 🔊'}
          </button>
        </div>

        {/* Экспорт и Импорт */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontWeight: 600 }}>Сохранение данных</div>

          <button onClick={handleExport} className="pixel-btn" style={{ width: '100%' }}>
            {copyStatus ? '✅ Скопировано в буфер!' : '📋 Скопировать сохранение в буфер'}
          </button>

          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
            <input
              type="text"
              placeholder="Вставьте код сохранения..."
              value={importCode}
              onChange={(e) => setImportCode(e.target.value)}
              style={{
                flex: 1,
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                color: '#fff',
                padding: '8px',
                borderRadius: '4px',
                fontSize: '0.85rem',
              }}
            />
            <button
              onClick={handleImport}
              className="pixel-btn pixel-btn-accent"
              style={{ padding: '8px 12px' }}
            >
              Импорт
            </button>
          </div>
          {errorMsg && <div style={{ color: '#ef4444', fontSize: '0.8rem' }}>{errorMsg}</div>}
        </div>

        {/* Полный сброс */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
          <button
            onClick={handleReset}
            className="pixel-btn"
            style={{
              width: '100%',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              borderColor: '#ef4444',
              color: '#fca5a5',
            }}
          >
            🗑️ Сбросить весь прогресс
          </button>
        </div>
      </div>
    </div>
  );
};

export const OfflineModal: React.FC = () => {
  const offlineReport = useGameStore((s) => s.offlineReport);
  const dismiss = useGameStore((s) => s.dismissOfflineReport);
  const notation = useGameStore((s) => s.state.settings.notation);

  if (!offlineReport) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: '16px',
      }}
    >
      <div
        className="pixel-card"
        style={{
          width: '100%',
          maxWidth: '440px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '14px',
          border: '2px solid #38bdf8',
        }}
      >
        <div style={{ fontSize: '3rem' }}>🌙⚡</div>
        <h2 className="pixel-font" style={{ fontSize: '1.4rem', color: '#38bdf8' }}>
          С ВОЗВРАЩЕНИЕМ!
        </h2>

        <div style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
          Пока вы отдыхали (
          <span style={{ color: '#fbbf24', fontWeight: 700 }}>
            {formatDuration(offlineReport.seconds)}
          </span>
          ), ваши ИИ-Агенты усердно трудились и заработали:
        </div>

        <div
          className="pixel-font"
          style={{
            fontSize: '2rem',
            color: '#4ade80',
            textShadow: '0 0 10px rgba(74, 222, 128, 0.5)',
          }}
        >
          +{formatNumber(offlineReport.earned, notation)} Токенов
        </div>

        <button
          onClick={dismiss}
          className="pixel-btn pixel-btn-accent"
          style={{ width: '100%', padding: '12px', fontSize: '1.1rem', marginTop: '6px' }}
        >
          Забрать токены!
        </button>
      </div>
    </div>
  );
};
