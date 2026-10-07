import React, { useEffect, useRef, useState } from 'react';
import { motionAllowed, useGameStore, useStateSlice, type BuyAmount } from '../store/useGameStore';
import {
  availableUpgradesOf,
  crystalGrowthView,
  crystalStockView,
  crystalUpgradeView,
  GOAL_TICK_COUNT,
  modelView,
  pledgeView,
  prestigeCardView,
  upgradeView,
} from '../store/selectors';
import { useMotionAllowed } from './EventSprites';
import { CATALOG, type Model } from '../economy/catalog';
import { LABS, type LabId } from '../data/labs';
import { canPrestige, isContentFinale } from '../economy/engine';
import {
  labAgents,
  PAIR_SYNERGY_MULT,
  SYNERGY_MIN_AGENTS,
  UPGRADES_BY_GEN,
  type Upgrade,
} from '../economy/upgrades';
import { countGenPerks, genPerkCost, genPerkGeneration, genPerkId, isGenPerkId, PERK_BY_ID, PERKS } from '../economy/perks';
import { PLEDGE_GROWTH, PLEDGE_MAX } from '../economy/glitches';
import { CRYSTAL_STOCK_CAP, CRYSTAL_UPGRADES, type CrystalUpgrade } from '../economy/crystal';
import { formatNumber } from '../economy/format';
import { MascotSprite } from './MascotSprite';
import { Num } from './Num';
import { Icon } from './Icon';
import { playDenySound } from '../audio/sound';

// 8 искр из точки покупки. Радиус 14–26 px — чуть больше самой кнопки, поэтому жест читается
// как отклик на нажатие, а не как залп.
/**
 * Искры покупки: восемь штук веером из кнопки.
 *
 * Восемь — предел для рутинного события. Покупка Агента повторяется десятки раз за Забег,
 * и всё, что крупнее, превратилось бы в рябь: к третьему десятку искр игрок перестаёт их
 * видеть, а к сотне они уже мешают читать цену под собой. Крупные события получают
 * отклик другого калибра (см. `burst-layer` в Toasts).
 */
/**
 * Трёхбуквенные бейджи Лабораторий.
 *
 * Живут здесь, а не в разметке: длина бейджа фиксирована тремя буквами именно потому, что
 * колонки в списке обязаны стоять вровень, и подпись, нарисованная прямо в карточке,
 * растянула бы карточку самой длинной строкой.
 */
/** Деления рельса цели в карточке Модели; их число задаёт срез `modelView`. */
const GOAL_TICKS = Array.from({ length: GOAL_TICK_COUNT }, (_, i) => i);

const LAB_BADGE: Record<LabId, string> = {
  openai: 'OAI',
  anthropic: 'ANT',
  google: 'GOO',
  xai: 'xAI',
  deepseek: 'DSK',
  meta: 'MET',
  mistral: 'MIS',
  alibaba: 'ALI',
};

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
 * прыгала бы по высоте, когда дефицит появляется и исчезает, а с ней и кнопка под ней. aria-live
 * не ставится — число меняется вместе с кошельком и иначе читалось бы вслух.
 */
const TokenDeficit: React.FC<{ text: string; word: string }> = ({ text, word }) => {
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
      {text !== '' && (
        <>
          Не хватает <Num>{text}</Num> {word}
        </>
      )}
    </div>
  );
};

/**
 * Строка Модели. Владеет своим откликом на покупку: отмечать покупку в сторе значило бы гонять
 * эффект по всей колонке на каждом изменении состояния.
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

/**
 * Класс click-btn--squash переиспользован из ClickColumn для кнопки Перка: карточка
 * Перка после покупки остаётся (меняется на «Куплено»), поэтому сквош успевает
 * показаться — плюс уже существующий звук из стора. Перезапуск и снятие — тем же
 * приёмом, что на кнопке Клика: сброс чтением ширины, снятие по onAnimationEnd,
 * без таймеров.
 */
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

/**
 * Отказ по недоступной покупке: кнопка остаётся disabled (a11y не ломается), а Клик
 * ловит обёртка на погружении и отвечает низким buzz плюс вспышкой самой кнопки.
 *
 * Раньше у Моделей мигала строка дефицита под кнопкой, а у Перков, Откупов и Кристаллов —
 * сама кнопка: два ответа на одно действие в одном списке. Теперь отказ выглядит везде
 * одинаково, и вспыхивает то, на что игрок и нажал.
 *
 * Настройки звука читаются в момент Клика, а не подпиской: ради одного нажатия карточка не
 * должна следить за состоянием.
 */
const handleDeny = (affordable: boolean) => (e: React.MouseEvent<HTMLDivElement>) => {
  if (affordable) return;
  playDenySound(useGameStore.getState().state.settings);
  const node = e.currentTarget.querySelector('.pixel-btn');
  if (!(node instanceof HTMLElement)) return;
  node.classList.remove('deny-flash');
  void node.offsetWidth;
  node.classList.add('deny-flash');
};

/**
 * Прогресс до синергий Лаборатории: одиночный датасет — счёт одной лабы, совместный — состав
 * пары. Читает только Агентов и Апгрейды, которые меняются покупкой, а не тиком.
 */
const SynergyNotesView: React.FC<{ model: Model }> = ({ model: m }) => {
  const generation = useGameStore((s) => s.state.generation);
  const agents = useGameStore((s) => s.state.agents);
  const upgrades = useGameStore((s) => s.state.upgrades);
  const notation = useGameStore((s) => s.state.settings.notation);
  const roster = { generation, agents };

  // Прогресс до синергий — чистый derived render из состояния: число Агентов
  // каждой Лаборатории через labAgents, без нового состояния и без таймеров.
  // Одиночная синергия есть не у всех лаб (нужны ≥2 Модели в Поколении).
  const singleSynergy = UPGRADES_BY_GEN[generation].find(
    (u) => u.kind === 'synergy' && u.pairLab === undefined && u.lab === m.lab,
  );
  const singleBought = singleSynergy !== undefined && upgrades.includes(singleSynergy.id);
  const pairSynergies = UPGRADES_BY_GEN[generation].filter(
    (u) => u.kind === 'synergy' && u.pairLab !== undefined && (u.lab === m.lab || u.pairLab === m.lab),
  );

  if (!singleBought && pairSynergies.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
      }}
    >
      {/* Показывается только то, что уже куплено или уже готово к покупке.
          «0/15 + 0/15 до совместного датасета» на каждой из восьми карточек —
          не подсказка, а шум: игрок читает четыре нуля и решает, что ничего не
          происходит. Готовая к покупке пара подсвечивается золотом — это
          единственное, что меняет решение игрока прямо сейчас. */}
      {singleBought && <div>Общий датасет {LABS[m.lab].name} активен</div>}
      {pairSynergies.map((u) => {
        if (u.kind !== 'synergy' || u.pairLab === undefined) return null;
        const first = labAgents(roster, u.lab);
        const second = labAgents(roster, u.pairLab);
        const bought = upgrades.includes(u.id);
        const ready = first >= SYNERGY_MIN_AGENTS && second >= SYNERGY_MIN_AGENTS;
        const pairName = `${LABS[u.lab].name} × ${LABS[u.pairLab].name}`;
        // Не куплена и не готова — молчим: до порога строка обещает, а обещание
        // без срока читается как отказ.
        if (!bought && !ready) return null;
        return (
          <div key={u.id} style={ready ? { color: 'var(--gold)' } : undefined}>
            {bought && ready
              ? `Совместный датасет ${pairName} активен (×${formatNumber(PAIR_SYNERGY_MULT, notation)})`
              : bought
                ? `Совместный датасет ${pairName} ждёт состав ${first} + ${second}`
                : `Совместный датасет ${pairName} готов — забирай во вкладке Апгрейды`}
          </div>
        );
      })}
    </div>
  );
};

const SynergyNotes = React.memo(SynergyNotesView);

/** Справка AA: три числа из таблицы Модели, не из состояния. */
const AAReferenceView: React.FC<{ model: Model }> = ({ model: m }) => (
  <div
    id={`aa-${m.id}`}
    aria-labelledby={`aa-toggle-${m.id}`}
    style={{
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
      <div style={{ color: 'var(--accent-color)', fontWeight: 700 }}>
        {m.speed > 0 ? `${m.speed} t/s` : 'нет данных'}
      </div>
    </div>
    <div>
      <div style={{ color: 'var(--text-muted)' }}>Цена API:</div>
      <div style={{ color: 'var(--green)', fontWeight: 700 }}>
        {m.price > 0 ? `$${m.price}/1M` : 'нет данных'}
      </div>
    </div>
  </div>
);

const AAReference = React.memo(AAReferenceView);

/**
 * Карточка Модели. Подписана на свой срез `modelView` (множитель и режим берёт из стора), а не на
 * состояние: на тике перерисовывается, только когда в ней изменилась напечатанная цифра.
 */
const ModelCard: React.FC<{ model: Model; aaOpen: boolean; onToggleAA: (id: string) => void }> = ({
  model: m,
  aaOpen: isAAOpen,
  onToggleAA,
}) => {
  const buyAmount = useGameStore((s) => s.buyAmount);
  const sellMode = useGameStore((s) => s.sellMode);
  const buyAgents = useGameStore((s) => s.buyAgents);
  const sellAgents = useGameStore((s) => s.sellAgents);
  const view = useStateSlice((s) => modelView(s, m, buyAmount, sellMode));
  const { owned, count, canAfford, showsGain, goalTicks } = view;
  const lab = LABS[m.lab];

  return (
    <ModelRow owned={owned} isFlagship={m.isFlagship} canAfford={canAfford}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <MascotSprite lab={m.lab} size={28} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  fontSize: '1rem',
                  color: 'var(--text-main)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {m.name}
              </span>
              {m.isFlagship && (
                <span style={{ color: 'var(--gold)', flexShrink: 0 }} title="Флагман">
                  <Icon name="crown" size={13} />
                </span>
              )}
              {/* Отметка справки — квадратная, а не пилюля и не строка на всю
                  ширину: пять таких строк подряд превращали правую колонку в
                  список одинаковых плашек. Имя источника вынесено на вкладку,
                  здесь остаётся знак и полное имя для скринридера. */}
              <button
                onClick={() => onToggleAA(m.id)}
                aria-expanded={isAAOpen}
                aria-controls={`aa-${m.id}`}
                id={`aa-toggle-${m.id}`}
                aria-label={`Справка Artificial Analysis: ${m.name}`}
                title="Справка Artificial Analysis"
                style={{
                  flexShrink: 0,
                  width: '20px',
                  height: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  cursor: 'pointer',
                  background: isAAOpen ? 'var(--tint-accent)' : 'none',
                  border: '1px solid var(--border)',
                  borderRadius: '3px',
                  color: 'var(--accent-color)',
                }}
              >
                <Icon name="info" size={12} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Бейдж Лаборатории — три буквы фиксированной ширины. Полное имя
                  занимало строку целиком и выдавливало Ранг за край карточки на
                  длинных именах вроде «Llama 2 Chat 13B»; здесь имена Лабораторий
                  стоят в одной колонке, и глаз сравнивает их по цвету, а не читает. */}
              <span
                title={lab.name}
                style={{
                  fontSize: '0.6rem',
                  letterSpacing: '0.04em',
                  color: lab.color,
                  border: `1px solid ${lab.color}`,
                  padding: '0 3px',
                  minWidth: '2.4em',
                  textAlign: 'center',
                  flexShrink: 0,
                }}
              >
                {LAB_BADGE[m.lab]}
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Ранг {m.rank + 1}
              </span>
            </div>
          </div>
        </div>

        {/* Подпись обязательна: голое число не отличить от счётчика чего-то другого. */}
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right' }}>
          <div style={{ fontSize: '1.2rem' }}>
            <Num>{owned}</Num>
          </div>
          <div>{view.ownedWord}</div>
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
                <Num>{view.gainText}</Num> к доходу
              </>
            )}
          </div>

          <button
            onClick={() => (sellMode ? sellAgents(m.id) : buyAgents(m.id))}
            disabled={!canAfford}
            className={`pixel-btn pixel-btn-accent model-row__buy`}
            style={{
              padding: '7px 12px',
              fontSize: '0.85rem',
              backgroundColor: sellMode && canAfford ? 'var(--red-solid)' : undefined,
              borderColor: sellMode && canAfford ? 'var(--red)' : undefined,
              // Недоступная кнопка прозрачна для указателя: иначе браузер подавил бы
              // Клик точно в неё и deny-обёртка выше её бы не увидела.
              pointerEvents: canAfford ? undefined : 'none',
            }}
          >
            {/* Действие и цена — в одной кнопке, второй строкой. Раньше дефицит стоял
                отдельной строкой ПОД кнопкой и повторял то же число, что в ней: карточка
                вырастала на строку, а информации прибавлялось ноль. */}
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
              }}
            >
              <span>
                {/* «Купить ×0» обещало бы покупку, которой не будет. */}
                {sellMode ? (
                  count > 0 ? (
                    <>Продать ×<Num>{count}</Num></>
                  ) : (
                    <>Продать</>
                  )
                ) : count > 0 ? (
                  <>
                    Купить ×<Num>{count}</Num> (<Num>{view.costText}</Num>)
                  </>
                ) : (
                  <>Купить</>
                )}
              </span>
              {view.missingText !== '' && (
                <span style={{ fontSize: '0.7rem', opacity: 0.85 }}>
                  не хватает <Num>{view.missingText}</Num>
                </span>
              )}
              {sellMode && count > 0 && (
                <span style={{ fontSize: '0.7rem', opacity: 0.85 }}>
                  вернёт <Num>{view.refundText}</Num>
                </span>
              )}
            </span>
          </button>
        </div>

        {/* Рельс цели отвечает на «как близко», а не на «сколько не хватает», и это
            единственное, чего не повторяет кнопка. Подписи нет: число дефицита стоит
            внутри кнопки, а рельс показывает путь, который остался.

            Именно рельс, а не сплошная полоса: пять одинаковых заливок во всю ширину
            карточки читались как пять копий одного и того же блока и забивали собой
            весь магазин. Деления дают то же самое число, но каждая карточка выглядит
            по-своему — по количеству заполненных делений глаз сравнивает модели между
            собой, не читая подписей.

            Ширина делений не анимируется: рельс следует за кошельком, и переход,
            перезапускаемый на каждый сдвиг, тянул бы заливку позади настоящей доли. */}
        <div className="model-goal">
          <div
            className="model-goal__track"
            role="img"
            aria-label={`до следующего Агента ${view.goalPct}%`}
          >
            {GOAL_TICKS.map((_, i) => (
              <span
                key={i}
                className={`model-goal__tick${
                  i < goalTicks ? ' model-goal__tick--on' : ''
                }${i === goalTicks - 1 ? ' model-goal__tick--goal' : ''}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Прогресс до синергий Лаборатории: одиночный датасет — счёт одной лабы,
          совместный — состав пары. Только чтение состояния, без своих таймеров. */}
      <SynergyNotes model={m} />

      {/* Справка AA. Раньше подпись «Справка Artificial Analysis / подробнее»
          повторялась в каждой карточке, и на экране их было пять подряд: пять
          одинаковых строк с одинаковым треугольником. Теперь в карточке остаётся
          квадратная отметка у имени Модели, а имя Artificial Analysis стоит один раз
          на всю вкладку — атрибуция по-прежнему видна в магазине (ADR-0001), но
          перестаёт быть пятой копией сама себя.

          Волосяной линии над блоком больше нет: она отделяла подпись от рельса, а
          подписи не осталось, и в закрытом виде повисала под рельсом чужой чертой. */}
      {isAAOpen && <AAReference model={m} />}
    </ModelRow>
  );
};

/** Вкладка Моделей: список карточек Поколения и атрибуция AA. */
const ModelsTab: React.FC<{
  expandedAA: Record<string, boolean>;
  toggleAA: (id: string) => void;
}> = ({ expandedAA, toggleAA }) => {
  const generation = useGameStore((s) => s.state.generation);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {CATALOG[generation].models.map((m) => (
        <ModelCard key={m.id} model={m} aaOpen={!!expandedAA[m.id]} onToggleAA={toggleAA} />
      ))}

      {/* Атрибуция один раз на вкладку, а не в каждой карточке. Пять одинаковых строк
          «Справка Artificial Analysis» подряд читались как шум и занимали место, которое
          отдано моделям; имя источника при этом остаётся видимым в магазине (ADR-0001),
          и в подписи кнопки каждой карточки оно тоже есть. */}
      <div
        style={{
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          paddingTop: '2px',
        }}
      >
        <Icon name="info" size={12} />
        Метрики, задержки и цены API — Artificial Analysis
      </div>
    </div>
  );
};

const UpgradeCard: React.FC<{ upgrade: Upgrade }> = ({ upgrade: u }) => {
  const buyUpgrade = useGameStore((s) => s.buyUpgrade);
  const { canAfford, costText, missingText, missingWord } = useStateSlice((s) => upgradeView(s, u));

  return (
    <div
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

      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.desc}</div>

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
          Улучшить (<Num>{costText}</Num>)
        </button>

        <TokenDeficit text={missingText} word={missingWord} />
      </div>
    </div>
  );
};

/** Вкладка Апгрейдов: список меняется, только когда что-то открылось или куплено. */
const UpgradesTab: React.FC = () => {
  const upgrades = useStateSlice(availableUpgradesOf);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {upgrades.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px' }}>
          Пока нет доступных апгрейдов. Нанимай больше агентов!
        </div>
      ) : (
        upgrades.map((u) => <UpgradeCard key={u.id} upgrade={u} />)
      )}
    </div>
  );
};

/** Карточка совершения Престижа. */
const PrestigeCard: React.FC<{ onBackToModels: () => void }> = ({ onBackToModels }) => {
  const requestPrestige = useGameStore((s) => s.requestPrestige);
  const { finale, ready, gain } = useStateSlice(prestigeCardView);

  return (
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
            <Num>+{gain}</Num>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            (Каждая единица Compute даёт постоянный бонус +1% к Доходу)
          </div>
        </div>
      )}

      {/* Кнопка не гаснет, даже когда Престиж невозможен: погашенная кнопка молчит о
          причине, а окно подтверждения её объясняет и отказывает тем же переходом,
          который проверяет стор. */}
      <button
        onClick={requestPrestige}
        className="pixel-btn pixel-btn-gold"
        style={{ width: '100%', marginTop: '4px' }}
      >
        {finale ? 'Финал контента' : ready ? 'Сделать Престиж!' : 'Нужен 1 Агент Флагмана'}
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
            onClick={onBackToModels}
            className="pixel-btn pixel-btn-accent"
            style={{ width: '100%' }}
          >
            К Моделям
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * ОТКУПЫ. Блок виден всегда, а не только во время Восстания: скрытая покупка — дверь в одну
 * сторону, и игрок не узнал бы, что от красных событий вообще можно откупиться.
 */
const PledgeCard: React.FC = () => {
  const buyPledge = useGameStore((s) => s.buyPledge);
  const buyLicense = useGameStore((s) => s.buyLicense);
  const revokeLicense = useGameStore((s) => s.revokeLicense);
  const view = useStateSlice(pledgeView);

  return (
    <div
      className="pixel-card"
      style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}
    >
      <div style={{ fontSize: '1rem', color: 'var(--text-main)' }}>
        Откупы от Восстания моделей
      </div>

      {view.uprising === 0 ? (
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
                Куплено <Num>{view.pledgeBought}</Num> из <Num>{PLEDGE_MAX}</Num>,
                каждая следующая дороже в <Num>{PLEDGE_GROWTH}</Num> раз.
              </div>
              {/* Под «Лицензией» кнопка молчит, но не прячет цену и условие: игрок
                  обязан прочитать, что Лобби стал недоступен и почему. */}
              {view.covenant && (
                <div style={PLEDGE_DESC}>
                  «Лицензия» глушит всё, поэтому Лобби за <Num>{view.pledgeCostText}</Num> не продаётся.
                </div>
              )}
              {view.leftText !== '' && (
                <div style={{ ...PLEDGE_DESC, color: 'var(--green)' }}>
                  Глушит ещё {view.leftText}
                </div>
              )}
            </div>
            <div onClickCapture={handleDeny(view.canPledge)} style={{ flexShrink: 0 }}>
              <button
                onClick={buyPledge}
                disabled={!view.canPledge}
                className="pixel-btn pixel-btn-accent"
                style={{ padding: '6px 10px', fontSize: '0.85rem' }}
              >
                {view.covenant ? (
                  'Есть Лицензия'
                ) : (
                  <>
                    Откупиться (<Num>{view.pledgeCostText}</Num>)
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Лицензия. Её размен назван прямо и ДО покупки, потому что налог на Доход
              платится постоянно, а не разово: игрок обязан видеть, что именно он
              покупает вместе с вечным глушением. */}
          {view.covenant ? (
            <div style={PLEDGE_ROW}>
              <div style={PLEDGE_TEXT}>
                <div style={{ fontSize: '0.95rem', color: 'var(--green)' }}>
                  Лицензия активна
                </div>
                <div style={PLEDGE_DESC}>
                  Красные события глушатся, Глюки не заводятся. Налог на Доход{' '}
                  −<Num>{view.taxText}</Num>%{' '}
                  платится, пока Лицензия не отозвана.
                </div>
              </div>
              <div onClickCapture={handleDeny(view.canRevoke)} style={{ flexShrink: 0 }}>
                <button
                  onClick={revokeLicense}
                  disabled={!view.canRevoke}
                  className="pixel-btn"
                  style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                >
                  Отозвать (<Num>{view.revokeCostText}</Num>)
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
                  <Num>{view.taxText}</Num>%:
                  отзыв обойдётся в{' '}
                  <Num>{view.revokeCostText}</Num>.
                </div>
              </div>
              <div onClickCapture={handleDeny(view.canLicense)} style={{ flexShrink: 0 }}>
                <button
                  onClick={buyLicense}
                  disabled={!view.canLicense}
                  className="pixel-btn pixel-btn-gold"
                  style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                >
                  Взять Лицензию (
                  <Num>{view.licenseCostText}</Num>)
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Рост следующего кристалла: одна полоса и честный остаток. Сбор ленивый — зреет максимум
 * один кристалл, — поэтому обещать «через N» можно только про один. Единственная часть вкладки,
 * которую двигают часы, и потому отдельный подписчик: остаток меняется раз в секунду.
 */
const CrystalGrowth: React.FC = () => {
  const { planted, leftText, width, now } = useStateSlice(crystalGrowthView);
  const motion = useMotionAllowed();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
        {planted ? <>Следующий зреет ещё {leftText}</> : 'Первый кристалл только сеется'}
      </div>
      <div
        role="progressbar"
        aria-label="Рост следующего кристалла"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={now}
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
            width: `${width}%`,
            height: '100%',
            backgroundColor: 'var(--accent-color)',
            transition: motion ? 'width 0.2s linear' : undefined,
          }}
        />
      </div>
    </div>
  );
};

const CrystalUpgradeCard: React.FC<{ upgrade: CrystalUpgrade }> = ({ upgrade: u }) => {
  const buyCrystalUpgrade = useGameStore((s) => s.buyCrystalUpgrade);
  const { owned, canAfford, lostText, costText, costWord } = useStateSlice((s) => crystalUpgradeView(s, u));

  return (
    <div
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
      <span style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>{u.name}</span>
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
        {owned ? (
          'Куплено: бонус за запас уже урезан'
        ) : (
          <>
            Забирает <Num>{lostText}</Num>% бонуса за запас навсегда
          </>
        )}
      </div>
      <div
        onClickCapture={handleDeny(owned || canAfford)}
        style={{ display: 'flex', justifyContent: 'flex-end' }}
      >
        <button
          onClick={() => buyCrystalUpgrade(u.id)}
          disabled={owned || !canAfford}
          className={`pixel-btn ${owned ? '' : 'pixel-btn-accent'}`}
          style={{ padding: '6px 10px', fontSize: '0.85rem' }}
        >
          {owned ? (
            'Куплено'
          ) : (
            <>
              Купить (<Num>{costText}</Num> {costWord})
            </>
          )}
        </button>
      </div>
    </div>
  );
};

/**
 * КРИСТАЛЛЫ. Здесь показан весь размен ускорителя, а не только его польза: кристалл в запасе
 * даёт +1% к общему Доходу, поэтому покупка забирает часть этого бонуса навсегда. Без этой строки
 * игрок покупал бы ускоритель, думая, что он ничего не стоит.
 */
const CrystalCard: React.FC = () => {
  const { stock, bonus } = useStateSlice(crystalStockView);

  return (
    <div
      className="pixel-card"
      style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}
    >
      <div style={{ fontSize: '1rem', color: 'var(--text-main)' }}>
        Compute-кристаллы
      </div>

      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        В запасе <Num>{stock}</Num>, каждый целый
        кристалл даёт +1% к общему Доходу навсегда. Сейчас это{' '}
        <span style={{ color: 'var(--green)', fontWeight: 600 }}>
          +<Num>{bonus}</Num>%
        </span>
        , потолок запаса — <Num>{CRYSTAL_STOCK_CAP}</Num>. Кристалл зреет в реальном
        времени и переживает Престиж.
      </div>

      <CrystalGrowth />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {CRYSTAL_UPGRADES.map((u) => (
          <CrystalUpgradeCard key={u.id} upgrade={u} />
        ))}
      </div>
    </div>
  );
};

/** Магазин Перков: Compute и список купленных меняются покупкой и Престижем, а не тиком. */
const PerkShop: React.FC = () => {
  const buyPerk = useGameStore((s) => s.buyPerk);
  const perks = useGameStore((s) => s.state.perks);
  const unspentCompute = useGameStore((s) => s.state.compute - s.state.computeSpent);
  // Особые перки живут в том же PERKS, но с другой ценой и условием: список делится здесь, в
  // render, без нового состояния: обычные — со своей статичной ценой, особые — отдельной
  // подсекцией ниже.
  const regularPerks = PERKS.filter((p) => !isGenPerkId(p.id));

  return (
    <div>
      <div
        style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '8px' }}
      >
        Постоянные перки (Свободно: <Num>{unspentCompute}</Num> Compute)
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {regularPerks.map((p) => {
          const owned = perks.includes(p.id);
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
                onClickCapture={handleDeny(owned || canAfford)}
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
  );
};

/**
 * Наследие поколений: особые перки переживают Престиж и усиливают только своё Поколение. Цена
 * общая на всех — genPerkCost за следующий некупленный, поэтому карточка показывает её, а не
 * статичный cost из таблицы. Покупка идёт тем же buyPerk (движок сам сверяет Поколение и
 * флагмана), новых экшенов нет.
 */
const LegacyPerks: React.FC = () => {
  const buyPerk = useGameStore((s) => s.buyPerk);
  const perks = useGameStore((s) => s.state.perks);
  const generation = useGameStore((s) => s.state.generation);
  const unspentCompute = useGameStore((s) => s.state.compute - s.state.computeSpent);
  const prestigeReady = useStateSlice(canPrestige);
  const genPerks = CATALOG.flatMap((g) => {
    const p = PERK_BY_ID[genPerkId(g.index)];
    return p ? [p] : [];
  });
  const boughtGenPerks = countGenPerks(perks);
  const nextGenPerkCost = genPerkCost(perks);

  return (
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
          const owned = perks.includes(p.id);
          // Поколение особого перка: null быть не может (список собран через genPerkId
          // по каталогу), но чужой id из старого сохранения разбираем в 0, чтобы
          // карточка не упала, а ушла в приглушённые.
          const perkGen = genPerkGeneration(p.id) ?? 0;
          const genName = CATALOG[perkGen]?.name ?? '';
          const isCurrentGen = perkGen === generation;
          const isFutureGen = perkGen > generation;
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
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {isFutureGen
                    ? <>Откроется в поколении «{genName}»</>
                    : needFlagship
                      ? 'Нужен флагман поколения'
                      : null}
                </div>
              )}

              <div
                onClickCapture={handleDeny(owned || canAfford)}
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
  );
};

/** ВКЛАДКА ПРЕСТИЖА И ПЕРКОВ */
const PerksTab: React.FC<{ onBackToModels: () => void }> = ({ onBackToModels }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
    <PrestigeCard onBackToModels={onBackToModels} />
    <PledgeCard />
    <CrystalCard />
    <PerkShop />
    <LegacyPerks />
  </div>
);

/**
 * Колонка магазина: переключатель вкладок и множители. Подписана на то немногое, что решает
 * ей самой, — множитель, режим, число доступных Апгрейдов и состояние Престижа; содержимое
 * вкладок читает своё само, поэтому тик колонку не перерисовывает.
 */
const ShopColumnView: React.FC<{ full?: boolean }> = ({ full = false }) => {
  const [tab, setTab] = useState<'models' | 'upgrades' | 'perks'>('models');
  // Раскрытые справки AA живут в колонке, а не во вкладке: вкладку размонтирует смена вкладки
  // магазина, а открытая справка не должна закрываться оттого, что игрок заглянул в Апгрейды.
  const [expandedAA, setExpandedAA] = useState<Record<string, boolean>>({});
  const toggleAA = (id: string) => {
    setExpandedAA((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const buyAmount = useGameStore((s) => s.buyAmount);
  const sellMode = useGameStore((s) => s.sellMode);
  const setBuyAmount = useGameStore((s) => s.setBuyAmount);
  const setSellMode = useGameStore((s) => s.setSellMode);
  const upgradesCount = useStateSlice((s) => availableUpgradesOf(s).length);
  const finale = useStateSlice(isContentFinale);
  const prestigeReady = useStateSlice(canPrestige);

  // Вкладка приглушена, а не скрыта: скрытая вкладка — дверь в одну сторону, и игрок
  // не узнал бы, что Престиж вообще существует. На финале контента Престиж недоступен
  // навсегда, поэтому приглушение там не снимается.
  const prestigeLocked = finale || !prestigeReady;

  // Престиж открывает окно подтверждения, а не выполняется здесь: сброс Забега необратим,
  // и игрок должен увидеть, сколько Compute начислит, что сгорит и в какое Поколение он
  // попадёт. Один путь на обе колонки — свой взвод здесь означал бы два разных подтверждения
  // одного и того же действия. Сам переход живёт в triggerPrestige, его зовёт окно.

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
          {upgradesCount > 0 && (
            <span
              key={upgradesCount}
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
              {upgradesCount}
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
          только через opacity toast-fade, состояние tab не трогаем. */}
      <div
        key={tab}
        style={{
          flex: 1,
          overflowY: 'auto',
          // Отступ справа под скроллбар: полоса прокрутки наезжала на цену в кнопке,
          // и последние пиксели цифры уходили под неё. 14px — ширина полосы плюс зазор.
          paddingRight: '14px',
          animation: 'toast-fade 0.15s ease-out',
        }}
      >
        {tab === 'models' && <ModelsTab expandedAA={expandedAA} toggleAA={toggleAA} />}
        {tab === 'upgrades' && <UpgradesTab />}
        {tab === 'perks' && <PerksTab onBackToModels={() => setTab('models')} />}
      </div>
    </div>
  );
};

export const ShopColumn = React.memo(ShopColumnView);
