import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { LABS, type LabId } from '../data/labs';
import { canPrestige, isContentFinale } from '../economy/engine';
import { MascotSprite } from './MascotSprite';

export const OfficeColumn: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const triggerPrestige = useGameStore((s) => s.triggerPrestige);

  const gen = CATALOG[state.generation];
  const flagship = gen.flagship;
  const flagshipOwned = (state.agents[flagship.id] ?? 0) >= 1;
  const prestigeReady = canPrestige(state);
  const finale = isContentFinale(state);

  // Группировка купленных агентов по лабораториям
  const labCounts: Record<LabId, number> = {
    openai: 0,
    anthropic: 0,
    google: 0,
    xai: 0,
    deepseek: 0,
    meta: 0,
    mistral: 0,
    alibaba: 0,
  };

  let totalAgents = 0;
  for (const m of gen.models) {
    const count = state.agents[m.id] ?? 0;
    labCounts[m.lab] += count;
    totalAgents += count;
  }

  const activeLabs = (Object.keys(labCounts) as LabId[]).filter((l) => labCounts[l] > 0);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-primary)',
        height: '100%',
        overflowY: 'auto',
        padding: '16px',
        gap: '16px',
      }}
    >
      {/* Баннер Поколения и Флагмана */}
      <div
        className="pixel-card"
        style={{
          padding: '16px',
          borderLeft: `6px solid ${flagshipOwned ? '#fbbf24' : '#38bdf8'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            ЦЕЛЬ ПОКОЛЕНИЯ
          </div>
          <div className="pixel-font" style={{ fontSize: '1.25rem', color: '#f8fafc', marginTop: '2px' }}>
            Флагман: <span style={{ color: '#fbbf24' }}>{flagship.name}</span> ({LABS[flagship.lab].name})
          </div>
          <div style={{ fontSize: '0.85rem', color: flagshipOwned ? '#4ade80' : '#94a3b8', marginTop: '4px' }}>
            {flagshipOwned
              ? '✅ Флагман нанят! Престиж в следующее Поколение разблокирован.'
              : '🔒 Наймите хотя бы 1 Агента флагмана, чтобы открыть Престиж.'}
          </div>
        </div>

        {prestigeReady && !finale && (
          <button
            onClick={triggerPrestige}
            className="pixel-btn pixel-btn-gold"
            style={{ fontSize: '1rem', padding: '10px 16px' }}
          >
            🚀 Совершить Престиж
          </button>
        )}

        {finale && (
          <div
            style={{
              padding: '8px 14px',
              backgroundColor: 'rgba(251, 191, 36, 0.15)',
              border: '2px solid #fbbf24',
              borderRadius: '6px',
              textAlign: 'center',
            }}
          >
            <div className="pixel-font" style={{ color: '#fbbf24', fontSize: '1rem' }}>
              🌟 Финал контента MVP!
            </div>
            <div style={{ fontSize: '0.8rem', color: '#fef08a' }}>
              Вы на острие ИИ! Ждите новые реальные модели в будущих апдейтах.
            </div>
          </div>
        )}
      </div>

      {/* Визуализация Офиса */}
      <div
        className="pixel-card"
        style={{
          flex: 1,
          minHeight: '380px',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: '#161926',
          border: '2px solid var(--border-color)',
        }}
      >
        {/* Заголовок офиса */}
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span className="pixel-font" style={{ fontSize: '1rem', color: '#94a3b8' }}>
            🏢 ОФИС АГЕНТОВ ({totalAgents} сотрудников)
          </span>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
            {activeLabs.length} активных Лабораторий
          </span>
        </div>

        {/* Рабочая зона офиса с маскотами */}
        <div
          style={{
            flex: 1,
            padding: '20px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: '16px',
            alignContent: 'start',
            overflowY: 'auto',
          }}
        >
          {activeLabs.length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                color: 'var(--text-muted)',
                marginTop: '60px',
              }}
            >
              <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>🏢💤</div>
              <div className="pixel-font" style={{ fontSize: '1.1rem', color: '#e2e8f0' }}>
                Офис пока пуст
              </div>
              <div style={{ fontSize: '0.9rem', marginTop: '6px' }}>
                Наймите своего первого ИИ-Агента в магазине справа!
              </div>
            </div>
          ) : (
            activeLabs.map((labId) => {
              const lab = LABS[labId];
              const count = labCounts[labId];
              return (
                <div
                  key={labId}
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    border: `2px solid ${lab.color}`,
                    borderRadius: '8px',
                    padding: '12px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: `0 4px 10px rgba(0, 0, 0, 0.3)`,
                  }}
                >
                  <MascotSprite lab={labId} size={48} animated />

                  <div style={{ textAlign: 'center' }}>
                    <div
                      className="pixel-font"
                      style={{ fontSize: '0.95rem', color: lab.color, fontWeight: 700 }}
                    >
                      {lab.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Маскот: {lab.mascot}
                    </div>
                  </div>

                  <div
                    className="pixel-font"
                    style={{
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontSize: '0.85rem',
                      color: '#f8fafc',
                    }}
                  >
                    ×{count} Агентов
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
