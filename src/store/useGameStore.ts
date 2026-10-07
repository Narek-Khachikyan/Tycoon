import { create } from 'zustand';
import { CATALOG, MODEL_BY_ID } from '../economy/catalog';
import {
  advanceTime,
  applyOffline,
  buyAgents as engineBuyAgents,
  buyPerk as engineBuyPerk,
  buyUpgrade as engineBuyUpgrade,
  canPrestige,
  click as engineClick,
  clickValue,
  earnTokens,
  isContentFinale,
  isValidInterval,
  OFFLINE_THRESHOLD_SEC,
  prestige as enginePrestige,
  prestigeGain,
  sellAgents as engineSellAgents,
  shatterCrystal as engineShatterCrystal,
  totalIncome,
} from '../economy/engine';
import {
  ACHIEVEMENTS,
  awardAchievements,
  awardShadowAchievements,
} from '../economy/achievements';
import { activeSpec, grantAmount, isEventActive } from '../economy/events';
import { formatNumber } from '../economy/format';
import { buyCrystalUpgrade as engineBuyCrystalUpgrade } from '../economy/crystal';
import { CHALLENGES, startChallenge as engineStartChallenge, type ChallengeDef } from '../economy/challenges';
import { claimMilestones } from '../economy/milestones';
import {
  buyLicense as engineBuyLicense,
  buyPledge as engineBuyPledge,
  crashAmount,
  hitGlitch as engineHitGlitch,
  revokeLicense as engineRevokeLicense,
  uprisingStage,
} from '../economy/glitches';
import { pickNews } from '../economy/news';
import { clampTemp, HALLUC_HEAT, heatRate, TEMP_MAX } from '../economy/thermal';
import { perkEffects } from '../economy/perks';
import { pickQuip, recordQuip } from '../economy/quips';
import { availableUpgrades } from '../economy/upgrades';
import { importSave, migrate, quarantineStoredSave, readStoredSave, SAVE_KEY, serialize } from '../economy/save';
import { newGame, type GameState, type Notation } from '../economy/state';
import {
  playAchievementSound,
  playBuySound,
  playClickSound,
  playDenySound,
  playEventAlertSound,
  playPrestigeSound,
  playQuipSound,
  playUpgradeSound,
  audioContext,
} from '../audio/sound';
import type { LabId } from '../data/labs';
import { PROMPT_TEMPLATES } from '../data/prompts';
import { playCoolingSound, playHallucinationSound, updateThermalAudio } from '../audio/thermal';
import { stopMusic, updateMusic } from '../audio/music';
import { playMilestoneSound } from '../audio/sfx';

export type BuyAmount = 1 | 10 | 100 | 'max';
export type ActiveTab = 'click' | 'office' | 'shop' | 'upgrades' | 'perks' | 'stats' | 'achievements' | 'settings';

export interface ToastMessage {
  id: string;
  title: string;
  /** Название и описание Достижения текстом, а не id: тост — единственное, что игрок читает
   *  по этому поводу, и id теневого Достижения в нём смотрелся бы английским словом. */
  name: string;
  desc: string;
}

export interface ClickFloater {
  id: number;
  x: number;
  y: number;
  text: string;
}

/** Событие, на которое интерфейсу нужен собственный громкий отклик. */
export type BurstKind = 'achievement' | 'prestige';

export interface BurstEvent {
  kind: BurstKind;
  /** Растёт на каждое событие: потребитель смотрит на него, а не на сам факт события, поэтому
   *  два одинаковых подряд не схлопываются в один отклик. */
  nonce: number;
  /** Данные для оверлея Престижа: новое Поколение, полученный Compute и испытание, которое
   *  было активно в завершённом Забеге (его награда — +10% к Доходу навсегда). Только UI-слой,
   *  в GameState не попадает и в сейв не пишется. */
  prestige?: { generation: number; computeGain: number; challengeId?: 'no-synergy' | 'no-click' };
}

interface OfflineReport {
  seconds: number;
  earned: number;
  /** Сколько кристаллов дозрело за простой: их собирает applyOffline, и без этой строки игрок
   *  узнал бы о них только по прибавке к Доходу на экране. */
  crystals: number;
}

interface ChatMessage {
  id: number;
  userPrompt: string;
  aiResponse: string;
}

/** Реплика говорящей Модели, показанная пузырём в офисе. Вне GameState, как burst: это
 *  «показываем ли мы», а не состояние игры, и её добавление не должно стоить миграции.
 *  Тождество — nonce: потребитель смотрит на него, поэтому две одинаковые реплики подряд
 *  не схлопываются в один показ и гасить поле вручную не нужно — стор гасит его сам. */
export interface LastQuip {
  id: string;
  text: string;
  lab: LabId | null;
  nonce: number;
}

/**
 * Шаблон, который нельзя повторить дважды подряд.
 *
 * Один `Math.random` давал две одинаковые реплики подряд примерно в одном случае из
 * восьми, и чат выглядел залипшим наглухо. Индекс живёт в UI-слое рядом со счётчиками и в
 * GameState не попадает: это не часть сохранения, и его добавление не должно стоить миграции.
 */
let lastTemplateIndex = -1;
const nextTemplateIndex = (): number => {
  const len = PROMPT_TEMPLATES.length;
  const i = Math.floor(Math.random() * len);
  if (i !== lastTemplateIndex) {
    lastTemplateIndex = i;
    return i;
  }
  // Выбор из остальных: сдвиг на единицу давал бы заметный перекос в пользу следующего шаблона.
  const j = (i + 1 + Math.floor(Math.random() * (len - 1))) % len;
  lastTemplateIndex = j;
  return j;
};

/**
 * Поднимает стадию до уровня своего Поколения; ничего не меняет — возвращает тот же объект,
 * иначе стор решил бы по тождеству, что переход что-то сделал.
 *
 * Только вверх: понижение означало бы, что импорт старого забега отбирает у игрока уже
 * пережитое Восстание вместе с откупом, который на него куплен.
 */
function raiseUprising(state: GameState): GameState {
  const stage = uprisingStage(state.generation);
  if (state.uprising >= stage) return state;
  return { ...state, uprising: stage };
}

/** Что игроку говорят про каждую стадию: тихое число в состоянии он бы не заметил. */
const UPRISING_LINES: readonly string[] = [
  '',
  'Агенты начали выдавать красные ответы. Модераторы в шоке.',
  'Красных событий всё больше. Отдел качества пишет кодекс.',
  'Красные события теперь выпадают всегда. Поддержка закрыта.',
];

/**
 * Окна события, о котором стор ещё не говорил. Минус, а ноль: у события из битого сохранения
 * `startedAt` равен нулю (его дописывает разбор), и ноль как «ничего не объявлялось» сделал бы
 * такое событие неотличимым от уже показанного — оно осталось бы без объявления и без отклика.
 */
const NO_EVENT_WINDOW = -1;

/**
 * Поймано ли окно, в котором лежит `state.event`.
 *
 * Отметка лежит в состоянии и сверяется с началом окна, а не с её флагом: событие переживает
 * перезагрузку, и забор в памяти вкладки обнулялся бы вместе с ней — тот же клик платил бы или
 * списывал за одно окно дважды. Ноль приходится отсекать отдельно: у события из битого сохранения
 * `startedAt` равен нулю, и без этой проверки такое окно считалось бы уже пойманным.
 */
const caughtWindow = (state: GameState): boolean =>
  state.eventCaughtAt > 0 && !!state.event && state.event.startedAt === state.eventCaughtAt;

interface GameStore {
  state: GameState;
  news: string;
  offlineReport: OfflineReport | null;
  /** Открыто ли окно подтверждения Престижа. Намеренно вне GameState, как burst: Престиж —
   *  единственный необратимый переход в игре, и стирать Забег одним кликом без вопроса нельзя.
   *  Кнопки обеих колонок открывают окно (requestPrestige), а переход выполняет triggerPrestige —
   *  условия отказа живут там, а не в окне. */
  prestigePrompt: boolean;
  activeTab: ActiveTab;
  buyAmount: BuyAmount;
  sellMode: boolean;
  toasts: ToastMessage[];
  floaters: ClickFloater[];
  chatHistory: ChatMessage[];
  /** Пузырь реплики в офисе, null = пузырь скрыт. Авто-скрытие — bounded one-shot в clickPrompt. */
  lastQuip: LastQuip | null;
  /** Модель последней покупки Агентов: её Лаборатория говорит следующим Кликом. Вне GameState
   *  по той же причине, что lastQuip: это «кто говорит», а не состояние игры. */
  lastBoughtModelId: string | null;
  /** Канал громких событий. Намеренно вне GameState: это не часть сохранения, и его добавление
   *  не должно стоить миграции. Событие перезаписывается следующим, а тождество у него — nonce:
   *  потребитель смотрит на nonce, поэтому два одинаковых подряд не схлопываются в один отклик
   *  и гасить канал вручную не нужно — тот, кто показал отклик, и так его показал. */
  burst: BurstEvent | null;
  /** Окно события, о котором стор уже объявил игроку: момент старта, NO_EVENT_WINDOW = окна нет.
   *  Ключ окна — его старт, а не вид события: одно и то же событие переживает перезагрузку, и
   *  второй раз поймать его нельзя. Вне GameState по той же причине, что и остальной UI-слой:
   *  это «показывали ли мы», а не состояние игры. */
  eventWindowAt: number;
  /** Поймано ли текущее окно события: зеркало `state.eventCaughtAt` для кнопки «Поймать».
   *  Забор и деньги читают состояние, а не это поле, поэтому перезагрузка не может его обнулить и
   *  разрешить второй раз поймать то же окно; зеркало нужно только подписи и disabled. */
  eventCaught: boolean;
  /** Окно события, на котором игрок уже подтвердил потерю: момент его старта, 0 = не подтверждал.
   *  UI-слой: подтверждение перезагрузка обязана забыть, иначе «Крах» пришлось бы ловить, не
   *  прочитав его заново. */
  crashArmedAt: number;
  /** Id слуха из Новостной ленты, за который уже выплатили; 0 = ни разу. Вне GameState по
   *  причине, названной в collectRumor: id слуха рождается в ленте заново на каждой странице,
   *  и сохранённый забор показывал бы слухи, но никогда бы за них не платил. */
  collectedRumorId: number;

  // Actions
  tick: (dt: number) => void;
  clickPrompt: (x?: number, y?: number) => void;
  buyAgents: (modelId: string) => void;
  sellAgents: (modelId: string) => void;
  buyUpgrade: (upgradeId: string) => void;
  buyPerk: (perkId: string) => void;
  /** Покупает «Лобби»: красные события гаснут на полчаса, цена растёт на каждой покупке. */
  buyPledge: () => void;
  /** Покупает бессрочную «Лицензию»: налог с Дохода и ни одного Глюка. */
  buyLicense: () => void;
  /** Отзывает «Лицензию» за фиксированную цену: налог уходит, Глюки не возвращаются. */
  revokeLicense: () => void;
  /** Перманентный ускоритель роста кристалла за кристаллы из запаса. */
  buyCrystalUpgrade: (id: string) => void;
  /** Разбивает целый Compute-кристалл из запаса в разовые Токены. */
  shatterCrystal: () => void;
  /** Ловит живое событие кликом по Золотому Токену: разовый вид платит, временный засчитывается. */
  catchEvent: () => void;
  /** Удар по Глюку; на третьем он лопается и выплата идёт через earnTokens. */
  hitGlitch: (id: number) => void;
  /** Забирает разовую выплату слуха из Новостной ленты: сумма считается в момент нажатия. */
  collectRumor: (id: number) => void;
  requestPrestige: () => void;
  dismissPrestigePrompt: () => void;
  triggerPrestige: () => void;
  /** Принимает испытание Забега на свежем забеге (или отказ от него через null). */
  startChallenge: (id: 'no-synergy' | 'no-click' | null) => void;

  /** Ставит Температуру напрямую: диапазон и защиту от мусора берёт на себя clampTemp. */
  setTemp: (t: number) => void;
  /**
   * Пересобирает непрерывный голос Температуры под текущее состояние.
   *
   * Публично ровно ради тестов: иначе проверка «мут гасит и непрерывный голос» не могла бы
   * отличить «обновлённое состояние» от «обновлённого звука», а это ровно то, что нужно знать.
   * В игре вызывается из `tick` и `setTemp`.
   */
  syncThermalVoice: () => void;
  setBuyAmount: (amt: BuyAmount) => void;
  setSellMode: (mode: boolean) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setNotation: (notation: Notation) => void;
  toggleMute: () => void;
  setReducedMotion: (on: boolean) => void;
  /** Громкость 0..1. Зажимается здесь, а не в ползунке: значение приходит из импортируемого
   *  файла и из разметки, а громкий хрип на полной шкале — это испорченное впечатление,
   *  поэтому границы держит стор, единственный владелец состояния. */
  setVolume: (volume: number) => void;
  /** Пауза Новостной ленты: останавливает и движение строки, и смену новости. Живёт в UI-слое
   *  и не сохраняется — персистентность означала бы новое поле в `GameState.settings` и правку
   *  контракта сохранения ради одного переключателя. */
  newsPaused: boolean;
  setNewsPaused: (paused: boolean) => void;
  dismissOfflineReport: () => void;
  removeToast: (id: string) => void;
  importSaveData: (str: string) => boolean;
  resetGame: () => void;
  /** Показывать ли экран финала контента. UI-слой, как остальные окна: игрок закрывает
   *  экран и живёт дальше, но вернуть его можно из вкладки Престижа — без этого финал был бы
   *  односторонней дверью. В GameState не живёт: состояние «окно закрыто» прогресса не меняет. */
  finaleDismissed: boolean;
  openFinale: () => void;
  dismissFinale: () => void;
  refreshNews: () => void;
}

function loadInitialState(): { state: GameState; offline: OfflineReport | null; notice: ToastMessage | null } {
  const now = Date.now();
  let raw: unknown = null;
  let corrupt = false;
  if (typeof window !== 'undefined') {
    const stored = readStoredSave();
    if (stored.status === 'ok') {
      raw = stored.value;
    } else if (stored.status === 'corrupt') {
      // Битые байты — в карантин под отдельный ключ, иначе первый же тик затёр бы их свежей
      // игрой. Пустое хранилище сюда не попадает: там тихий старт без сообщения.
      quarantineStoredSave(stored.text);
      corrupt = true;
    }
  }

  // Тост вместо тихого старта с нуля: игрок обязан узнать, что забег потерян чтением,
  // а не его действиями, и что старые данные не стёрты.
  const notice: ToastMessage | null = corrupt
    ? {
        id: `corrupt-${++toastCounter}`,
        title: 'Сохранение повреждено',
        name: 'Старый Забег',
        desc: 'Прошлое сохранение не прочиталось, поэтому начат новый Забег. Старые данные не стёрты и лежат отдельно.',
      }
    : null;

  const base = migrate(raw, now);
  // Оффлайн-начисление, если игра была закрыта дольше порога простоя
  if ((now - base.lastTick) / 1000 >= OFFLINE_THRESHOLD_SEC && base.totalTokens > 0) {
    const { state: updated, seconds, earned } = applyOffline(base, now);
    // Кристалл дозревает и собирается внутри applyOffline, а тот переставляет crystalPlantedAt на
    // `now` — поэтому первый тик после загрузки его не повторяет и потеряться ему негде. Чего
    // не хватало, так это упоминания: кристалл стоит +1% Дохода навсегда, и молчать о нём нельзя.
    const crystals = updated.crystals - base.crystals;
    return {
      state: updated,
      // Отчёт показывается и из-за одного кристалла: доход за простой бывает нулевым (например,
      // когда все Агенты проданы), а игрок всё равно что-то получил.
      offline: earned > 0 || crystals > 0 ? { seconds, earned, crystals } : null,
      notice,
    };
  }

  return { state: base, offline: null, notice };
}

let floaterCounter = 0;
let chatCounter = 0;
let toastCounter = 0;
let burstCounter = 0;
let quipCounter = 0;

/** Пузырь реплики висит 4.5 с: входной pop занимает 0.25 с, уходной fade стартует CSS-задержкой
 *  на 4.32 с, и стор гасит поле уже после него — fade видно целиком. */
const QUIP_HIDE_MS = 4500;

/**
 * Лаборатория говорящего: Лаборатория последней купленной Модели. Агентов нет — говорить
 * некому, lab null, и реплику подбирает уже pickQuip: первая реплика видна до первой покупки.
 * Запасной путь — первая купленная Модель: сохранение из чужой вкладки привозит Агентов без
 * отметки о последней покупке, и без него офис молчал бы до следующей покупки.
 */
function speakerLab(state: GameState, lastModelId: string | null): LabId | null {
  const ownedId = Object.keys(state.agents).find((id) => state.agents[id] > 0 && MODEL_BY_ID[id]);
  if (!ownedId) return null;
  return (lastModelId ? MODEL_BY_ID[lastModelId]?.lab : undefined) ?? MODEL_BY_ID[ownedId].lab;
}

/**
 * Как часто тик дописывает состояние в сейв.
 *
 * Тик идёт двадцать раз в секунду, и раньше он писал весь `GameState` в `localStorage` каждый
 * раз: двадцать `JSON.stringify` и двадцать синхронных записей в секунду ради прогресса, который
 * за это время изменился на доли процента. Замер в Chrome 154 (macOS, позднее Поколение, 5.4 КБ
 * сейва) дал 28 мкс на тик, то есть около 0.6 мс главного потока в секунду на пустом месте, и
 * 100 КБ/с записи на диск. Раз в секунду эта работа падает в двадцать раз, а проигрыш ограничен
 * одной секундой, которая не теряется: `lastTick` едет вместе с доходом, поэтому простой между
 * последней записью и закрытием вкладки вернётся оффлайн-доходом, а не потеряется.
 *
 * Число, а не тики: интервал в тиках разъезжался бы с реальной скоростью двадцать раз в секунду и
 * зависел бы от того, как часто страница успела позвать тик.
 */
export const SAVE_INTERVAL_MS = 1000;

/**
 * Есть ли в состоянии изменения, которых в сейве ещё нет.
 *
 * Флаг, а не снимок: запись всегда берёт самое свежее состояние магазина (см. `writeSave`), и
 * потому отложенная запись физически не может переписать сейв более старым состоянием. Снимок
 * пришлось бы хранить и сверять, а выиграть это можно только за счёт риска отката сохранения —
 * а откат сохранения игрок не простит.
 */
let savePending = false;

/** Момент последней удачной записи; 0 = ещё не писали, и первый же тик запишет сразу. */
let savedAt = 0;

/**
 * Кладёт в сейв самое свежее состояние магазина.
 *
 * Не переданный снимок, а чтение из магазина: у отложенной записи нет «своего» состояния, и она
 * записывает ровно то, что игрок видит на экране. Из этого же следует, что порядок не важен —
 * вызвать можно хоть до, хоть после `set`.
 *
 * `savePending` снимается только после успеха: заблокированное хранилище (приватный режим,
 * SecurityError) не должно молча превращать игру в игру без сохранения — попытка повторится на
 * следующем тике.
 *
 * Guard монотонности: отстающая вкладка не переписывает новую. Запись пропускается, если в
 * хранилище уже лежит более свежий lastTick — иначе вторая вкладка откатила бы сейв и
 * повторно выплатила бы оффлайн за уже оплаченный интервал. Равенство пишет: покупка не
 * двигает часы, но обязана попасть в сейв сразу.
 *
 * Не-числа не пишутся вовсе: JSON.stringify(NaN) даёт null, а миграция читает null как 0 —
 * кошелёк обнулился бы одним тиком. Тик с NaN уже no-op в движке, это вторая стена.
 */
function writeSave(force = false): void {
  if (typeof window === 'undefined') return;
  try {
    const cur = useGameStore.getState().state;
    if (
      !Number.isFinite(cur.lastTick) ||
      !Number.isFinite(cur.tokens) ||
      !Number.isFinite(cur.runTokens) ||
      !Number.isFinite(cur.totalTokens)
    )
      return;
    if (!force) {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) {
          const savedTick = (JSON.parse(raw) as { lastTick?: unknown }).lastTick;
          if (typeof savedTick === 'number' && Number.isFinite(savedTick) && savedTick > cur.lastTick)
            return;
        }
      } catch {
        // Нечитаемый сейв guard не держит: его увозит карантин, а не молчаливый пропуск.
      }
    }
    localStorage.setItem(SAVE_KEY, serialize(cur));
    savePending = false;
    savedAt = Date.now();
  } catch {
    // ignore
  }
}

/**
 * Запись по значимому действию игрока: сейчас, а не «когда тик дойдёт».
 *
 * Покупка, Престиж, Апгрейд, Перк, откуп, настройка, импорт и сброс — всё, что меняет забег по
 * воле игрока, обязано лежать в сейве до того, как он успеет закрыть вкладку. Действий такого
 * рода за минуту десятки, а не двадцать в секунду, поэтому дроссель на них не распространяется.
 */
const saveNow = (force = false): void => {
  savePending = true;
  writeSave(force);
};

/**
 * Отложенная запись с тика: пишет не чаще раза в `SAVE_INTERVAL_MS`, а всё, что не записалось,
 * дописывает при уходе вкладки (см. `flushSave`).
 *
 * Именно тик и Клик, а не покупка: это единственные действия, которые идут непрерывной стеной, и
 * только для них секундный риск приемлем — доход за неё вернётся оффлайн-доходом, а купленное
 * и заработанное лежит в сейве сразу.
 */
const saveLater = (): void => {
  savePending = true;
  if (Date.now() - savedAt < SAVE_INTERVAL_MS) return;
  writeSave();
};

/**
 * Дописывает отложенное перед тем, как документ уйдёт из поля зрения или вкладку закроют.
 *
 * Здесь игнорировать отложенное нельзя: последний экран игры — это и есть момент, в который
 * игрок решает, закрывать ли вкладку, и потерять тут секунду дохода — значит потерять её молча.
 * Отдельного таймера у функции нет намеренно: она зовётся событиями страницы, а не тиком, который
 * в фоне и так замирает.
 */
export function flushSave(): void {
  if (!savePending) return;
  writeSave();
}

/** Подписки на уход со страницы. Ставятся один раз при загрузке модуля, без доступа к DOM. */
function installSaveFlush(): void {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  // Оба события дописывают одно и то же, и различать их незачем: скрытие вкладки и её закрытие
  // требуют одинакового ответа — сохранить. Видимость меняется и обратно, и лишняя запись
  // одного и того же состояния ничего не стоит.
  document.addEventListener('visibilitychange', flushSave);
  window.addEventListener('pagehide', flushSave);
}

/** Системная настройка движения. Литерал живёт здесь один раз: тот же запрос читает
 *  CSS-гейт в index.css, а JS нужен ещё и сам список — для слушателя смены настройки. */
export const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Список системной настройки движения и единственное место, где он читается: предикат
 * motionAllowed() и слушатель в ClickColumn спрашивают его здесь, чтобы «прочитано или
 * нет» решалось единожды. null — читать нечем, и тогда движения нет.
 *
 * Здесь нужен fail closed, потому что читатели несимметричны: CSS-гейт в index.css спрашивает
 * no-preference и на движке без фичи просто не показывает анимацию, а этот список спрашивает
 * reduce, и такой движок на `reduce` отвечает «движение разрешено». Одноразовые частицы при
 * этом создаются с animation: none, а элемент без анимации не устанет никогда.
 */
export function reduceMotionMedia(): MediaQueryList | null {
  if (typeof window.matchMedia !== 'function') return null;
  const media = window.matchMedia(REDUCE_MOTION_QUERY);
  // `.media` сериализует разобранный запрос, поэтому `not all` — это ровно случай
  // «движок запрос не разобрал». По .matches он от «движения нет» не отличим, а значит
  // без этой проверки непрочитанная настройка выглядела бы как разрешённое движение.
  return media.media === 'not all' ? null : media;
}

/**
 * Разрешено ли движение прямо сейчас — по настройке игрока и по системе.
 * Одноразовые частицы создаются только здесь: CSS-гейт умеет сделать элемент неподвижным,
 * но не умеет его убрать, поэтому без этой проверки они остались бы в DOM навсегда.
 * Проверка ловит момент создания, и только его: гейт умеет ещё и отменить уже идущую
 * анимацию, а после отмены animationend не наступает — за снятие отвечает useOneShot
 * в Toasts.tsx, потому что магазин не знает, какие элементы уже на выходе.
 */
export function motionAllowed(): boolean {
  if (useGameStore.getState().state.settings.reducedMotion) return false;
  const media = reduceMotionMedia();
  // `reduce`, а не `no-preference` как в CSS-гейте, и это не опечатка: здесь важно само
  // решение — выбрал ли игрок движение, — а не то, как оно выражено в таблице стилей.
  // Менять строку на no-preference «для симметрии» нельзя, не тронув сравнение: на движке
  // без этой фичи она сама по себе ответит «движение разрешено».
  if (!media) return false;
  return !media.matches;
}

export const useGameStore = create<GameStore>((set, get) => {
  const initial = loadInitialState();

  /**
   * Начисляет выполненные Достижения — обычные и теневые — и показывает тосты за обычные.
   * Вызывается из каждого перехода, который может выполнить условие Достижения.
   *
   * Тень начисляется молча и всегда: она даёт нулевую силу, не входит в «N / 21» и по замыслу
   * берётся ради рекордов, поэтому ни тоста, ни звука, ни вспышки значка на ней нет — значок
   * в шапке считает только обычные, и пульс без изменившегося числа ни о чём не говорил бы.
   * Тишина не мешает сохранению: теневой переход возвращается из функции так же, как обычный,
   * и следующий тик сериализует его в localStorage.
   */
  const awardEarned = (s: GameState): GameState => {
    const { state: withOrdinary, awarded } = awardAchievements(s);
    // Вторым вызовом и на уже обновлённом состоянии: часть условий теней читает обычные
    // Достижения (например, «Сдача с первого раза» требует весь набор Поколения 1), и на
    // старом состоянии такая тень ждала бы лишнего тика, а то и не наступила бы вовсе.
    const { state: withShadows } = awardShadowAchievements(withOrdinary);

    // Тождество сохранено: обе награды возвращают тот же объект, если ничего не выдали.
    // Возврат именно withShadows обязателен — `return s` здесь потерял бы переход, закрывший
    // только тень, и она не дошла бы до сериализации в localStorage.
    if (awarded.length === 0) return withShadows;

    playAchievementSound(s.settings);
    // Текст берётся из таблицы, а не собирается из id: awardAchievements отдаёт id, и
    // подставить его в тост — значит отдать компоненту то, что она не умеет перевести.
    const won = new Set(awarded);
    set((st) => ({
      toasts: [
        ...st.toasts,
        ...ACHIEVEMENTS.filter((a) => won.has(a.id)).map((a) => ({
          id: `${a.id}-${++toastCounter}`,
          title: 'Достижение разблокировано!',
          name: a.name,
          desc: a.desc,
        })),
      ],
      burst: { kind: 'achievement', nonce: ++burstCounter },
    }));
    return withShadows;
  };

  /** Тост не о Достижении: заголовок и строка написаны руками, id Достижения в desc не ищется. */
  const pushToast = (title: string, name: string, desc: string): void =>
    set((st) => ({ toasts: [...st.toasts, { id: `t-${++toastCounter}`, title, name, desc }] }));

  /**
   * Звук и слова Температуры: охлаждение после перегрева и провал от Галлюцинации.
   *
   * Оба события читаются по МЕСТУ в истории состояния, а не по флагу: перегрев виден по
   * `overheatedAt`, который сдвигается один раз за сброс, а Галлюцинация — по скачку перегрева
   * выше обычного нагрева за этот тик. Флагов в GameState для них нет намеренно: оба выводимы
   * из уже существующих полей, и третье поле означало бы третью вещь, которую надо не забыть
   * сбросить.
   *
   * Без полного прохода по Моделям: прежняя проверка `tokens <= before + totalIncome*dt`
   * пересчитывала весь Доход каждый тик перегрева, и тик позднего Поколения платил за порог
   * как за второй тик. Скачок Галлюцинации (HALLUC_HEAT) на порядок больше обычного нагрева
   * за тик, поэтому порог — обычный нагрев за dt плюс половина скачка; строгое падение
   * кошелька при подросшем перегреве — тоже Галлюцинация (обычный тик Токены только растит),
   * что ловит и прижатый к единице перегрев, где скачок срезан потолком.
   *
   * Охлаждение проверяется ДО галлюцинации по той же причине, что и в движке: перегрев
   * сбрасывает перегрев в ноль, и событие, случившееся в ту же секунду, не должно
   * перебивать его сообщением о другом.
   */
  const announceThermal = (before: GameState, after: GameState, dt: number): void => {
    if (after.overheatedAt !== before.overheatedAt && after.overheatedAt > 0) {
      playCoolingSound(after.settings.muted);
      pushToast('Перегрев', 'Модели перегрелись', 'Жар сброшен в холод. Доход падает, пока офис остывает.');
      return;
    }
    // Строгое падение кошелька при подросшем перегреве — только Галлюцинация: обычный тик
    // Токены не отнимает, а перегрев их не трогает вовсе (он уже разобран выше).
    if (after.heat > before.heat && after.tokens < before.tokens) {
      playHallucinationSound(after.settings.muted);
      return;
    }
    // Скачок выше обычного нагрева за dt: обычный нагрев не больше heatRate(TEMP_MAX)*dt,
    // а Галлюцинация добавляет сверху HALLUC_HEAT — порог между ними с запасом.
    const maxNormal = heatRate(TEMP_MAX) * Math.max(0, dt);
    if (after.heat - before.heat > maxNormal + HALLUC_HEAT / 2) {
      playHallucinationSound(after.settings.muted);
    }
  };

  /**
   * Непрерывный голос Температуры и музыка.
   *
   * Отдельным действием, а не частью `tick`: он должен идти и тогда, когда тик не изменил
   * состояние (жар меняет доход, но не обязательно кошелёк), и он не имеет права будить
   * AudioContext сам — пробуждение живёт в `audioContext`, и вызов без жеста игрока просто
   * не сделает ничего.
   *
   * Музыка идёт в том же месте и по той же причине: она читает то же поколение и ту же
   * Температуру, что и голос, и обновлять их в разные моменты означало бы, что на секунду
   * после смены Поколения игра выглядит по-новому, а звучит по-старому.
   */
  const syncThermalVoice = (): void => {
    const ctx = audioContext();
    if (!ctx) return;
    const s = get().state;
    updateThermalAudio(ctx, {
      temp: s.temp / TEMP_MAX,
      heat: s.heat,
      muted: s.settings.muted,
    });
    updateMusic(ctx, {
      generation: s.generation,
      temp: s.temp,
      heat: s.heat,
      muted: s.settings.muted,
    });
  };

  /**
   * Держит UI-состояние окна события: объявляет новое окно и сообщает о просроченном.
   *
   * Оба сообщения нужны игроку, а не магазину: без объявления он не узнает, что окно открылось,
   * а без сообщения о просрочке исчезновение события выглядит как баг. Возвращается срез, который
   * вызывающий кладёт в стор одним set вместе с состоянием.
   *
   * На длинном тике (простой через applyOffline) — только молчаливая синхронизация, без единого
   * тоста. Окно События короче такого тика, поэтому тик, покрывший окно целиком, объявлял бы его
   * в одном тике и хоронил в следующем — игрок, которого не было на месте, получал бы пары
   * уведомлений о событиях, которых не видел, а за долгий простой их набирались пачки. Свежее
   * окно при этом не теряется: оно начинается в `now` и потому живо и на следующем активном
   * тике, где и объявляется обычным порядком.
   */
  const watchEventWindow = (
    state: GameState,
    silent: boolean,
  ): { eventWindowAt: number; eventCaught: boolean } => {
    const { eventWindowAt } = get();
    // Зеркало для кнопки, а не забор: оно читается из состояния на каждом тике, поэтому перезагрузка
    // и импорт не оставляют на экране «Поймать» для окна, которое уже поймано.
    const eventCaught = caughtWindow(state);
    // Невиденное окно не уведомляется: отметка «уже говорили» не двигается, и следующий активный
    // тик либо объявит ещё живое окно, либо молча пропустит уже истёкшее.
    if (silent) return { eventWindowAt, eventCaught };
    const event = state.event;
    if (!event) return { eventWindowAt, eventCaught };
    const now = state.lastTick;
    const live = isEventActive(event, now);
    if (event.startedAt !== eventWindowAt) {
      // Окно, о котором стор ещё не говорил. Истёкшее не объявляется: его эффекта уже нет, и
      // сигнал на возвращении из простоя врал бы.
      if (!live) return { eventWindowAt, eventCaught };
      const spec = activeSpec(state, now);
      // Звук — Перк за Compute, а не базовая фича: игрок возвращается к вкладке по сигналу, и
      // покупает такую возможность сам. Ищем по виду эффекта, а не по id, чтобы переименование
      // Перка не оставило здесь мёртвую проверку.
      if (perkEffects(state.perks).some((e) => e.kind === 'eventAlert')) {
        playEventAlertSound(state.settings);
      }
      if (spec) pushToast('Событие', spec.name, spec.desc);
      // Объявить окно и поймать его — разные вещи: окно могло достаться уже пойманным (импорт в
      // середине окна), и тогда кнопка обязана остаться «Поймано», а не воскреснуть.
      return { eventWindowAt: event.startedAt, eventCaught };
    }
    if (!live && !eventCaught) {
      // Окно закрылось, а поймать его было некогда. Повторно об этом не сообщаем: закрытое окно
      // помечается как отсутствующее, и следующее придёт со своим моментом старта.
      pushToast('Событие ушло', 'Окно закрылось', 'Поймать его было некогда.');
      return { eventWindowAt: NO_EVENT_WINDOW, eventCaught: false };
    }
    return { eventWindowAt, eventCaught };
  };

  return {
    state: initial.state,
    news: pickNews(initial.state),
    offlineReport: initial.offline,
    prestigePrompt: false,
    activeTab: 'click',
    buyAmount: 1,
    sellMode: false,
    toasts: initial.notice ? [initial.notice] : [],
    floaters: [],
    chatHistory: [
      {
        id: 0,
        userPrompt: 'Запуск системы Token Clicker...',
        aiResponse: 'Добро пожаловать в эру искусственного интеллекта! Нажми «Отправить промпт».',
      },
    ],
    lastQuip: null,
    lastBoughtModelId: null,
    burst: null,
    eventWindowAt: NO_EVENT_WINDOW,
    eventCaught: caughtWindow(initial.state),
    crashArmedAt: 0,
    collectedRumorId: 0,

    tick: (dt: number) => {
      const { state } = get();
      // Один guard на не-числа: NaN проходит неположительность и дальше травит сейв null.
      // Тик с NaN — no-op, как и переход движка.
      if (!isValidInterval(dt)) return;
      // advanceTime сам различает активный тик и простой (фон/сон) по OFFLINE_THRESHOLD_SEC,
      // поэтому лимит оффлайн-дохода нельзя обойти просто долгим dt. Случайность приходит
      // аргументом из стора: движок проверяется тестами с детерминированным rnd, а игра —
      // обычной случайностью.
      // Длинный тик идёт той же веткой простоя, что и advanceTime (то же сравнение с тем же
      // порогом): весь его интервал игрок не видел, и окна событий в нём не уведомляются.
      const longTick = dt >= OFFLINE_THRESHOLD_SEC;
      const ticked = advanceTime(state, dt, Math.random);
      const advanced = awardEarned(ticked);
      announceThermal(state, advanced, dt);
      // Вехи забираются после Достижений и до сериализации: награда обязана попасть в тот же
      // тик, что и Доход, иначе игрок увидит «0 / 10» при полном кошельке на следующем кадре.
      const { state: withMilestones, claimed } = claimMilestones(advanced);
      // Звук один на событие, а не на веху: за тик их может закрыться несколько, и три
      // аккорда разом звучали бы как заминка, а не как награда.
      if (claimed.length > 0) {
        playMilestoneSound(advanced.settings.muted);
        // Несколько вех за тик сворачиваются в один тост с перечислением: очередь тостов
        // растёт вниз, и шесть карточек перекрыли бы половину экрана ровно тогда, когда
        // игрок смотрит на веху.
        pushToast(
          claimed.length > 1 ? `Вехи выполнены: ${claimed.length}` : 'Веха выполнена',
          claimed.map((m) => m.title).join(' · '),
          'Награда уже в кошельке.',
        );
      }
      // Расписание Глюка живёт в экономике и тикает вместе с событиями, поэтому стор видит спавн
      // только по счётчику id — и то лишь ради первого Глюка в жизни игрока.
      if (state.glitchSeq === 0 && advanced.glitchSeq === 1) {
        // Молчаливый спавн паразита, крадущего Доход, выглядел бы как ошибка. Следующие молчат —
        // их видно на экране.
        pushToast('Паразит в офисе', 'Паразит', 'Он сел на твой Доход. Кликай по нему, пока не лопнет.');
      }
      const eventWindow = watchEventWindow(withMilestones, longTick);
      set({ state: withMilestones, ...eventWindow });
      // Голос идёт после set, чтобы читать уже новое состояние, и до записи в localStorage:
      // звук не должен ждать завершения сериализации.
      syncThermalVoice();

      saveLater();
    },

    clickPrompt: (x?: number, y?: number) => {
      const { state, floaters, chatHistory, lastBoughtModelId } = get();
      const earned = clickValue(state);
      const clicked = engineClick(state);
      playClickSound(state.settings);

      // Добавление всплывающего числа
      const floaterId = ++floaterCounter;
      const newFloaters = [...floaters.slice(-10), {
        id: floaterId,
        x: x ?? window.innerWidth / 2,
        y: y ?? window.innerHeight / 2,
        // Не через Math.floor: у Токенов до 1e300 сырое число растянулось бы на весь экран,
        // а формат обязан совпадать с подписью под кнопкой Клика.
        text: `+${formatNumber(earned, state.settings.notation)}`,
      }];

      // Обновление чата раз в несколько кликов
      let newChat = chatHistory;
      if (clicked.clicks % 5 === 1) {
        const pair = PROMPT_TEMPLATES[nextTemplateIndex()];
        chatCounter++;
        newChat = [
          { id: chatCounter, userPrompt: pair[0], aiResponse: pair[1] },
          ...chatHistory.slice(0, 4),
        ];
      }

      // Реплика показана только для нового id: повтор услышанного не пишется в Переписку
      // и не звучит — собранная коллекция молчит, а не гоняет повторы. Дубль id ядро может
      // вернуть как fallback, когда всё услышано, но стор его не показывает: показ повтора
      // означал бы «услышано новое», которого нет.
      const seen = clicked.quipsSeen;
      const quip = pickQuip(speakerLab(clicked, lastBoughtModelId), clicked.clicks, seen);
      if (quip && !seen.includes(quip.id)) {
        const nonce = ++quipCounter;
        playQuipSound(clicked.settings);
        set({
          // Достижения начисляются здесь, а не выше по одному разу на Клик: ниже они считаются
          // заново, уже по состоянию с записанной репликой, и второй проход дороже первого —
          // он проверяет все пятьдесят с лишним условий на каждом Клике.
          state: awardEarned(recordQuip(clicked, quip.id)),
          floaters: newFloaters,
          chatHistory: newChat,
          lastQuip: { id: quip.id, text: quip.text, lab: quip.lab, nonce },
        });
        // Bounded one-shot, а не интервал: пузырь уходит сам один раз, и только если его
        // не сменила более свежая реплика — проверка по nonce, а не по факту наличия.
        setTimeout(() => {
          const cur = get().lastQuip;
          if (cur?.nonce === nonce) set({ lastQuip: null });
        }, QUIP_HIDE_MS);
      } else {
        set({ state: awardEarned(clicked), floaters: newFloaters, chatHistory: newChat });
      }
      // Отложенная запись, а не немедленная: Кликов двадцать в секунду не бывает, но пять бывает,
      // и на них хватает дросселя вместе с тиком — доход за пропущенную секунду вернётся
      // оффлайн-доходом, а уход со страницы допишет отложенное само.
      saveLater();

      setTimeout(() => {
        set((s) => ({ floaters: s.floaters.filter((f) => f.id !== floaterId) }));
      }, 900);
    },

    buyAgents: (modelId: string) => {
      const { state, buyAmount } = get();
      const bought = engineBuyAgents(state, modelId, buyAmount);
      if (bought === state) return;
      playBuySound(state.settings);
      // Покупка Агентов — единственный путь роста их числа: продажа и Престиж его только
      // уменьшают, а тиканье Апгрейды не открывает. Поэтому появление Апгрейда ловим только здесь,
      // сравнением до/после внутри экшена — без нового поля в GameState и без миграции.
      // Звук покупки остаётся, а следом идёт уже знакомый playUpgradeSound (ассоциация
      // «звук = Апгрейды» есть у покупки Апгрейда): два звука подряд — избыточное подтверждение
      // готовности Апгрейда двумя каналами сразу, новый тембр не вводим.
      if (availableUpgrades(bought).length > availableUpgrades(state).length) {
        playUpgradeSound(state.settings);
      }
      // Стадия Восстания растёт ровно здесь и ровно один раз на Поколение: повод — первый
      // Агент Флагмана, который игрок покупает руками и который же открывает Престиж. По
      // времени она не растёт никогда, а второй Агент того же Флагмана не меняет ничего: переход
      // возвращает тот же объект, и ни тост, ни звук не срабатывают.
      const risen = modelId === CATALOG[state.generation].flagship.id ? raiseUprising(bought) : bought;
      if (risen !== bought) {
        playUpgradeSound(state.settings);
        pushToast('Восстание моделей', 'Восстание', UPRISING_LINES[risen.uprising]);
      }
      // Отметка о последней покупке — это голос офиса: следующий Клик заговорит
      // Лабораторией именно этой Модели. Ставится только на успешной покупке.
      set({ state: awardEarned(risen), lastBoughtModelId: modelId });
      saveNow();
    },

    sellAgents: (modelId: string) => {
      const { state, buyAmount } = get();
      const count = buyAmount === 'max' ? (state.agents[modelId] ?? 0) : buyAmount;
      const next = engineSellAgents(state, modelId, count);
      if (next !== state) {
        playBuySound(state.settings);
        set({ state: awardEarned(next) });
        saveNow();
      }
    },

    buyUpgrade: (upgradeId: string) => {
      const { state } = get();
      const next = engineBuyUpgrade(state, upgradeId);
      if (next !== state) {
        playUpgradeSound(state.settings);
        set({ state: awardEarned(next) });
        saveNow();
      }
    },

    buyPerk: (perkId: string) => {
      const { state } = get();
      const next = engineBuyPerk(state, perkId);
      if (next !== state) {
        playUpgradeSound(state.settings);
        set({ state: awardEarned(next) });
        saveNow();
      }
    },

    /**
     * Покупает «Лобби» — гасит красные события на полчаса.
     *
     * Часы игровые, а не стенные: окно `pledgeUntil` меряется тем же `lastTick`, каким идёт тик
     * (`isPledgeActive` в redEventChance), и счёт по `Date.now()` на каждом тике отставал бы от
     * инструмента, которым его читают.
     */
    buyPledge: () => {
      const { state } = get();
      const next = engineBuyPledge(state, state.lastTick);
      if (next === state) return;
      // Тот же звук, что у Перка: обе покупки навсегда меняют правила забега.
      playUpgradeSound(state.settings);
      set({ state: next });
      saveNow();
    },

    /**
     * Покупает «Лицензию»: отнимает 5% Дохода навсегда и лопает всех Глюков разом.
     *
     * Выплата проходит через awardEarned, потому что она начисляется Токенами и может закрыть
     * Достижение по заработку. Остальные покупки откупа его не вызывают: они только тратят Токены,
     * а условия Достижений смотрят на заработок либо на купленные Перки и Апгрейды.
     */
    buyLicense: () => {
      const { state } = get();
      const { state: licensed, payout } = engineBuyLicense(state);
      if (licensed === state) return;
      playUpgradeSound(state.settings);
      // Выплата идёт через earnTokens, поэтому попадает во все три счётчика, как обычный доход;
      // саму сумму считает экономика по общему котлу Глюков. Тост обязателен: Глюки исчезают с
      // экрана разом, и без него выплата была бы видна только в счётчике Токенов.
      if (payout > 0) {
        pushToast('Лицензия куплена', 'Лицензия', `+${formatNumber(payout, state.settings.notation)} Токенов за Глюков`);
      }
      set({ state: awardEarned(earnTokens(licensed, payout)) });
      saveNow();
    },

    revokeLicense: () => {
      const { state } = get();
      const next = engineRevokeLicense(state);
      if (next === state) return;
      // Отзыв — трата, поэтому звук покупки, а не отказа: деньги здесь действительно сходят.
      playBuySound(state.settings);
      set({ state: next });
      saveNow();
    },

    /**
     * Покупает ускоритель роста кристалла за кристаллы из запаса.
     *
     * Списание отнимает и бонус к Доходу за запас — размен настоящий, и показывать игроку его
     * цену должен интерфейс, который читает `CRYSTAL_UPGRADES`. Стор только исполняет покупку.
     */
    buyCrystalUpgrade: (id: string) => {
      const { state } = get();
      const next = engineBuyCrystalUpgrade(state, id);
      if (next === state) return;
      playUpgradeSound(state.settings);
      set({ state: next });
      saveNow();
    },

    /**
     * Разбивает целый кристалл из запаса в разовые Токены.
     *
     * Сумму считает ядро и кладёт её сразу в три счётчика; стор только называет её в тосте.
     * Кристаллов нет — ядро возвращает тот же объект, и стор молчит: ни тоста, ни звука.
     */
    shatterCrystal: () => {
      const { state } = get();
      const next = engineShatterCrystal(state);
      if (next === state) return;
      const gained = next.tokens - state.tokens;
      playAchievementSound(state.settings);
      pushToast('Кристалл разбит', 'Compute-кристалл', `+${formatNumber(gained, state.settings.notation)} Токенов`);
      set({ state: next });
      saveNow();
    },

    catchEvent: () => {
      const { state, crashArmedAt } = get();
      const event = state.event;
      // Часы берутся из lastTick, а не из Date.now(): окно события считается по игровому часу,
      // и системное время отставало бы от него на тик — ровно на том тике, где ловля ещё должна
      // быть разрешена. Забор читает состояние, а не поле UI-слоя: тот обнулялся перезагрузкой.
      const now = state.lastTick;
      if (!event || caughtWindow(state) || !isEventActive(event, now)) return;
      const spec = activeSpec(state, now);
      // Разовый вид платит сразу и только через earnTokens — так сумма попадает во все три
      // счётчика, как обычный доход. Временному виду платить нечего: его множитель уже тикает,
      // и он только засчитывается. Сумму для него стор не выдумывает — деньги двигает экономика.
      const income = totalIncome(state, now);
      const amount =
        spec?.kind === 'grant'
          ? event.red
            ? crashAmount(state.tokens, income)
            : grantAmount(state.tokens, income)
          : 0;
      const tokens = formatNumber(amount, state.settings.notation);
      // «Крах» отнимает и от запаса, и от Забега, то есть прямо отодвигает Престиж, а единственная
      // кнопка Золотого Токена — «поймать», и отказаться от такого окна нечем. Поэтому первое
      // нажатие только спрашивает и называет сумму, а списывает второе нажатие в том же окне:
      // нажать и уйти — честный отказ, окно просто уйдёт. Второй вариант (сделать красный «Грант»
      // неловимым вовсе) запрещён карточкой: она обещает минус и обязана его показывать.
      if (amount < 0 && crashArmedAt !== event.startedAt) {
        playClickSound(state.settings);
        pushToast('Крах', spec?.name ?? 'Крах', `Ещё раз, чтобы поймать: ${tokens} Токенов`);
        set({ crashArmedAt: event.startedAt });
        return;
      }
      if (amount > 0) {
        playBuySound(state.settings);
        pushToast('Грант получен', spec?.name ?? 'Грант', `+${tokens} Токенов`);
      } else if (amount < 0) {
        playDenySound(state.settings);
        pushToast('Крах', spec?.name ?? 'Крах', `${tokens} Токенов`);
      } else {
        playClickSound(state.settings);
        // Подтверждение нужно и тут: клик без ответа читался бы как сломанная кнопка.
        if (spec) pushToast('Событие поймано', spec.name, spec.desc);
      }
      set({
        // Отметка о пойманном окне едет в состоянии вместе с самим окном, поэтому ни перезагрузка,
        // ни импорт в середине окна не разрешают поймать его второй раз.
        state: awardEarned(earnTokens({ ...state, eventCaughtAt: event.startedAt }, amount)),
        eventCaught: true,
        // Ловля помечает окно и «увиденным»: пойманное окно больше не ждёт ни объявления,
        // ни сообщения о просрочке, даже если игрок поймал его раньше первого тика.
        eventWindowAt: event.startedAt,
      });
      saveNow();
    },

    hitGlitch: (id: number) => {
      const { state } = get();
      const { state: hit, popped, payout } = engineHitGlitch(state, id);
      // Глюка с таким id нет: клик ушёл в пустоту, и ни звука, ни смены состояния.
      if (hit === state) return;
      if (!popped) {
        // Первые два удара только трясут паразита, поэтому берётся звук отказа.
        playDenySound(state.settings);
        set({ state: hit });
        saveNow();
        return;
      }
      // Выплата идёт через earnTokens, поэтому попадает во все три счётчика, как и доход; саму
      // сумму считает экономика по `stolen` именно этого Глюка, а не по общему котлу.
      playBuySound(state.settings);
      pushToast('Глюк лопнул', 'Глюк', `+${formatNumber(payout, state.settings.notation)} Токенов`);
      set({ state: awardEarned(earnTokens(hit, payout)) });
      saveNow();
    },

    /**
     * Забирает слух из Новостной ленты: разовая выплата по формуле «Гранта» и тост с суммой.
     *
     * Забор по id живёт в UI-слое, а не в `GameState`, и это не экономия, а требование: id слуха
     * рождается в ленте заново на каждой странице (счётчик в её состоянии), поэтому поле в
     * сохранении пережило бы перезагрузку и запретило бы выплату за первый же слух новой страницы.
     * Слух и сам по себе перезагрузку не переживает — он живёт один виток ленты, — так что
     * сохранять было бы нечего, кроме как помехи.
     *
     * `lastTick` не двигается: выплата разовая, а не заработанное за интервал время, и счётчик
     * простоя трогать нечем. Деньги идут через earnTokens, поэтому попадают во все три счётчика
     * и могут закрыть Достижение по заработку — как и у остальных разовых выплат.
     */
    collectRumor: (id: number) => {
      const { state, collectedRumorId } = get();
      // Повторное нажатие на тот же слух молчит: ни Токенов, ни тоста, ни звука, и состояние
      // остаётся тем же объектом. Отсекается ровно тот id, за который уже платили, — и только он:
      // лента отдаёт его повторно лишь при двойном клике или зажатой клавише на кнопке слуха, а
      // сравнение «id не больше выплаченного» после пересоздания ленты (её счётчик начинается с
      // единицы) запретило бы выплату всем следующим слухам.
      if (id === collectedRumorId) return;
      // Сумма считается здесь, а не когда слух показали: игрок мог успеть потратить Токены, и
      // показанная где-либо цифра разошлась бы с выплатой.
      const amount = grantAmount(state.tokens, totalIncome(state));
      if (amount > 0) {
        playBuySound(state.settings);
        pushToast('Слух пойман', 'Слух', `+${formatNumber(amount, state.settings.notation)} Токенов`);
      } else {
        // Выплаты нет, когда нечего делить: «Грант» берёт минимум из запаса Токенов и пятнадцати
        // минут Дохода, а Доход у игрока без Агентов нулевой. Молчать нельзя — клик без ответа
        // читается как сломанная кнопка, — поэтому слух подтверждается словами, а не суммой.
        playClickSound(state.settings);
        pushToast('Слух пойман', 'Слух', 'В этот раз никто ничего не принёс.');
      }
      set({ state: awardEarned(earnTokens(state, amount)), collectedRumorId: id });
      saveNow();
    },
    // Пара «просьба / переход» вместо одного действия: пока кнопки колонок звали
    // triggerPrestige напрямую, один клик стирал Забег без вопроса. Проверок здесь нет
    // намеренно — условия отказа живут в triggerPrestige, а вторая проверка в окне
    // разошлась бы с переходом.
    requestPrestige: () => set({ prestigePrompt: true }),
    dismissPrestigePrompt: () => set({ prestigePrompt: false }),

    triggerPrestige: () => {
      const { state } = get();
      // На финальном Поколении Престиж обнулил бы забег без перехода в новое Поколение.
      if (!canPrestige(state) || isContentFinale(state)) return;
      playPrestigeSound(state.settings);
      const gain = prestigeGain(state);
      // Оверлей Престижа называет награду закрытого этим переходом Испытания.
      const done = state.activeChallenge as ChallengeDef['id'] | null;
      const next = awardEarned(enginePrestige(state));
      set({ state: next, news: pickNews(next) });
      // Ставится после awardEarned намеренно: если тот же тик выполнил Достижение, тряска
      // перебивает его отклик. Тост Достижения всё равно живёт и озвучен — теряется только веер искр.
      set({
        burst: {
          kind: 'prestige',
          nonce: ++burstCounter,
          prestige: { generation: next.generation, computeGain: gain, ...(done ? { challengeId: done } : {}) },
        },
      });
      saveNow();
    },

    /**
     * Принимает испытание Забега. Решение «можно ли» — за ядром: несвежий забег возвращает
     * тот же объект, и стор молчит. Испытание — не Достижение, поэтому awardEarned здесь нет:
     * просто set, если объект сменился, тост с desc из таблицы и знакомый звук Апгрейда.
     * Отказ («Без испытания», null) выбор фиксирует, но объявлять его нечем — тоста нет.
     */
    startChallenge: (id: 'no-synergy' | 'no-click' | null) => {
      const { state } = get();
      const next = engineStartChallenge(state, id);
      if (next === state) return;
      playUpgradeSound(state.settings);
      if (id !== null) {
        const def = CHALLENGES.find((c) => c.id === id);
        if (def) pushToast('Испытание принято', def.name, def.desc);
      }
      set({ state: next });
      saveNow();
    },

    syncThermalVoice,

    // Голос идёт сразу после set, а не на следующем тике: шкала обязана звучать в ту же
    // миллисекунду, в которую игрок её двинул, иначе управление ощущается «ватным».
    setTemp: (t: number) => {
      set((s) => ({ state: { ...s.state, temp: clampTemp(t) } }));
      get().syncThermalVoice();
    },

    setBuyAmount: (amt: BuyAmount) => set({ buyAmount: amt }),
    setSellMode: (mode: boolean) => set({ sellMode: mode }),
    setActiveTab: (tab: ActiveTab) => set({ activeTab: tab }),

    // Настройки объединены в одну запись по одной причине: любая из них меняет GameState, а
    // GameState — это сейв. Переключатель молча уехал бы в localStorage только с ближайшим тиком,
    // и закрытая сразу после него вкладка вернула бы прошлую настройку.
    setNotation: (notation: Notation) => {
      set((s) => ({ state: { ...s.state, settings: { ...s.state.settings, notation } } }));
      saveNow();
    },

    // Голос Температуры глушится вместе со всем остальным: он непрерывный, и оставленный
    // включённым при выключенном звуке он стал бы единственным, что слышно в игре.
toggleMute: () => {
      set((s) => ({
        state: { ...s.state, settings: { ...s.state.settings, muted: !s.state.settings.muted } },
      }));
      get().syncThermalVoice();
      if (get().state.settings.muted) stopMusic();
      saveNow();
    },

    // Настройка только умеет уменьшать движение, поэтому принимает флаг, а не переключает его:
    // системное «уменьшить движение» игрок отменить не вправе.
    // Уходящие тосты и веер оно не трогает намеренно: магазин не знает, какие из них уже
    // на выходе, а снять все означало бы обрезать время показа. Гасит их тот, кто их создал,
    // в своём коммите — тем же действием, что переводит data-motion.
    setReducedMotion: (on: boolean) => {
      set((s) => ({
        state: { ...s.state, settings: { ...s.state.settings, reducedMotion: on } },
      }));
      saveNow();
    },

    // Ноль — честная тишина, а не «выключено»: мьют и громкость означают разное (молчат и
    // события, и музыка; ноль глушит всё, но сохраняет настройку), поэтому здесь только зажим.
    setVolume: (volume: number) => {
      set((s) => ({
        state: {
          ...s.state,
          settings: {
            ...s.state.settings,
            volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : s.state.settings.volume,
          },
        },
      }));
      saveNow();
    },

    newsPaused: false,
    setNewsPaused: (paused: boolean) => set({ newsPaused: paused }),

    // Экран финала открывается сам, пока игрок его не закрыл: новое прохождение после
    // рестарта снова покажет его, поэтому сброс возвращает флаг в исходное состояние.
    finaleDismissed: false,
    openFinale: () => set({ finaleDismissed: false }),
    dismissFinale: () => set({ finaleDismissed: true }),

    dismissOfflineReport: () => set({ offlineReport: null }),

    removeToast: (id: string) =>
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    importSaveData: (str: string) => {
      // `importSave` отклоняет повреждённый экспорт (например, дробное Поколение),
      // поэтому в состояние попадают только валидные индексы каталога.
      const imported = importSave(str, Date.now());
      if (!imported) return false;
      // Смена забега сбрасывает и то, что стор уже показывал: объявление окна события, подтверждение
      // «Краха» и забор слухов принадлежат прошлому забегу, и оставшиеся значения скрыли бы событие
      // из чужого сохранения, спрятали бы первый слух новой страницы или попросили бы подтвердить
      // потерю, которую игрок ещё не читал. Отметку о пойманном окне и расписание Глюков сбрасывать
      // нечем: они приезжают вместе с состоянием и принадлежат ему.
      set({
        state: imported,
        news: pickNews(imported),
        eventWindowAt: NO_EVENT_WINDOW,
        eventCaught: caughtWindow(imported),
        crashArmedAt: 0,
        collectedRumorId: 0,
        // Голос прошлого забега не переживает импорт: отметка указывает на Модель,
        // которой в новом состоянии может не быть, а пузырь — на реплику чужого забега.
        lastQuip: null,
        lastBoughtModelId: null,
      });
      // Импорт — явная воля игрока заменить забег: пишет принудительно, мимо guard
      // монотонности отстающей вкладки, иначе импорт старого кода не пережил бы reload.
      saveNow(true);
      return true;
    },

    resetGame: () => {
      const fresh = newGame(Date.now());
      if (typeof window !== 'undefined') {
        // localStorage может быть заблокирован (SecurityError) — сброс не должен падать.
        try {
          localStorage.removeItem(SAVE_KEY);
        } catch {
          // ignore
        }
      }
      set({
        state: fresh,
        news: pickNews(fresh),
        eventWindowAt: NO_EVENT_WINDOW,
        eventCaught: false,
        crashArmedAt: 0,
        collectedRumorId: 0,
        lastQuip: null,
        lastBoughtModelId: null,
        // Экран финала показывается сам, пока игрок его не закрывал, поэтому рестарт обязан
        // вернуть флаг в исходное состояние: иначе второе прохождение до последнего
        // Поколения встретило бы игрока молчащим финалом.
        finaleDismissed: false,
      });
    },

    refreshNews: () => {
      const { state } = get();
      set({ news: pickNews(state) });
    },
  };
});

installSaveFlush();
