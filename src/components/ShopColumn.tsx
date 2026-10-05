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
  progressToNextAgent,
  sellRefund,
  shortfall,
} from '../economy/engine';
import { availableUpgrades, labAgents, PAIR_SYNERGY_MULT, SYNERGY_MIN_AGENTS, UPGRADES_BY_GEN } from '../economy/upgrades';
import { countGenPerks, genPerkCost, genPerkGeneration, genPerkId, isGenPerkId, PERK_BY_ID, PERKS } from '../economy/perks';
import {
  canLicense,
  canPledge,
  LICENSE_INCOME_TAX,
  licenseCost,
  PLEDGE_GROWTH,
  PLEDGE_MAX,
  pledgeCost,
  revokeCost,
} from '../economy/glitches';
import {
  CRYSTAL_STOCK_CAP,
  CRYSTAL_UPGRADES,
  crystalCycleMs,
  crystalIncomeMult,
} from '../economy/crystal';
import { formatCount, formatDuration, formatNumber } from '../economy/format';
import type { Notation } from '../economy/state';
import { MascotSprite } from './MascotSprite';
import { GoalsBanner } from './GoalsBanner';
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

/** Раскладка строки откупа: текст слева, кнопка справа, обе по верху — кнопка не должна
 *  прыгать, когда описание становится на строку длиннее. */
const PLEDGE_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '10px',
  flexWrap: 'wrap',
};

const PLEDGE_TEXT: React.CSSProperties = { flex: 1, minWidth: 0 };

const PLEDGE_DESC: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--text-muted)',
  marginTop: '2px',
};

/**
 * Строка «Не хватает N Токенов».
 *
 * Живёт под кнопкой покупки и всегда занимает строку, даже когда дефицита нет: иначе карточка
 * прыгала бы по высоте на каждом тике, а с ней и кнопка под ней. aria-live не ставится — число
 * меняется двадцать раз в секунду и иначе читалось бы вслух.
 *
 * Дефицит печатается режимом `'price'`, как и цена над ним: половина Токена в «не хватает» не
 * значит ничего, а округление вверх у дефицита и у цены одно — иначе карточка считалась бы по
 * двум разным правилам, а читались бы рядом два числа, которых стыкуются только на глаз.
 */
const TokenDeficit: React.FC<{ amount: number; notation: Notation }> = ({ amount, notation }) => {
  // Снятие deny-вспышки по концу анимации, а не по таймеру: таймеры в компонентах запрещены.
  // Проверка цели не нужна — анимация висит только на этом узле, чужих animationend здесь нет.
  const handleDenyEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove('deny-flash');
  };
  // Скругление вверх защищает от обещания целого числа, которого не хватит на покупку, и
  // задаёт цифры для обеих строк: форма считается по тому же числу, что и печать.
  const displayAmount = Math.ceil(amount);
  return (
    <div
      className="token-deficit"
      onAnimationEnd={handleDenyEnd}
      style={{
        minHeight: '1em',
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
        textAlign: 'right',
      }}
    >
      {amount > 0 && (
        <>
          Не хватает <Num>{formatNumber(displayAmount, notation, 'price')}</Num>{' '}
          {/* Нотация обязательна: форма считается по цифрам той же записи, что и число. */}
          {formatCount(displayAmount, 'Токен', 'Токена', 'Токенов', notation, 'price')}
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
  // Раскрытые подробности карточек Моделей, по id: ключ — сама Модель, а не её позиция в списке,
  // иначе перестановка каталога закрыла бы то, что игрок открыл.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const state = useGameStore((s) => s.state);
  const buyAmount = useGameStore((s) => s.buyAmount);
  const sellMode = useGameStore((s) => s.sellMode);
  const setBuyAmount = useGameStore((s) => s.setBuyAmount);
  const setSellMode = useGameStore((s) => s.setSellMode);
  const buyAgents = useGameStore((s) => s.buyAgents);
  const sellAgents = useGameStore((s) => s.sellAgents);
  const buyUpgrade = useGameStore((s) => s.buyUpgrade);
  const buyPerk = useGameStore((s) => s.buyPerk);
  const buyPledge = useGameStore((s) => s.buyPledge);
  const buyLicense = useGameStore((s) => s.buyLicense);
  const revokeLicense = useGameStore((s) => s.revokeLicense);
  const buyCrystalUpgrade = useGameStore((s) => s.buyCrystalUpgrade);
  const shatter = useGameStore((s) => s.shatterCrystal);
  const requestPrestige = useGameStore((s) => s.requestPrestige);

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
  // Особые перки живут в том же PERKS, но с другой ценой и условием: реальная цена —
  // genPerkCost (растёт с числом купленных), покупка — в своём Поколении при
  // купленном флагмане либо в любом позднем без флагмана (buyGenPerk). Поэтому
  // список делится здесь, в render, без нового состояния: обычные — со своей
  // статичной ценой, особые — отдельной подсекцией ниже.
  const regularPerks = PERKS.filter((p) => !isGenPerkId(p.id));
  const genPerks = CATALOG.flatMap((g) => {
    const p = PERK_BY_ID[genPerkId(g.index)];
    return p ? [p] : [];
  });
  const boughtGenPerks = countGenPerks(state.perks);
  const nextGenPerkCost = genPerkCost(state.perks);
  const boughtPerks = state.perks.length;
  // Цена самого дешёвого некупленного Перка — из списка, а не константа в компоненте: подсказка
  // пустого состояния обязана назвать настоящую цифру иначе, чем добавится Перк. Пока не куплен
  // хоть один Перк, некупленных в PERKS заведомо остаются, так что число конечно.
  const cheapestPerkCost = PERKS.reduce(
    (min, p) => (state.perks.includes(p.id) ? min : Math.min(min, p.cost)),
    Infinity,
  );

  // Откупы: остаток уже купленного глушения — по игровым часам, как всё остальное окно
  // события, поэтому подпись не убегает от реальности после возвращения из простоя.
  const pledgeLeftMs = Math.max(0, state.pledgeUntil - state.lastTick);

  // Кристаллы. Зреет максимум один кристалл за раз, поэтому «следующий» — единственный,
  // и обе величины считаются по lastTick: у него же стор двигает рост кристалла.
  const crystalCycle = crystalCycleMs(state);
  const crystalGrownMs =
    state.crystalPlantedAt === 0 ? 0 : Math.max(0, state.lastTick - state.crystalPlantedAt);
  const crystalLeftSec = Math.max(0, crystalCycle - crystalGrownMs) / 1000;
  const crystalProgress = crystalCycle > 0 ? Math.min(1, crystalGrownMs / crystalCycle) : 0;
  const crystalBonusPct = Math.round((crystalIncomeMult(state) - 1) * 100);

  // Престиж открывает окно подтверждения, а не выполняется здесь: сброс Забега необратим,
  // и игрок должен увидеть, сколько Compute начислит, что сгорит и в какое Поколение он
  // попадёт. Один путь на обе колонки — свой взвод здесь означал бы два разных подтверждения
  // одного и того же действия. Сам переход живёт в triggerPrestige, его зовёт окно.

  const toggleDetails = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Звук получает не флаг мьюта, а настройки целиком: громкость — полноценная настройка игрока,
  // и компонент не должен собирать их сам, иначе каждый новый звук получил бы свой способ
  // передачи настроек.
  const soundSettings = state.settings;

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
      playDenySound(soundSettings);
      const node = e.currentTarget.querySelector('.token-deficit');
      if (!(node instanceof HTMLElement)) return;
      node.classList.remove('deny-flash');
      void node.offsetWidth;
      node.classList.add('deny-flash');
    };

  // Отказ по недоступной покупке без строки дефицита: тем же приёмом, что у Моделей, но
  // вспышка висит на самой кнопке. Служат карточки Перков, Откупов и Кристаллов — у них под
  // кнопкой нечего мигать: у Перков нет строки дефицита, у Откупов и Кристаллов валюта не
  // Токены, и «Не хватает N Токенов» было бы неправдой.
  const handleBuyDeny =
    (affordable: boolean) => (e: React.MouseEvent<HTMLDivElement>) => {
      if (affordable) return;
      playDenySound(soundSettings);
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
      {/* Цели видны всегда, независимо от вкладки: экран без видимой цели убивает быстрее медленного баланса. */}
      <GoalsBanner />
      {/* Переключатель вкладок магазина. Состояние выбора — aria-pressed, тем же приёмом,
          что у режима продажи и количества покупки выше: вкладки не настоящий tablist,
          у них нет связанных панелей и стрелочной навигации, а цвет рамки для скринридера
          не существует. */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        <button
          onClick={() => setTab('models')}
          aria-label="Вкладка Модели"
          aria-pressed={tab === 'models'}
          className={`pixel-btn ${tab === 'models' ? 'pixel-btn-accent' : ''}`}
          style={{ flex: 1, padding: '8px 4px', fontSize: '0.9rem' }}
        >
          Модели
        </button>
        <button
          onClick={() => setTab('upgrades')}
          aria-label={`Вкладка Апгрейды${upgrades.length > 0 ? ` (${upgrades.length} доступно)` : ''}`}
          aria-pressed={tab === 'upgrades'}
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
                /* --red-solid, а не --red: белый на --red держал 3.05:1, то есть ниже порога
                   для 12.8 px. На --red-solid та же подпись держит 6.47:1, и заливка пришла
                   из палитры, а не из правила с !important, которым её приходилось перебивать. */
                backgroundColor: 'var(--red-solid)',
                color: '#fff',
                fontSize: '0.8rem',
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
          aria-label="Вкладка Престиж"
          aria-pressed={tab === 'perks'}
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
            // Перенос строк обязателен: сумма двух групп кнопок не помещается в
            // SHOP_COL_MIN, и без переноса «Max» уезжал за правый край колонки на всём
            // диапазоне от трёхколоночного порога до ~1190px. Поднимать минимум колонки
            // ради этого не стоит — он поднял бы и порог одноколоночного режима, а перенос
            // читается: на узкой колонке множители просто встают вторым рядом.
            flexWrap: 'wrap',
            rowGap: '4px',
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
              aria-label="Режим покупки"
              aria-pressed={!sellMode}
              style={{ padding: '4px 8px', fontSize: '0.8rem' }}
            >
              Купить
            </button>
            <button
              onClick={() => setSellMode(true)}
              className="pixel-btn pixel-btn-sell"
              aria-label="Режим продажи"
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
                aria-label={amt === 'max' ? 'Купить максимум' : `Количество покупки: ${amt}`}
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
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flexShrink: 0 }}>
              Возврат 25% от цены
            </div>
          )}
        </div>
      )}

      {/* Контент активной вкладки. key по вкладке: переключение даёт короткое появление
          только через opacity toast-fade, состояние tab и expanded не трогаем. */}
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
              const isDetailsOpen = !!expanded[m.id];
              const lab = LABS[m.lab];

              // Дефицит: при фиксированном множителе он считается на всю сумму покупки, а при Max
              // с пустым кошельком покупки нет вообще — тогда показываем, чего стоит одна единица.
              const missing =
                sellMode || canAfford ? 0 : shortfall(count > 0 ? cost : bulkCost(m, owned, 1, d), state.tokens);

              // Строка прироста описывает действие, которое кнопка действительно выполнит. Покупка,
              // которая не по карману, подпись всё равно заслуживает: рядом стоит строка дефицита.
              // А вот продать нечего — и обе цифры, и кнопка были бы пустыми.
              const showsGain = sellMode ? owned > 0 : count > 0;

              // Доля для полосы цели — из движка, по той же цене, что и покупка. Число дефицита
              // ниже показывает, сколько не хватает, а полоса показывает, как близко цель:
              // одно без другого игроку не сообщает, что цель достижима.
              const missingShare = progressToNextAgent(state, m);

              // Прогресс до синергий — чистый derived render из состояния: число Агентов
              // каждой Лаборатории через labAgents, без нового состояния и без таймеров.
              // Одиночная синергия есть не у всех лаб (нужны ≥2 Модели в Поколении).
              const singleSynergy = UPGRADES_BY_GEN[state.generation].find(
                (u) => u.kind === 'synergy' && u.pairLab === undefined && u.lab === m.lab,
              );
              const singleBought = singleSynergy !== undefined && state.upgrades.includes(singleSynergy.id);
              const singleCount = labAgents(state, m.lab);
              const pairSynergies = UPGRADES_BY_GEN[state.generation].filter(
                (u) => u.kind === 'synergy' && u.pairLab !== undefined && (u.lab === m.lab || u.pairLab === m.lab),
              );

              return (
                <ModelRow key={m.id} owned={owned} isFlagship={m.isFlagship} canAfford={canAfford}>
                  {/* Шапка карточки — первый слой чтения, и ровно он: название, Ранг, Лаборатория,
                      число Агентов. Всё, что ниже, объяснение; всё, что за раскрытием, справка.
                      Ранг стоит рядом с названием, а не в строке Лаборатории: он объясняет цену,
                      и игрок ищет его вместе с ней, а Лабораторию — по цвету и Маскоту. */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <MascotSprite lab={m.lab} size={28} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '1rem', color: 'var(--text-main)' }}>{m.name}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Ранг <Num>{m.rank + 1}</Num>
                          </span>
                          {m.isFlagship && (
                            <span
                              style={{
                                fontSize: '0.8rem',
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
                        <div style={{ fontSize: '0.8rem', color: lab.color }}>{lab.name}</div>
                      </div>
                    </div>

                    {/* Подпись обязательна: голое число не отличить от счётчика чего-то другого.
                        Оба числа идут через formatNumber в нотации игрока: число Агентов в
                        поздней игре длиннее любой колонки, а печать сырого double дала бы «1e+300»
                        вместо «1,00e300» и «4278» вместо «4,28 K» — и ещё и разъехавшееся
                        склонение под ним. */}
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '1.2rem' }}>
                        <Num>{formatNumber(owned, notation)}</Num>
                      </div>
                      <div>{formatCount(owned, 'Агент', 'Агента', 'Агентов', notation)}</div>
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
                      aria-label={
                        sellMode
                          ? count > 0
                            ? `Продать ${formatNumber(count, notation)} ${formatCount(count, 'Агента', 'Агентов', 'Агентов', notation)} Модели ${m.name} за ${formatNumber(refund, notation, 'price')} ${formatCount(refund, 'Токен', 'Токена', 'Токенов', notation, 'price')}`
                            : `Продать Агентов Модели ${m.name}`
                          : count > 0
                            ? `Купить ${formatNumber(count, notation)} ${formatCount(count, 'Агента', 'Агентов', 'Агентов', notation)} Модели ${m.name} за ${formatNumber(cost, notation, 'price')} ${formatCount(cost, 'Токен', 'Токена', 'Токенов', notation, 'price')}`
                            : `Купить Агента Модели ${m.name}`
                      }
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
                      {/* «Купить ×0» обещало бы покупку, которой не будет.
                          Цена в режиме `'price'`: округление вверх, а не вниз. bulkCost отдаёт
                          дробь (10,5 за первого Агента со стартовой скидкой), и обычная печать
                          резала её до целого: кнопка обещала «10» и отказывала при десяти
                          Токенах в кошельке. */}
                      {sellMode ? (
                        count > 0 ? (
                          <>Продать (<Num>{formatNumber(refund, notation, 'price')}</Num>)</>
                        ) : (
                          <>Продать</>
                        )
                      ) : count > 0 ? (
                        <>
                          {/* Число покупок идёт через formatNumber: при «Max» это могут быть тысячи Агентов, а на
                              поздних Поколениях цена уходит в e-нотацию, и «×4278» на кнопке
                              не влезало бы в SHOP_COL_MIN. */}
                          Купить ×<Num>{formatNumber(count, notation)}</Num> (<Num>{formatNumber(cost, notation, 'price')}</Num>)
                        </>
                      ) : (
                        <>Купить</>
                      )}
                    </button>
                  </div>

                  {/* Дефицит — отдельной строкой с зарезервированной высотой, поэтому ни размер
                      кнопки, ни высота карточки не прыгают на каждом тике. */}
                  <TokenDeficit amount={missing} notation={notation} />

                  {/* Полоса цели: строка дефицита отвечает на «сколько не хватает», полоса — на
                      «как близко». Подписи у полосы нет, число уже показано строкой выше.

                      Ширина целым процентами и без перехода: магазин перерисовывается двадцать
                      раз в секунду, а переход на ширину, который перезапускался бы каждый кадр,
                      тянул бы заливку позади настоящей доли и перезапускал бы анимацию на ровном
                      месте. */}
                  <div className="model-goal">
                    <div className="model-goal__track">
                      <div
                        className="model-goal__fill"
                        style={{ width: `${Math.round((1 - missingShare) * 100)}%` }}
                      />
                    </div>
                  </div>
                  </div>

                  {/* Раскрытие подробностей — единственное, что осталось от шума: раньше три
                      строки датасетов висели в каждой карточке и читались как сплошной текст.
                      Теперь они живут здесь, вместе со Справкой AA, и карточка держит три строки:
                      шапка, цена с приростом, полоса цели.
                      Волосяная линия остаётся литералом: 6% белого — это заведомо слабее любой
                      ступени лестницы рамок, и --border здесь превратил бы её в самостоятельную
                      рамку. */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px' }}>
                    {/* Кнопка, а не div с обработчиком: раскрытие должно быть достижимо с
                        клавиатуры и обязано объявлять состояние. Имя Artificial Analysis остаётся
                        видимым текстом — атрибуция обязательна (ADR-0001) и не должна прятаться
                        за раскрытие, поэтому строка подписи не меняется. */}
                    <button
                      onClick={() => toggleDetails(m.id)}
                      className="link-toggle"
                      aria-expanded={isDetailsOpen}
                      aria-controls={`details-${m.id}`}
                      id={`details-toggle-${m.id}`}
                      aria-label={isDetailsOpen ? `Скрыть подробности о Модели ${m.name}` : `Показать подробности о Модели ${m.name}: Справка Artificial Analysis`}
                      style={{
                        width: '100%',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        fontSize: '0.8rem',
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
                      <span>{isDetailsOpen ? '▲ скрыть' : '▼ подробнее'}</span>
                    </button>

                    {isDetailsOpen && (
                      <div
                        id={`details-${m.id}`}
                        aria-labelledby={`details-toggle-${m.id}`}
                        style={{
                          marginTop: '6px',
                          padding: '6px 8px',
                          backgroundColor: 'var(--bg-void)',
                          borderRadius: '4px',
                          fontSize: '0.8rem',
                        }}
                      >
                        {/* Прогресс до датасетов Лаборатории: одиночный — счёт одной лабы,
                            совместный — состав пары. Только чтение состояния, без своих таймеров.
                            Одинаков для всех Моделей лабы, поэтому в карточке он и стоит один
                            раз — по кнопке, а не стеной на каждой Модели. */}
                        {(singleSynergy !== undefined || pairSynergies.length > 0) && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {singleSynergy !== undefined &&
                              (singleBought ? (
                                <div>Общий датасет активен</div>
                              ) : (
                                <div>
                                  <Num>{formatNumber(singleCount, notation)}</Num>/<Num>{SYNERGY_MIN_AGENTS}</Num>{' '}
                                  {formatCount(singleCount, 'Агент', 'Агента', 'Агентов', notation)} до датасета
                                  {singleCount >= SYNERGY_MIN_AGENTS
                                    ? ' — забирай во вкладке Апгрейды'
                                    : ' — каждый Датасет из Достижений и купленный Датасет множит Доход'}
                                </div>
                              ))}
                            {pairSynergies.map((u) => {
                              if (u.kind !== 'synergy' || u.pairLab === undefined) return null;
                              const first = labAgents(state, u.lab);
                              const second = labAgents(state, u.pairLab);
                              const bought = state.upgrades.includes(u.id);
                              const ready =
                                first >= SYNERGY_MIN_AGENTS && second >= SYNERGY_MIN_AGENTS;
                              const pairName = `${LABS[u.lab].name} × ${LABS[u.pairLab].name}`;
                              if (bought) {
                                return (
                                  <div key={u.id}>
                                    {ready ? (
                                      <>
                                        Совместный датасет {pairName} активен (×
                                        <Num>{formatNumber(PAIR_SYNERGY_MULT, notation)}</Num>)
                                      </>
                                    ) : (
                                      <>
                                        Совместный датасет {pairName} ждёт состав{' '}
                                        <Num>{formatNumber(first, notation)}</Num>/<Num>{SYNERGY_MIN_AGENTS}</Num> +{' '}
                                        <Num>{formatNumber(second, notation)}</Num>/<Num>{SYNERGY_MIN_AGENTS}</Num>
                                      </>
                                    )}
                                  </div>
                                );
                              }
                              return (
                                <div key={u.id}>
                                  <Num>{formatNumber(first, notation)}</Num>/<Num>{SYNERGY_MIN_AGENTS}</Num> +{' '}
                                  <Num>{formatNumber(second, notation)}</Num>/<Num>{SYNERGY_MIN_AGENTS}</Num> до совместного
                                  датасета {pairName}
                                  {ready ? ' — забирай во вкладке Апгрейды' : ''}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Справка AA: реальные характеристики Модели, а не игровые. Отдельной
                            строкой от датасетов, потому что это другой вопрос — и подпись под
                            панелью остаётся видимой и в закрытом виде. */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: '6px',
                            paddingTop: '6px',
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
            {/* Пустая вкладка. Прежде здесь стояло «Нанимай больше агентов!», и это было
                половиной правды: Апгрейды Клика открываются не Агентами, а Токенами забега,
                поэтому после первого Агента и без единого Апгрейда игрок решал, что вкладка
                сломана. Теперь названы оба порога, и оба — из движка, а не выдуманы. */}
            {upgrades.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  marginTop: '32px',
                  padding: '0 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  alignItems: 'center',
                }}
              >
                <div style={{ fontSize: '0.9rem' }}>Пока нет доступных апгрейдов.</div>
                {/* Ближайшая ступень та же, что у tiers Модели: один Агент открывает тонкую
                    настройку. Второй порог — Токены забега на Апгрейды Клика, и он не про
                    Агентов вовсе, поэтому назван отдельно. */}
                <div style={{ fontSize: '0.8rem', maxWidth: '260px' }}>
                  Каждый Агент открывает тонкую настройку своей Модели, а Апгрейды Клика —
                  по Токенам, заработанным за Забег. Пока нет ни того, ни другого.
                </div>
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
                    {/* Заголовок с пиктограммой: спрайт 32×32 нельзя сжимать под narrower
                        колонки, поэтому у него фиксированный размер и flexShrink: 0. */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <img
                        src={`/sprites/upgrades/${u.sprite}.png`}
                        width={32}
                        height={32}
                        alt=""
                        aria-hidden="true"
                        style={{ imageRendering: 'pixelated', flexShrink: 0 }}
                      />
                      <span style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>{u.name}</span>
                    </div>

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
                      aria-label={`Купить апгрейд ${u.name} за ${formatNumber(u.cost, notation, 'price')} ${formatCount(u.cost, 'Токен', 'Токена', 'Токенов', notation, 'price')}`}
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
                      Улучшить (<Num>{formatNumber(u.cost, notation, 'price')}</Num>)
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

              {!finale && (
                <div
                  style={{
                    backgroundColor: 'var(--tint-strong)',
                    padding: '8px',
                    borderRadius: '4px',
                    fontSize: '0.85rem',
                  }}
                >
                  <div>
                    Получишь Compute:{' '}
                    {/* Через formatNumber, иначе в поздней игре это число с пятнадцатью
                        значащими цифрами: `Num` только набирает пиксельным шрифтом (ADR-0003)
                        и ничего не форматирует. То же число показывает окно подтверждения,
                        и расходиться они не должны. */}
                    <Num>+{formatNumber(prestigeGain(state), notation)}</Num>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    (Каждая единица Compute даёт постоянный бонус +1% к Доходу)
                  </div>
                </div>
              )}

              {/* Кнопка не гаснет, даже когда Престиж невозможен: погашенная кнопка молчит о
                  причине, а окно подтверждения её объясняет и отказывает тем же переходом,
                  который проверяет стор. */}
              <button
                onClick={requestPrestige}
                aria-label={
                  finale
                    ? 'Финал контента'
                    : canPrestige(state)
                      ? 'Сделать Престиж в следующее поколение'
                      : 'Престиж недоступен: нужен 1 Агент Флагмана'
                }
                className="pixel-btn pixel-btn-gold"
                style={{ width: '100%', marginTop: '4px' }}
              >
                {finale
                  ? 'Финал контента'
                  : canPrestige(state)
                    ? 'Сделать Престиж!'
                    : 'Нужен 1 Агент Флагмана'}
              </button>

              {/* Финал контента: кнопка Престижа выше ничего не выполнит, поэтому плашка без
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
                    aria-label="Вернуться к Моделям"
                    className="pixel-btn pixel-btn-accent"
                    style={{ width: '100%' }}
                  >
                    К Моделям
                  </button>
                </div>
              )}
            </div>

            {/* ОТКУПЫ. Блок виден всегда, а не только во время Восстания: скрытая покупка —
                дверь в одну сторону, и игрок не узнал бы, что от красных событий вообще
                можно откупиться. */}
            <div
              className="pixel-card"
              style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <div style={{ fontSize: '1rem', color: 'var(--text-main)' }}>
                Откупы от Восстания моделей
              </div>

              {state.uprising === 0 ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Откупы открываются с начала Восстания: найми 1 агента флагмана и сделай
                  Престиж. Пока красных событий не бывает — покупать нечего.
                </div>
              ) : (
                <>
                  {/* Лобби. Цена растёт в восемь раз за покупку, и подпись показывает и саму
                      цену, и её рост, и сколько покупок в этом забеге ещё доступно: иначе
                      рост цены был бы виден только задним числом. */}
                  <div style={PLEDGE_ROW}>
                    <div style={PLEDGE_TEXT}>
                      <div style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>Лобби</div>
                      <div style={PLEDGE_DESC}>
                        Глушит красные события на полчаса. Второе продлевает, а не заменяет.
                      </div>
                      <div style={PLEDGE_DESC}>
                        Куплено <Num>{state.pledgeBought}</Num> из <Num>{PLEDGE_MAX}</Num>,
                        каждая следующая дороже в <Num>{PLEDGE_GROWTH}</Num> раз.
                      </div>
                      {/* Под «Лицензией» кнопка молчит, но не прячет цену и условие: игрок
                          обязан прочитать, что Лобби стал недоступен и почему. */}
                      {state.covenant && (
                        <div style={PLEDGE_DESC}>
                          «Лицензия» глушит всё, поэтому Лобби за{' '}
                          <Num>{formatNumber(pledgeCost(state), notation, 'price')}</Num> не продаётся.
                        </div>
                      )}
                      {pledgeLeftMs > 0 && (
                        <div style={{ ...PLEDGE_DESC, color: 'var(--green)' }}>
                          Глушит ещё {formatDuration(pledgeLeftMs / 1000)}
                        </div>
                      )}
                    </div>
                    <div
                      onClickCapture={handleBuyDeny(canPledge(state))}
                      style={{ flexShrink: 0 }}
                    >
                      <button
                        onClick={buyPledge}
                        disabled={!canPledge(state)}
                        aria-label={state.covenant ? 'Лицензия уже активна' : `Откупиться от красных событий за ${formatNumber(pledgeCost(state), notation, 'price')} Токенов`}
                        className="pixel-btn pixel-btn-accent"
                        style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                      >
                        {state.covenant ? (
                          'Есть Лицензия'
                        ) : (
                          <>
                            Откупиться (<Num>{formatNumber(pledgeCost(state), notation, 'price')}</Num>)
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Лицензия. Её размен назван прямо и ДО покупки, потому что налог на Доход
                      платится постоянно, а не разово: игрок обязан видеть, что именно он
                      покупает вместе с вечным глушением. */}
                  {state.covenant ? (
                    <div style={PLEDGE_ROW}>
                      <div style={PLEDGE_TEXT}>
                        <div style={{ fontSize: '0.95rem', color: 'var(--green)' }}>
                          Лицензия активна
                        </div>
                        <div style={PLEDGE_DESC}>
                          Красные события глушатся, Глюки не заводятся. Налог на Доход{' '}
                          −<Num>{formatNumber(Math.round(LICENSE_INCOME_TAX * 100), notation)}</Num>%{' '}
                          платится, пока Лицензия не отозвана.
                        </div>
                      </div>
                      <div
                        onClickCapture={handleBuyDeny(state.tokens >= revokeCost(state))}
                        style={{ flexShrink: 0 }}
                      >
                        <button
                          onClick={revokeLicense}
                          disabled={state.tokens < revokeCost(state)}
                          aria-label={`Отозвать Лицензию за ${formatNumber(revokeCost(state), notation, 'price')} Токенов`}
                          className="pixel-btn"
                          style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                        >
                          Отозвать (<Num>{formatNumber(revokeCost(state), notation, 'price')}</Num>)
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={PLEDGE_ROW}>
                      <div style={PLEDGE_TEXT}>
                        <div style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>
                          Лицензия
                        </div>
                        <div style={PLEDGE_DESC}>
                          Вечное «Лобби»: красные события глушатся навсегда, а все Глюки
                          лопаются разом и выплачивают общий котёл.
                        </div>
                        <div style={{ ...PLEDGE_DESC, color: '#fca5a5' }}>
                          Постоянный налог на Доход −
                          <Num>{formatNumber(Math.round(LICENSE_INCOME_TAX * 100), notation)}</Num>%:
                          отзыв обойдётся в{' '}
                          <Num>{formatNumber(revokeCost(state), notation, 'price')}</Num>.
                        </div>
                      </div>
                      <div
                        onClickCapture={handleBuyDeny(canLicense(state))}
                        style={{ flexShrink: 0 }}
                      >
                        <button
                          onClick={buyLicense}
                          disabled={!canLicense(state)}
                          aria-label={`Взять Лицензию за ${formatNumber(licenseCost(state), notation, 'price')} Токенов`}
                          className="pixel-btn pixel-btn-gold"
                          style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                        >
                          Взять Лицензию (
                          <Num>{formatNumber(licenseCost(state), notation, 'price')}</Num>)
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* КРИСТАЛЛЫ. Здесь показан весь размен ускорителя, а не только его польза:
                кристалл в запасе даёт +1% к общему Доходу, поэтому покупка забирает часть
                этого бонуса навсегда. Без этой строки игрок покупал бы ускоритель, думая,
                что он ничего не стоит. */}
            <div
              className="pixel-card"
              style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <div style={{ fontSize: '1rem', color: 'var(--text-main)' }}>
                Compute-кристаллы
              </div>

              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                В запасе <Num>{formatNumber(state.crystals, notation)}</Num>, каждый целый
                кристалл даёт +1% к общему Доходу навсегда. Сейчас это{' '}
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                  +<Num>{formatNumber(crystalBonusPct, notation)}</Num>%
                </span>
                , потолок запаса — <Num>{CRYSTAL_STOCK_CAP}</Num>. Кристалл зреет в реальном
                времени и переживает Престиж.
              </div>

              {/* Рост следующего: одна полоса и честный остаток. Сбор ленивый — зреет максимум
                  один кристалл, — поэтому обещать «через N» можно только про один. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                  {state.crystalPlantedAt === 0 ? (
                    'Первый кристалл только сеется'
                  ) : (
                    <>Следующий зреет ещё {formatDuration(crystalLeftSec)}</>
                  )}
                </div>
                <div
                  role="progressbar"
                  aria-label="Рост следующего кристалла"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(crystalProgress * 100)}
                  style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: 'var(--bg-void)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${crystalProgress * 100}%`,
                      height: '100%',
                      backgroundColor: 'var(--accent-color)',
                      // Переход ширины — не движение: при выключенном он остаётся, потому что
                      // ни сдвига, ни тряски тут нет.
                      transition: 'width 0.2s linear',
                    }}
                  />
                </div>
              </div>

              {/* Разбить кристалл: честный обмен вечного бонуса к Доходу на разовые Токены.
                  Кнопка видна только при crystals >= 1, подтверждения нет — размен назван прямо. */}
              {state.crystals >= 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Разбить кристалл: вечный бонус к Доходу за кристалл превратится в разовые
                    Токены. Кристалл исчезнет из запаса.
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={shatter}
                      aria-label="Разбить кристалл"
                      className="pixel-btn"
                      style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                    >
                      Разбить кристалл
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {CRYSTAL_UPGRADES.map((u) => {
                  const owned = state.crystalUpgrades.includes(u.id);
                  const canAfford = !owned && state.crystals >= u.cost;
                  // Цена ускорителя: сколько процентов бонуса за запас уйдёт навсегда. Это разница двух
                  // бонусов от самой экономики, а не «цена ×1%», посчитанная в компоненте, —
                  // правило «сколько даёт целый кристалл в запасе» живёт поэтому в одном месте,
                  // в crystalIncomeMult, и строка переживёт его правку.
                  // Запас для обеих точек берётся равным цене, а не текущему: ускоритель покупают
                  // когда кристаллов хватает, и до тех пор его цена не должна скакать вместе с
                  // кошельком — иначе «забирает 3%» превратилось бы в «забирает 10%» ровно тогда,
                  // когда игрок дождался возможности купить.
                  const lostPct = Math.round(
                    (crystalIncomeMult({ ...state, crystals: u.cost }) -
                      crystalIncomeMult({ ...state, crystals: 0 })) *
                      100,
                  );
                  return (
                    <div
                      key={u.id}
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
                      <span style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>
                        {u.name}
                      </span>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.desc}</div>
                      {/* Размен назван прямо и без смягчений: ускоритель отнимает бонус за
                          запас навсегда, и это его настоящая цена. Уже купленного скидывать
                          не стоит — предупреждение там, где решение ещё можно принять. */}
                      <div
                        style={{
                          fontSize: '0.8rem',
                          color: owned ? 'var(--text-muted)' : '#fca5a5',
                        }}
                      >
                        {owned
                          ? 'Куплено: бонус за запас уже урезан'
                          : (
                              <>
                                Забирает <Num>{formatNumber(lostPct, notation)}</Num>% бонуса за
                                запас навсегда
                              </>
                            )}
                      </div>
                      <div
                        onClickCapture={handleBuyDeny(owned || canAfford)}
                        style={{ display: 'flex', justifyContent: 'flex-end' }}
                      >
                        <button
                          onClick={() => buyCrystalUpgrade(u.id)}
                          disabled={owned || !canAfford}
                          aria-label={owned ? `Апгрейд кристаллов ${u.name} уже куплен` : `Купить апгрейд кристаллов ${u.name} за ${u.cost} ${formatCount(u.cost, 'кристалл', 'кристалла', 'кристаллов')}`}
                          className={`pixel-btn ${owned ? '' : 'pixel-btn-accent'}`}
                          style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                        >
                          {owned ? (
                            'Куплено'
                          ) : (
                            <>
                              Купить (<Num>{formatNumber(u.cost, notation)}</Num>{' '}
                              {formatCount(u.cost, 'кристалл', 'кристалла', 'кристаллов', notation)})
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Магазин Перков */}
            <div>
              <div
                style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '8px' }}
              >
                Постоянные перки (Свободно: <Num>{formatNumber(unspentCompute, notation)}</Num> Compute)
              </div>

              {/* Ноль Compute — не «пустая колонка», а самый частый первый заход на эту вкладку:
                  до первого Престижа Compute в игре нет вообще, и подряд идут пятнадцать
                  приглушённых карточек с мёртвыми кнопками. Строка называет, откуда берётся
                  Compute и сколько стоит самый дешёвый Перк, — иначе вкладка выглядит поломкой.
                  Условие именно «ничего не куплено и купить нечего»: при накопленном Compute
                  подсказка молчала бы впустую. */}
              {unspentCompute === 0 && boughtPerks === 0 && (
                <div
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    marginBottom: '8px',
                    padding: '8px 10px',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                  }}
                >
                  Compute начисляется за Престиж — до первого их нет. Он открыт, как только
                  найдёшь Агента Флагмана, а самый дешёвый Перк стоит{' '}
                  <Num>{formatNumber(cheapestPerkCost, notation)}</Num> Compute.
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {regularPerks.map((p) => {
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
                        onClickCapture={handleBuyDeny(owned || canAfford)}
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
                        aria-label={owned ? `Перк ${p.name} уже куплен` : `Купить перк ${p.name} за ${p.cost} Compute`}
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

            {/* Наследие поколений: особые перки переживают Престиж и усиливают только своё
                Поколение. Цена общая на всех — genPerkCost за следующий некупленный, поэтому
                карточка показывает её, а не статичный cost из таблицы. Покупка идёт тем же
                buyPerk (движок сам сверяет Поколение и флагмана), новых экшенов нет. */}
            <div>
              <div
                style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '4px' }}
              >
                Наследие поколений (Куплено: <Num>{boughtGenPerks}</Num> из{' '}
                <Num>{genPerks.length}</Num>)
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                Усиливают только своё Поколение навсегда. Следующий —{' '}
                <Num>{nextGenPerkCost}</Num> Compute: цена растёт с числом купленных.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {genPerks.map((p) => {
                  const owned = state.perks.includes(p.id);
                  // Поколение особого перка: null быть не может (список собран через genPerkId
                  // по каталогу), но чужой id из старого сохранения разбираем в 0, чтобы
                  // карточка не упала, а ушла в приглушённые.
                  const perkGen = genPerkGeneration(p.id) ?? 0;
                  const genName = CATALOG[perkGen]?.name ?? '';
                  const isCurrentGen = perkGen === state.generation;
                  const isFutureGen = perkGen > state.generation;
                  // Флагман — то же условие, что у кнопки Престижа, но только для перка
                  // ТЕКУЩЕГО Поколения: прошлые докупаются позже без флагмана, ведь сам
                  // переход дальше уже доказал мастерство (Престиж требовал флагмана).
                  const needFlagship = !owned && isCurrentGen && !prestigeReady;
                  // Приглушены только будущие (ещё не открыты) и текущее без флагмана;
                  // прошлые некупленные — обычные покупаемые, «упущенности» нет.
                  const locked = !owned && (isFutureGen || needFlagship);
                  const canAfford = !locked && unspentCompute >= nextGenPerkCost;

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
                        ...(locked ? { opacity: 0.6 } : undefined),
                      }}
                    >
                      <span style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>{p.name}</span>

                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {p.desc}
                      </div>

                      {/* Подпись причины: будущее Поколение и missing флагман текущего —
                          разные тупики, и молча приглушённая карточка не объяснила бы, что
                          делать. Прошлые Поколения подписи не получают: они покупаемы как
                          обычные, упущенности нет. */}
                      {locked && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {isFutureGen
                            ? <>Откроется в поколении «{genName}»</>
                            : needFlagship
                              ? 'Нужен флагман поколения'
                              : null}
                        </div>
                      )}

                      <div
                        onClickCapture={handleBuyDeny(owned || canAfford)}
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
                        aria-label={owned ? `Перк Наследия ${p.name} уже куплен` : `Купить перк Наследия ${p.name} за ${nextGenPerkCost} Compute`}
                        className={`pixel-btn ${owned ? '' : 'pixel-btn-gold'}`}
                        style={{
                          padding: '6px 10px',
                          fontSize: '0.85rem',
                          alignSelf: 'flex-end',
                          pointerEvents: owned || canAfford ? undefined : 'none',
                        }}
                      >
                        {owned ? (
                          'Куплено'
                        ) : (
                          <>
                            Купить перк (<Num>{nextGenPerkCost}</Num> Compute)
                          </>
                        )}
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
