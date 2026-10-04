import React, { useEffect, useRef, useState } from 'react';
import { motionAllowed, useGameStore, type BuyAmount } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { LABS } from '../data/labs';
import {
  bulkCost,
  canPrestige,
  discountMult,
  isContentFinale,
  maxAffordable,
  modelIncome,
  prestigeGain,
  sellRefund,
} from '../economy/engine';
import { availableUpgrades } from '../economy/upgrades';
import { PERKS } from '../economy/perks';
import { formatNumber } from '../economy/format';
import { MascotSprite } from './MascotSprite';

// 8 искр из точки покупки. Радиус 14–26 px — чуть больше самой кнопки, поэтому жест читается
// как отклик на нажатие, а не как залп.
const SPARK_COUNT = 8;
const SPARK = Array.from({ length: SPARK_COUNT }, (_, i) => {
  const angle = (i * 2.399963) % (Math.PI * 2);
  const dist = 14 + (i % 4) * 4;
  // Смещение вверх на 6 px: иначе веер уходит под строку и половина искр пропадает на краю карточки.
  return { dx: Math.round(Math.cos(angle) * dist), dy: Math.round(Math.sin(angle) * dist) - 6, size: 3 + (i % 2) };
});

let sparkCounter = 0;

/**
 * Строка Модели. Владеет своим откликом на покупку: магазин перерисовывается каждый тик, и
 * отмечать покупку в сторе значило бы гонять эффект по всей колонке двадцать раз в секунду.
 */
const ModelRow: React.FC<{
  owned: number;
  isFlagship: boolean;
  children: React.ReactNode;
}> = ({ owned, isFlagship, children }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const prevOwned = useRef(owned);
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (owned <= prevOwned.current) return;
    prevOwned.current = owned;

    const node = rowRef.current;
    if (!node) return;
    // Чтение ширины между снятием и возвратом класса — обязательный сброс анимации:
    // иначе второй хлопок подряд не запустится, класс ведь не менялся.
    node.classList.remove('model-row--pop');
    void node.offsetWidth;
    node.classList.add('model-row--pop');

    if (!motionAllowed()) return;
    // Искры летят из кнопки покупки — это и есть точка покупки. Координаты пересчитываются
    // в систему строки, потому что слой искр позиционирован относительно неё.
    const row = node.getBoundingClientRect();
    const buy = node.querySelector('.model-row__buy');
    const at = (buy ?? node).getBoundingClientRect();
    setSparks({
      id: ++sparkCounter,
      x: at.left + at.width / 2 - row.left,
      y: at.top + at.height / 2 - row.top,
    });
  }, [owned]);

  // Снимается целиком по последнему animationend: все восемь гаснут в один кадр, а таймеры
  // для их уборки в игре запрещены.
  const handleSparkEnd = () => setSparks(null);

  return (
    <div
      ref={rowRef}
      style={{
        position: 'relative',
        backgroundColor: 'var(--bg-card)',
        border: isFlagship ? '2px solid var(--gold)' : '1px solid var(--border)',
        borderRadius: '6px',
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {children}

      {sparks && (
        <div className="spark-layer" onAnimationEnd={handleSparkEnd}>
          {SPARK.map((s, i) => (
            <span
              key={`${sparks.id}-${i}`}
              className="spark"
              style={
                {
                  left: sparks.x,
                  top: sparks.y,
                  width: s.size,
                  height: s.size,
                  '--spark-dx': `${s.dx}px`,
                  '--spark-dy': `${s.dy}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};

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
  const finale = isContentFinale(state);

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
        borderLeft: '2px solid var(--border)',
        // Не даём колонке стать шире контейнера: на мобильном экране это обрезало бы правую часть.
        minWidth: 'min(360px, 100%)',
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
                backgroundColor: 'var(--red)',
                /* Чистый белый на насыщенной заливке: --text-main уводит подпись в тёплый
                   и роняет и без того пограничную пару до 3.06:1. */
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
            border: '1px solid var(--border)',
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
                backgroundColor: !sellMode ? 'var(--accent-solid)' : 'transparent',
                borderColor: !sellMode ? 'var(--accent-color)' : 'var(--border)',
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
                backgroundColor: sellMode ? 'var(--red-solid)' : 'transparent',
                borderColor: sellMode ? 'var(--red)' : 'var(--border)',
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
                  backgroundColor: buyAmount === amt ? 'var(--border)' : 'transparent',
                  color: buyAmount === amt ? 'var(--accent-color)' : 'var(--text-main)',
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
                <ModelRow key={m.id} owned={owned} isFlagship={m.isFlagship}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <MascotSprite lab={m.lab} size={28} />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="pixel-font" style={{ fontSize: '1rem', color: 'var(--text-main)' }}>
                            {m.name}
                          </span>
                          {m.isFlagship && (
                            <span
                              style={{
                                fontSize: '0.65rem',
                                backgroundColor: 'var(--gold-solid)',
                                color: 'var(--text-main)',
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

                    <div className="pixel-font" style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>
                      {owned}
                    </div>
                  </div>

                  {/* Доход и Кнопка покупки/продажи */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--green)' }}>
                      +{formatNumber(mIncome, notation)}/сек
                    </div>

                    <button
                      onClick={() => (sellMode ? sellAgents(m.id) : buyAgents(m.id))}
                      disabled={!canAfford}
                      className={`pixel-btn pixel-btn-accent model-row__buy`}
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.85rem',
                        backgroundColor: sellMode ? 'var(--red-solid)' : undefined,
                        borderColor: sellMode ? 'var(--red)' : undefined,
                      }}
                    >
                      {sellMode
                        ? `Продать (${formatNumber(refund, notation)})`
                        : `Купить ×${count} (${formatNumber(cost, notation)})`}
                    </button>
                  </div>

                  {/* Справка AA переключатель */}
                  {/* Волосяная линия остаётся литералом: 6% белого — это заведомо слабее
                     любой ступени лестницы рамок, и --border здесь превратил бы её в
                     самостоятельную рамку. */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px' }}>
                    <div
                      onClick={() => toggleAA(m.id)}
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--accent-color)',
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
                          backgroundColor: 'var(--bg-void)',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, 1fr)',
                          gap: '6px',
                        }}
                      >
                        <div>
                          <div style={{ color: 'var(--text-muted)' }}>Intelligence:</div>
                          <div style={{ color: 'var(--gold)', fontWeight: 700 }}>{m.iq} IQ</div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-muted)' }}>Скорость:</div>
                          <div style={{ color: 'var(--accent-color)', fontWeight: 700 }}>{m.speed} t/s</div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--text-muted)' }}>Цена API:</div>
                          <div style={{ color: 'var(--green)', fontWeight: 700 }}>${m.price}/1M</div>
                        </div>
                      </div>
                    )}
                  </div>
                </ModelRow>
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
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      padding: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="pixel-font" style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>
                        {u.name}
                      </span>
                      <span className="pixel-font" style={{ fontSize: '0.85rem', color: 'var(--accent-color)' }}>
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
                border: '2px solid var(--gold)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div className="pixel-font" style={{ fontSize: '1.1rem', color: 'var(--gold)' }}>
                🚀 Престиж в следующее Поколение
              </div>

              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Сбросит текущий Забег (Токены, Агенты, Апгрейды) и перенесёт вас в следующее Поколение.
              </div>

              <div
                style={{
                  backgroundColor: 'var(--tint-strong)',
                  padding: '8px',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                }}
              >
                <div>
                  Получите Compute:{' '}
                  <span className="pixel-font" style={{ color: 'var(--gold)', fontWeight: 700 }}>
                    +{prestigeGain(state)}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  (Каждая единица Compute даёт постоянный бонус +1% к Доходу)
                </div>
              </div>

              {!finale && (
                <button
                  onClick={triggerPrestige}
                  disabled={!canPrestige(state)}
                  className="pixel-btn pixel-btn-gold"
                  style={{ width: '100%', marginTop: '4px' }}
                >
                  {canPrestige(state) ? 'Сделать Престиж!' : '🔒 Нужен 1 Агент Флагмана'}
                </button>
              )}
            </div>

            {/* Магазин Перков */}
            <div>
              <div
                className="pixel-font"
                style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '8px' }}
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
                        border: owned ? '1px solid var(--green)' : '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="pixel-font" style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>
                          {p.name}
                        </span>
                        <span className="pixel-font" style={{ fontSize: '0.85rem', color: 'var(--gold)' }}>
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
