import React, { useState } from 'react';
import { useGameStore, type BuyAmount } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { LABS } from '../data/labs';
import {
  bulkCost,
  canPrestige,
  discountMult,
  maxAffordable,
  modelIncome,
  prestigeGain,
  sellRefund,
} from '../economy/engine';
import { availableUpgrades } from '../economy/upgrades';
import { PERKS } from '../economy/perks';
import { formatNumber } from '../economy/format';
import { MascotSprite } from './MascotSprite';

export const ShopColumn: React.FC = () => {
  const [tab, setTab] = useState<'models' | 'upgrades' | 'perks'>('models');
  const [expandedAA, setExpandedAA] = useState<Record<string, boolean>>({});

  const state = useGameStore((s) => s.state);
  const buyAmount = useGameStore((s) => s.buyAmount);
  const sellMode = useGameStore((s) => s.sellMode);
  const setBuyAmount = useGameStore((s) => s.setBuyAmount);
  const setSellMode = useGameStore((s) => s.setSellMode);
  const buyAgents = useGameStore((s) => s.buyAgents);
  const sellAgents = useGameStore((s) => s.sellAgents);
  const buyUpgrade = useGameStore((s) => s.buyUpgrade);
  const buyPerk = useGameStore((s) => s.buyPerk);
  const triggerPrestige = useGameStore((s) => s.triggerPrestige);

  const gen = CATALOG[state.generation];
  const notation = state.settings.notation;
  const d = discountMult(state);
  const upgrades = availableUpgrades(state);
  const unspentCompute = state.compute - state.computeSpent;

  const toggleAA = (id: string) => {
    setExpandedAA((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        backgroundColor: 'var(--bg-panel)',
        borderLeft: '2px solid var(--border-color)',
        minWidth: '360px',
        maxWidth: '440px',
        height: '100%',
        overflowY: 'hidden',
      }}
    >
      {/* Переключатель вкладок магазина */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        <button
          onClick={() => setTab('models')}
          className={`pixel-btn ${tab === 'models' ? 'pixel-btn-accent' : ''}`}
          style={{ flex: 1, padding: '8px 4px', fontSize: '0.9rem' }}
        >
          Модели
        </button>
        <button
          onClick={() => setTab('upgrades')}
          className={`pixel-btn ${tab === 'upgrades' ? 'pixel-btn-accent' : ''}`}
          style={{ flex: 1, padding: '8px 4px', fontSize: '0.9rem', position: 'relative' }}
        >
          Апгрейды
          {upgrades.length > 0 && (
            <span
              style={{
                marginLeft: '4px',
                backgroundColor: '#ef4444',
                color: '#fff',
                fontSize: '0.7rem',
                padding: '1px 5px',
                borderRadius: '8px',
              }}
            >
              {upgrades.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('perks')}
          className={`pixel-btn ${tab === 'perks' ? 'pixel-btn-accent' : ''}`}
          style={{ flex: 1, padding: '8px 4px', fontSize: '0.9rem' }}
        >
          Престиж
        </button>
      </div>

      {/* Верхняя панель множителей для Моделей */}
      {tab === 'models' && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            backgroundColor: 'var(--bg-card)',
            padding: '6px 10px',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
          }}
        >
          {/* Режим покупки / продажи */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setSellMode(false)}
              className="pixel-btn"
              style={{
                padding: '4px 8px',
                fontSize: '0.8rem',
                backgroundColor: !sellMode ? '#0284c7' : 'transparent',
                borderColor: !sellMode ? '#38bdf8' : 'var(--border-color)',
              }}
            >
              Купить
            </button>
            <button
              onClick={() => setSellMode(true)}
              className="pixel-btn"
              style={{
                padding: '4px 8px',
                fontSize: '0.8rem',
                backgroundColor: sellMode ? '#b91c1c' : 'transparent',
                borderColor: sellMode ? '#ef4444' : 'var(--border-color)',
              }}
            >
              Продать (25%)
            </button>
          </div>

          {/* Множители ×1, ×10, ×100, Max */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {([1, 10, 100, 'max'] as BuyAmount[]).map((amt) => (
              <button
                key={amt}
                onClick={() => setBuyAmount(amt)}
                className="pixel-btn"
                style={{
                  padding: '4px 7px',
                  fontSize: '0.8rem',
                  backgroundColor: buyAmount === amt ? 'var(--border-color)' : 'transparent',
                  color: buyAmount === amt ? '#38bdf8' : 'var(--text-main)',
                }}
              >
                {amt === 'max' ? 'Max' : `×${amt}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Контент активной вкладки */}
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
        {/* ВКЛАДКА МОДЕЛЕЙ */}
        {tab === 'models' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {gen.models.map((m) => {
              const owned = state.agents[m.id] ?? 0;
              const count = buyAmount === 'max' ? (sellMode ? owned : maxAffordable(m, owned, state.tokens, d)) : buyAmount;
              const cost = bulkCost(m, owned, count, d);
              const refund = sellRefund(m, owned, count, d);
              const canAfford = !sellMode ? count > 0 && cost <= state.tokens : owned >= count && count > 0;
              const mIncome = modelIncome(state, m);
              const isAAOpen = !!expandedAA[m.id];
              const lab = LABS[m.lab];

              return (
                <div
                  key={m.id}
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    border: m.isFlagship ? '2px solid #fbbf24' : '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <MascotSprite lab={m.lab} size={28} />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="pixel-font" style={{ fontSize: '1rem', color: '#f8fafc' }}>
                            {m.name}
                          </span>
                          {m.isFlagship && (
                            <span
                              style={{
                                fontSize: '0.65rem',
                                backgroundColor: '#b45309',
                                color: '#fef08a',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                fontWeight: 700,
                              }}
                            >
                              ★ ФЛАГМАН
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: lab.color }}>
                          {lab.name} • Ранг {m.rank + 1}
                        </div>
                      </div>
                    </div>

                    <div className="pixel-font" style={{ fontSize: '1.2rem', color: '#94a3b8' }}>
                      {owned}
                    </div>
                  </div>

                  {/* Доход и Кнопка покупки/продажи */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '0.8rem', color: '#4ade80' }}>
                      +{formatNumber(mIncome, notation)}/сек
                    </div>

                    <button
                      onClick={() => (sellMode ? sellAgents(m.id) : buyAgents(m.id))}
                      disabled={!canAfford}
                      className={`pixel-btn ${sellMode ? 'pixel-btn-accent' : 'pixel-btn-accent'}`}
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.85rem',
                        backgroundColor: sellMode ? '#b91c1c' : undefined,
                        borderColor: sellMode ? '#ef4444' : undefined,
                      }}
                    >
                      {sellMode
                        ? `Продать (${formatNumber(refund, notation)})`
                        : `Купить ×${count} (${formatNumber(cost, notation)})`}
                    </button>
                  </div>

                  {/* Справка AA переключатель */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px' }}>
                    <div
                      onClick={() => toggleAA(m.id)}
                      style={{
                        fontSize: '0.75rem',
                        color: '#38bdf8',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>📊 Справка Artificial Analysis</span>
                      <span>{isAAOpen ? '▲ скрыть' : '▼ подробнее'}</span>
                    </div>

                    {isAAOpen && (
                      <div
                        style={{
                          marginTop: '6px',
                          padding: '6px 8px',
                          backgroundColor: '#12141d',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, 1fr)',
                          gap: '6px',
                        }}
                      >
                        <div>
                          <div style={{ color: 'var(--text-muted)' }}>Intelligence:</div>
                          <div style={{ color: '#fbbf24', fontWeight: 700 }}>{m.iq} IQ</div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-muted)' }}>Скорость:</div>
                          <div style={{ color: '#38bdf8', fontWeight: 700 }}>{m.speed} t/s</div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-muted)' }}>Цена API:</div>
                          <div style={{ color: '#4ade80', fontWeight: 700 }}>${m.price}/1M</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ВКЛАДКА АПГРЕЙДОВ */}
        {tab === 'upgrades' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {upgrades.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px' }}>
                Пока нет доступных апгрейдов. Нанимайте больше агентов!
              </div>
            ) : (
              upgrades.map((u) => {
                const canAfford = state.tokens >= u.cost;
                return (
                  <div
                    key={u.id}
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      padding: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="pixel-font" style={{ fontSize: '0.95rem', color: '#f8fafc' }}>
                        {u.name}
                      </span>
                      <span className="pixel-font" style={{ fontSize: '0.85rem', color: '#38bdf8' }}>
                        {formatNumber(u.cost, notation)}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {u.desc}
                    </div>

                    <button
                      onClick={() => buyUpgrade(u.id)}
                      disabled={!canAfford}
                      className="pixel-btn pixel-btn-accent"
                      style={{ padding: '6px 10px', fontSize: '0.85rem', alignSelf: 'flex-end' }}
                    >
                      Улучшить
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ВКЛАДКА ПРЕСТИЖА И ПЕРКОВ */}
        {tab === 'perks' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Карточка совершения Престижа */}
            <div
              className="pixel-card"
              style={{
                padding: '12px',
                border: '2px solid #fbbf24',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div className="pixel-font" style={{ fontSize: '1.1rem', color: '#fbbf24' }}>
                🚀 Престиж в следующее Поколение
              </div>

              <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                Сбросит текущий Забег (Токены, Агенты, Апгрейды) и перенесёт вас в следующее Поколение.
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(0,0,0,0.3)',
                  padding: '8px',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                }}
              >
                <div>
                  Получите Compute:{' '}
                  <span className="pixel-font" style={{ color: '#fde047', fontWeight: 700 }}>
                    +{prestigeGain(state)}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  (Каждая единица Compute даёт постоянный бонус +1% к Доходу)
                </div>
              </div>

              <button
                onClick={triggerPrestige}
                disabled={!canPrestige(state)}
                className="pixel-btn pixel-btn-gold"
                style={{ width: '100%', marginTop: '4px' }}
              >
                {canPrestige(state) ? 'Сделать Престиж!' : '🔒 Нужен 1 Агент Флагмана'}
              </button>
            </div>

            {/* Магазин Перков */}
            <div>
              <div
                className="pixel-font"
                style={{ fontSize: '1rem', color: '#f8fafc', marginBottom: '8px' }}
              >
                Постоянные Перки (Свободно: {unspentCompute} Compute)
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {PERKS.map((p) => {
                  const owned = state.perks.includes(p.id);
                  const canAfford = !owned && unspentCompute >= p.cost;

                  return (
                    <div
                      key={p.id}
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        border: owned ? '1px solid #22c55e' : '1px solid var(--border-color)',
                        borderRadius: '6px',
                        padding: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="pixel-font" style={{ fontSize: '0.95rem', color: '#f8fafc' }}>
                          {p.name}
                        </span>
                        <span className="pixel-font" style={{ fontSize: '0.85rem', color: '#fbbf24' }}>
                          {p.cost} Compute
                        </span>
                      </div>

                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {p.desc}
                      </div>

                      <button
                        onClick={() => buyPerk(p.id)}
                        disabled={owned || !canAfford}
                        className={`pixel-btn ${owned ? '' : 'pixel-btn-gold'}`}
                        style={{ padding: '6px 10px', fontSize: '0.85rem', alignSelf: 'flex-end' }}
                      >
                        {owned ? '✅ Куплено' : 'Купить Перк'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
