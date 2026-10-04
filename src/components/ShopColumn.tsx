import React, { useEffect, useRef, useState } from 'react';
import { motionAllowed, useGameStore, type BuyAmount } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { LABS } from '../data/labs';
import {
  bulkCost,
  canPrestige,
  discountMult,
  incomeGain,
  isContentFinale,
  maxAffordable,
  prestigeGain,
  sellRefund,
  shortfall,
} from '../economy/engine';
import { availableUpgrades } from '../economy/upgrades';
import { PERKS } from '../economy/perks';
import { formatCount, formatNumber } from '../economy/format';
import type { Notation } from '../economy/state';
import { MascotSprite } from './MascotSprite';
import { Num } from './Num';
import { Icon } from './Icon';
import { playDenySound } from '../audio/sound';

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
 * Строка «Не хватает N Токенов».
 *
 * Живёт под кнопкой покупки и всегда занимает строку, даже когда дефицита нет: иначе карточка
 * прыгала бы по высоте на каждом тике, а с ней и кнопка под ней. aria-live не ставится — число
 * меняется двадцать раз в секунду и иначе читалось бы вслух.
 */
const TokenDeficit: React.FC<{ amount: number; notation: Notation }> = ({ amount, notation }) => {
  // Снятие deny-вспышки по концу анимации, а не по таймеру: таймеры в компонентах запрещены.
  // Проверка цели не нужна — анимация висит только на этом узле, чужих animationend здесь нет.
  const handleDenyEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove('deny-flash');
  };
  return (
    <div
      className="token-deficit"
      onAnimationEnd={handleDenyEnd}
      style={{
        minHeight: '1em',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        textAlign: 'right',
      }}
    >
      {amount > 0 && (
        <>
          Не хватает <Num>{formatNumber(amount, notation)}</Num>{' '}
          {formatCount(Math.round(amount), 'Токен', 'Токена', 'Токенов')}
        </>
      )}
    </div>
  );
};

/**
 * Строка Модели. Владеет своим откликом на покупку: магазин перерисовывается каждый тик, и
 * отмечать покупку в сторе значило бы гонять эффект по всей колонке двадцать раз в секунду.
 */
const ModelRow: React.FC<{
  owned: number;
  isFlagship: boolean;
  canAfford: boolean;
  children: React.ReactNode;
}> = ({ owned, isFlagship, canAfford, children }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const prevOwned = useRef(owned);
  const prevAfford = useRef(canAfford);
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    // Сравниваем с предыдущим значением, а записываем новое при любом изменении: если писать
    // только на покупке, после продажи ref навсегда остался бы на историческом максимуме, и
    // возврат к уже державшемуся числу Агентов не дал бы ни хлопка, ни искр.
    const before = prevOwned.current;
    prevOwned.current = owned;
    if (owned <= before) return;

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

  // Вспышка разблокировки: переход disabled→enabled раньше был тихим, и игрок замечал
  // доступную Модель только по кнопке. Начальное значение ref — текущее, поэтому монтирование
  // со сразу доступной покупкой не мигает.
  useEffect(() => {
    const before = prevAfford.current;
    prevAfford.current = canAfford;
    if (before || !canAfford) return;
    const node = rowRef.current;
    if (!node) return;
    // Тот же сброс, что у model-row--pop: иначе повторная разблокировка подряд не запустится.
    node.classList.remove('model-row--unlock');
    void node.offsetWidth;
    node.classList.add('model-row--unlock');
  }, [canAfford]);

  // Снятие unlock по концу анимации. Страж цели обязателен: animationend искр всплывает
  // до строки, а гасить чужую вспышку здесь нельзя.
  const handleUnlockEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    e.currentTarget.classList.remove('model-row--unlock');
  };

  return (
    <div
      ref={rowRef}
      onAnimationEnd={handleUnlockEnd}
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

export const ShopColumn: React.FC<{ full?: boolean }> = ({ full = false }) => {
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
  const prestigeReady = canPrestige(state);
  // Вкладка приглушена, а не скрыта: скрытая вкладка — дверь в одну сторону, и игрок
  // не узнал бы, что Престиж вообще существует. На финале контента Престиж недоступен
  // навсегда, поэтому приглушение там не снимается.
  const prestigeLocked = finale || !prestigeReady;

  // Двухшаговый Престиж: сброс Забега необратим, поэтому первый Клик только взводит
  // кнопку, а второй в течение ARM_MS выполняет переход в новое Поколение. Звук живёт
  // внутри triggerPrestige и на взводе молчит. Взвод держится локально в этом файле,
  // общий компонент не выделяем — кнопки в проекте живут локально. Красная заливка —
  // тот же знак необратимости, что у режима продажи.
  const ARM_MS = 6000;
  const [prestigeArmed, setPrestigeArmed] = useState(false);
  const prestigeTimer = useRef<number | null>(null);
  // Размонтирование гасит one-shot: иначе он сбросил бы подпись уже несуществующей кнопки.
  useEffect(
    () => () => {
      if (prestigeTimer.current !== null) window.clearTimeout(prestigeTimer.current);
    },
    [],
  );
  // Взвод не переживает условия, при которых кнопку показали: недоступный Престиж
  // или уход с вкладки снимают его вместе с таймером.
  useEffect(() => {
    if (prestigeLocked || tab !== 'perks') {
      if (prestigeTimer.current !== null) {
        window.clearTimeout(prestigeTimer.current);
        prestigeTimer.current = null;
      }
      setPrestigeArmed(false);
    }
  }, [prestigeLocked, tab]);

  const handlePrestige = () => {
    if (!prestigeArmed) {
      setPrestigeArmed(true);
      prestigeTimer.current = window.setTimeout(() => {
        prestigeTimer.current = null;
        setPrestigeArmed(false);
      }, ARM_MS);
      return;
    }
    if (prestigeTimer.current !== null) {
      window.clearTimeout(prestigeTimer.current);
      prestigeTimer.current = null;
    }
    setPrestigeArmed(false);
    triggerPrestige();
  };

  const toggleAA = (id: string) => {
    setExpandedAA((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const muted = state.settings.muted;

  // Класс click-btn--squash переиспользован из ClickColumn для кнопки Перка: карточка
  // Перка после покупки остаётся (меняется на «Куплено»), поэтому сквош успевает
  // показаться — плюс уже существующий звук из стора. Перезапуск и снятие — тем же
  // приёмом, что на кнопке Клика: сброс чтением ширины, снятие по onAnimationEnd,
  // без таймеров.
  const restartSquash = (e: React.MouseEvent<HTMLButtonElement>) => {
    const node = e.currentTarget;
    node.classList.remove('click-btn--squash');
    void node.offsetWidth;
    node.classList.add('click-btn--squash');
  };
  const handleSquashEnd = (e: React.AnimationEvent<HTMLButtonElement>) => {
    e.currentTarget.classList.remove('click-btn--squash');
    // Снятие deny-вспышки по концу анимации, а не по таймеру: таймеры в компонентах запрещены.
    // Сквош и deny на одной кнопке не совпадают (сквош — успешная покупка, deny — Клик по
    // disabled), поэтому общее снятие чужую анимацию не обрезает.
    e.currentTarget.classList.remove('deny-flash');
  };

  // Отказ по недоступной покупке: кнопка остаётся disabled (a11y не ломается), а Клик
  // ловит обёртка на погружении и отвечает низким buzz плюс вспышкой строки дефицита.
  const handleDeny =
    (affordable: boolean) => (e: React.MouseEvent<HTMLDivElement>) => {
      if (affordable) return;
      playDenySound(muted);
      const node = e.currentTarget.querySelector('.token-deficit');
      if (!(node instanceof HTMLElement)) return;
      node.classList.remove('deny-flash');
      void node.offsetWidth;
      node.classList.add('deny-flash');
    };

  // Отказ по недоступному Перку — тем же приёмом, что у Моделей/Апгрейдов, но вспышка висит
  // на самой кнопке: строки дефицита у Перков нет и мигать рядом нечему. Купленный Перк —
  // статус, а не ошибка, поэтому обёртка получает owned || canAfford и по «Куплено» молчит.
  const handlePerkDeny =
    (affordable: boolean) => (e: React.MouseEvent<HTMLDivElement>) => {
      if (affordable) return;
      playDenySound(muted);
      const node = e.currentTarget.querySelector('.pixel-btn');
      if (!(node instanceof HTMLElement)) return;
      node.classList.remove('deny-flash');
      void node.offsetWidth;
      node.classList.add('deny-flash');
    };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        backgroundColor: 'var(--bg-panel)',
        borderLeft: '2px solid var(--border)',
        // Базис приходит из модуля раскладки: раньше ширина считалась по содержимому вкладки,
        // и переход «Модели» → «Апгрейды» сужал колонку примерно на 18%, а офис вбирал разницу.
        // В одноколоночном режиме колонка единственная и занимает всю ширину.
        flex: full ? '1 1 auto' : '0 0 var(--col-shop)',
        minWidth: 0,
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
              key={upgrades.length}
              className="tab-badge--pulse"
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
          title={
            finale
              ? 'Ты дошёл до последнего поколения — дальше престиж недоступен'
              : prestigeReady
                ? undefined
                : 'Найми 1 агента флагмана, чтобы разблокировать престиж'
          }
          style={{
            flex: 1,
            padding: '8px 4px',
            fontSize: '0.9rem',
            ...(prestigeLocked
              ? { color: 'var(--text-muted)', borderColor: 'var(--border)' }
              : undefined),
          }}
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
          {/* Режим покупки / продажи. Оформление выбранного состояния живёт в index.css и
              держится на aria-pressed, поэтому здесь нет inline-заливок: они перебили бы
              общий паттерн и разошлись бы с множителем покупки. */}
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setSellMode(false)}
              className="pixel-btn"
              aria-pressed={!sellMode}
              style={{ padding: '4px 8px', fontSize: '0.8rem' }}
            >
              Купить
            </button>
            <button
              onClick={() => setSellMode(true)}
              className="pixel-btn pixel-btn-sell"
              aria-pressed={sellMode}
              style={{ padding: '4px 8px', fontSize: '0.8rem' }}
            >
              Продать
            </button>
          </div>

          {/* Множители ×1, ×10, ×100, Max */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {([1, 10, 100, 'max'] as BuyAmount[]).map((amt) => (
              <button
                key={amt}
                onClick={() => setBuyAmount(amt)}
                className="pixel-btn"
                aria-pressed={buyAmount === amt}
                style={{ padding: '4px 7px', fontSize: '0.8rem' }}
              >
                {amt === 'max' ? 'Max' : <>&times;<Num>{amt}</Num></>}
              </button>
            ))}
          </div>

          {/* Строка про возврат живёт только в режиме продажи: в режиме покупки её нечего
              читать, а возврат и так назван прямо на кнопке карточки. */}
          {sellMode && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
              Возврат 25% от цены
            </div>
          )}
        </div>
      )}

      {/* Контент активной вкладки. key по вкладке: переключение даёт короткое появление
          только через opacity toast-fade, состояние tab и expandedAA не трогаем. */}
      <div
        key={tab}
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingRight: '4px',
          animation: 'toast-fade 0.15s ease-out',
        }}
      >
        {/* ВКЛАДКА МОДЕЛЕЙ */}
        {tab === 'models' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {gen.models.map((m) => {
              const owned = state.agents[m.id] ?? 0;
              const count = buyAmount === 'max' ? (sellMode ? owned : maxAffordable(m, owned, state.tokens, d)) : buyAmount;
              const cost = bulkCost(m, owned, count, d);
              const refund = sellRefund(m, owned, count, d);
              const canAfford = !sellMode ? count > 0 && cost <= state.tokens : owned >= count && count > 0;
              // Прирост общего Дохода именно от этой покупки, посчитанный движком. Отдельная
              // формула в компоненте разошлась бы с экономикой на первом же Перке или Синергии.
              // Продажа ограничена тем, что есть: sellAgents берёт min(n, owned), и подпись про
              // большую сделку, чем возможна, вводила бы в заблуждение.
              const gain = incomeGain(state, m.id, sellMode ? Math.min(count, owned) : count);
              const isAAOpen = !!expandedAA[m.id];
              const lab = LABS[m.lab];

              // Дефицит: при фиксированном множителе он считается на всю сумму покупки, а при Max
              // с пустым кошельком покупки нет вообще — тогда показываем, чего стоит одна единица.
              const missing =
                sellMode || canAfford ? 0 : shortfall(count > 0 ? cost : bulkCost(m, owned, 1, d), state.tokens);

              // Строка прироста описывает действие, которое кнопка действительно выполнит. Покупка,
              // которая не по карману, подпись всё равно заслуживает: рядом стоит строка дефицита.
              // А вот продать нечего — и обе цифры, и кнопка были бы пустыми.
              const showsGain = sellMode ? owned > 0 : count > 0;

              return (
                <ModelRow key={m.id} owned={owned} isFlagship={m.isFlagship} canAfford={canAfford}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <MascotSprite lab={m.lab} size={28} />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '1rem', color: 'var(--text-main)' }}>{m.name}</span>
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

                    {/* Подпись обязательна: голое число не отличить от счётчика чего-то другого. */}
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                      <div style={{ fontSize: '1.2rem' }}>
                        <Num>{owned}</Num>
                      </div>
                      <div>{formatCount(owned, 'Агент', 'Агента', 'Агентов')}</div>
                    </div>
                  </div>

                  {/* Обёртка ловит Клик по недоступной покупке на погружении: сама кнопка
                      при этом остаётся disabled, поэтому a11y-контракт не ломается, а отказ
                      отвечает звуком и вспышкой строки дефицита. Клик точно в disabled-кнопку
                      браузер подавляет, поэтому недоступная кнопка прозрачна для указателя
                      (pointer-events: none) и Клик падает на обёртку; курсор «нельзя» висит
                      на обёртке, а не на кнопке. */}
                  <div
                    onClickCapture={handleDeny(canAfford)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      ...(canAfford ? undefined : { cursor: 'not-allowed' }),
                    }}
                  >
                  {/* Прирост Дохода и кнопка покупки/продажи. Цена живёт только здесь — на всех
                      вкладках магазина, чтобы её не приходилось искать в двух местах. */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '0.8rem', color: sellMode ? 'var(--red)' : 'var(--green)' }}>
                      {/* При пустом действии строка молчит: «−0 к доходу» и «+0 к доходу» не
                          говорят ничего, а место под строку всё равно зарезервировано. */}
                      {showsGain && (
                        <>
                          {sellMode ? '−' : '+'}
                          <Num>{formatNumber(gain, notation)}</Num> к доходу
                        </>
                      )}
                    </div>

                    <button
                      onClick={() => (sellMode ? sellAgents(m.id) : buyAgents(m.id))}
                      disabled={!canAfford}
                      className={`pixel-btn pixel-btn-accent model-row__buy`}
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.85rem',
                        backgroundColor: sellMode && canAfford ? 'var(--red-solid)' : undefined,
                        borderColor: sellMode && canAfford ? 'var(--red)' : undefined,
                        // Недоступная кнопка прозрачна для указателя: иначе браузер подавил бы
                        // Клик точно в неё и deny-обёртка выше его бы не увидела.
                        pointerEvents: canAfford ? undefined : 'none',
                      }}
                    >
                      {/* «Купить ×0» обещало бы покупку, которой не будет. */}
                      {sellMode ? (
                        count > 0 ? (
                          <>Продать (<Num>{formatNumber(refund, notation)}</Num>)</>
                        ) : (
                          <>Продать</>
                        )
                      ) : count > 0 ? (
                        <>
                          Купить ×<Num>{count}</Num> (<Num>{formatNumber(cost, notation)}</Num>)
                        </>
                      ) : (
                        <>Купить</>
                      )}
                    </button>
                  </div>

                  {/* Дефицит — отдельной строкой с зарезервированной высотой, поэтому ни размер
                      кнопки, ни высота карточки не прыгают на каждом тике. */}
                  <TokenDeficit amount={missing} notation={notation} />
                  </div>

                  {/* Справка AA переключатель */}
                  {/* Волосяная линия остаётся литералом: 6% белого — это заведомо слабее
                     любой ступени лестницы рамок, и --border здесь превратил бы её в
                     самостоятельную рамку. */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px' }}>
                    {/* Кнопка, а не div с обработчиком: раскрытие должно быть достижимо с
                        клавиатуры и обязано объявлять состояние. Имя Artificial Analysis остаётся
                        видимым текстом — атрибуция обязательна (ADR-0001). */}
                    <button
                      onClick={() => toggleAA(m.id)}
                      aria-expanded={isAAOpen}
                      aria-controls={`aa-${m.id}`}
                      id={`aa-toggle-${m.id}`}
                      style={{
                        width: '100%',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        fontSize: '0.75rem',
                        color: 'var(--accent-color)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Icon name="info" size={13} />
                        Справка Artificial Analysis
                      </span>
                      <span>{isAAOpen ? '▲ скрыть' : '▼ подробнее'}</span>
                    </button>

                    {isAAOpen && (
                      <div
                        id={`aa-${m.id}`}
                        aria-labelledby={`aa-toggle-${m.id}`}
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
                Пока нет доступных апгрейдов. Нанимай больше агентов!
              </div>
            ) : (
              upgrades.map((u) => {
                const canAfford = state.tokens >= u.cost;
                const missing = canAfford ? 0 : shortfall(u.cost, state.tokens);
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
                    <span style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>{u.name}</span>

                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {u.desc}
                    </div>

                    {/* Отказ — той же обёрткой, что у Моделей: сквоша здесь нет, потому что
                        карточка купленного Апгрейда размонтируется до кадра отрисовки и
                        анимация на кнопке не успела бы показаться; подтверждением служат
                        исчезновение карточки и звук из стора. */}
                    <div
                      onClickCapture={handleDeny(canAfford)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        ...(canAfford ? undefined : { cursor: 'not-allowed' }),
                      }}
                    >
                    <button
                      onClick={() => buyUpgrade(u.id)}
                      disabled={!canAfford}
                      className="pixel-btn pixel-btn-accent"
                      style={{
                        padding: '6px 10px',
                        fontSize: '0.85rem',
                        alignSelf: 'flex-end',
                        pointerEvents: canAfford ? undefined : 'none',
                      }}
                    >
                      {/* Цена живёт в кнопке на всех вкладках магазина: в шапке карточки её
                          больше нет, поэтому искать её приходилось в двух разных местах. */}
                      Улучшить (<Num>{formatNumber(u.cost, notation)}</Num>)
                    </button>

                    <TokenDeficit amount={missing} notation={notation} />
                    </div>
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
              <div style={{ fontSize: '1.1rem', color: 'var(--gold)' }}>Престиж в следующее поколение</div>

              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Сбросит текущий забег (токены, агенты, апгрейды) и перенесёт тебя в следующее поколение.
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
                  Получишь Compute: <Num>{prestigeGain(state)}</Num>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  (Каждая единица Compute даёт постоянный бонус +1% к доходу)
                </div>
              </div>

              {!finale && (
                <button
                  onClick={handlePrestige}
                  disabled={!canPrestige(state)}
                  className="pixel-btn pixel-btn-gold"
                  style={{
                    width: '100%',
                    marginTop: '4px',
                    ...(prestigeArmed
                      ? { backgroundColor: 'var(--red-solid)', borderColor: 'var(--red)' }
                      : undefined),
                  }}
                >
                  {prestigeArmed
                    ? 'Точно в новое Поколение? Забег сбросится — нажми ещё раз'
                    : canPrestige(state)
                      ? 'Сделать престиж!'
                      : 'Нужен 1 агент флагмана'}
                </button>
              )}

              {/* Финал контента: кнопка Престижа здесь скрыта навсегда, поэтому плашка без
                  действия — тупик. CTA ведёт на вкладку «Модели» тем же локальным setTab,
                  без новой навигации; текст не противоречит плашке Сцены в OfficeColumn. */}
              {finale && (
                <div
                  style={{
                    backgroundColor: 'var(--tint-strong)',
                    padding: '8px',
                    borderRadius: '4px',
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    animation: 'toast-fade 0.15s ease-out',
                  }}
                >
                  <div>
                    Ты дошёл до последнего Поколения — продолжение выйдет с новыми моделями. А
                    пока закрой все Достижения и развей офис до максимума
                  </div>
                  <button
                    onClick={() => setTab('models')}
                    className="pixel-btn pixel-btn-accent"
                    style={{ width: '100%' }}
                  >
                    К Моделям
                  </button>
                </div>
              )}
            </div>

            {/* Магазин Перков */}
            <div>
              <div
                style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '8px' }}
              >
                Постоянные перки (Свободно: <Num>{unspentCompute}</Num> Compute)
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
                      <span style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>{p.name}</span>

                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {p.desc}
                      </div>

                      {/* Отказ — той же обёрткой, что у Моделей/Апгрейдов: кнопка остаётся
                          disabled, Клик ловится на погружении, вспышка — на самой кнопке
                          (строки дефицита здесь нет). По «Куплено» обёртка молчит: owned гасит
                          и звук, и вспышку. */}
                      <div
                        onClickCapture={handlePerkDeny(owned || canAfford)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          ...(owned || canAfford ? undefined : { cursor: 'not-allowed' }),
                        }}
                      >
                      <button
                        onClick={(e) => {
                          restartSquash(e);
                          buyPerk(p.id);
                        }}
                        onAnimationEnd={handleSquashEnd}
                        disabled={owned || !canAfford}
                        className={`pixel-btn ${owned ? '' : 'pixel-btn-gold'}`}
                        style={{
                          padding: '6px 10px',
                          fontSize: '0.85rem',
                          alignSelf: 'flex-end',
                          // Недоступная кнопка прозрачна для указателя: иначе браузер подавил бы
                          // Клик точно в неё и deny-обёртка выше его бы не увидела.
                          pointerEvents: owned || canAfford ? undefined : 'none',
                        }}
                      >
                        {owned ? 'Куплено' : <>Купить перк (<Num>{p.cost}</Num> Compute)</>}
                      </button>
                      </div>
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
