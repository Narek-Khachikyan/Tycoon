import { create } from 'zustand';
import { CATALOG } from '../economy/catalog';
import {
  advanceTime,
  applyOffline,
  buyAgents as engineBuyAgents,
  buyPerk as engineBuyPerk,
  buyUpgrade as engineBuyUpgrade,
  canPrestige,
  claimMilestoneRewards,
  click as engineClick,
  clickValue,
  earnTokens,
  isContentFinale,
  OFFLINE_THRESHOLD_SEC,
  prestige as enginePrestige,
  prestigeGain,
  sellAgents as engineSellAgents,
  totalIncome,
} from '../economy/engine';
import {
  ACHIEVEMENTS,
  awardAchievements,
  awardShadowAchievements,
} from '../economy/achievements';
import { activeSpec, grantAmount, isEventActive } from '../economy/events';
import { LAST_GENERATION } from '../economy/catalog';
import { formatNumber } from '../economy/format';
import { buyCrystalUpgrade as engineBuyCrystalUpgrade } from '../economy/crystal';
import {
  buyLicense as engineBuyLicense,
  buyPledge as engineBuyPledge,
  crashAmount,
  hitGlitch as engineHitGlitch,
  revokeLicense as engineRevokeLicense,
  uprisingStage,
} from '../economy/glitches';
import { pickNews } from '../economy/news';
import { clampTemp, TEMP_MAX } from '../economy/thermal';
import { perkEffects } from '../economy/perks';
import { availableUpgrades } from '../economy/upgrades';
import { importSave, migrate, SAVE_KEY, serialize } from '../economy/save';
import { newGame, type GameState, type Notation } from '../economy/state';
import {
  playAchievementSound,
  playBuySound,
  playClickSound,
  playDenySound,
  playEventAlertSound,
  playPrestigeSound,
  playUpgradeSound,
  audioContext,
} from '../audio/sound';
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
  /** Данные для оверлея Престижа: новое Поколение и полученный Compute. Только UI-слой,
   *  в GameState не попадает и в сейв не пишется. */
  prestige?: { generation: number; computeGain: number };
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

const PROMPT_TEMPLATES = [
  ['Привет! Напиши код на React', 'Конечно! Вот компонент на 400 строк с 15 хуками.'],
  ['Отрефактори ядро Линукса', 'Готово! Заменил все указатели на умные смайлики.'],
  ['Напиши стих про видеокарты', 'Шуршат кулеры в ночи, греется кристалл...\nЯ для датасета терабайт собрал.'],
  ['Сделай приложение за 5 секунд', 'Вайб-кодинг активирован! Приложение вышло в прод.'],
  ['Объясни квантовую гравитацию', 'Представьте струны, но они вибрируют как басовый дроп.'],
  ['Сколько будет 2 + 2?', 'После 40 секунд размышлений: 4. Степень уверенности 99.98%.'],
  ['Придумай новый мем про ИИ', '«Когда запустил локальную модель на ноутбуке и он улетел в стратосферу».'],
  ['Как достичь AGI?', 'Нужно ещё больше чипов, кофе и токенов!'],
];

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
  /** Ловит живое событие кликом по Золотому Токену: разовый вид платит, временный засчитывается. */
  catchEvent: () => void;
  /** Удар по Глюку; на третьем он лопается и выплата идёт через earnTokens. */
  hitGlitch: (id: number) => void;
  /** Забирает разовую выплату слуха из Новостной ленты: сумма считается в момент нажатия. */
  collectRumor: (id: number) => void;
  requestPrestige: () => void;
  dismissPrestigePrompt: () => void;
  triggerPrestige: () => void;

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
  /** Пауза Новостной ленты: останавливает и движение строки, и смену новости. Живёт в UI-слое
   *  и не сохраняется — персистентность означала бы новое поле в `GameState.settings` и правку
   *  контракта сохранения ради одного переключателя. */
  newsPaused: boolean;
  setNewsPaused: (paused: boolean) => void;
  dismissOfflineReport: () => void;
  removeToast: (id: string) => void;
  importSaveData: (str: string) => boolean;
  resetGame: () => void;
  refreshNews: () => void;
}

function loadInitialState(): { state: GameState; offline: OfflineReport | null } {
  const now = Date.now();
  let raw: unknown = null;
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(SAVE_KEY);
      if (saved) raw = JSON.parse(saved);
    } catch {
      // ignore
    }
  }

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
    };
  }

  return { state: base, offline: null };
}

let floaterCounter = 0;
let chatCounter = 0;
let toastCounter = 0;
let burstCounter = 0;

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

    playAchievementSound(s.settings.muted);
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
   * `overheatedAt`, который сдвигается один раз за сброс, а Галлюцинация — по тому, что
   * кошелёк и перегрев выросли, а счётчик выплат не изменился. Флагов в GameState для них
   * нет намеренно: оба выводимы из уже существующих полей, и третье поле означало бы третью
   * вещь, которую надо не забыть сбросить.
   *
   * Охлаждение проверяется ДО галлюцинации по той же причине, что и в движке: перегрев
   * сбрасывает перегрев в ноль, и событие, случившееся в ту же секунду, не должно
   * перебивать его сообщением о другом.
   */
  const announceThermal = (before: GameState, after: GameState): void => {
    if (after.overheatedAt !== before.overheatedAt && after.overheatedAt > 0) {
      playCoolingSound(after.settings.muted);
      pushToast('Перегрев', 'Модели перегрелись', 'Жар сброшен в холод. Доход падает, пока офис остывает.');
      return;
    }
    // Галлюцинация: перегрев подрос, а кошелёк — нет. При жаре сбрасывается и кошелёк, и
    // перегрев разом, и этот случай уже разобран выше.
    if (after.heat > before.heat && after.tokens <= before.tokens + totalIncome(after) * 0.05) {
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
   */
  const watchEventWindow = (state: GameState): { eventWindowAt: number; eventCaught: boolean } => {
    const { eventWindowAt } = get();
    // Зеркало для кнопки, а не забор: оно читается из состояния на каждом тике, поэтому перезагрузка
    // и импорт не оставляют на экране «Поймать» для окна, которое уже поймано.
    const eventCaught = caughtWindow(state);
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
        playEventAlertSound(state.settings.muted);
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
    toasts: [],
    floaters: [],
    chatHistory: [
      {
        id: 0,
        userPrompt: 'Запуск системы Token Clicker...',
        aiResponse: 'Добро пожаловать в эру искусственного интеллекта! Нажми «Отправить промпт».',
      },
    ],
    burst: null,
    eventWindowAt: NO_EVENT_WINDOW,
    eventCaught: caughtWindow(initial.state),
    crashArmedAt: 0,
    collectedRumorId: 0,

    tick: (dt: number) => {
      const { state } = get();
      if (dt <= 0) return;
      // advanceTime сам различает активный тик и простой (фон/сон) по OFFLINE_THRESHOLD_SEC,
      // поэтому лимит оффлайн-дохода нельзя обойти просто долгим dt. Случайность приходит
      // аргументом из стора: движок проверяется тестами с детерминированным rnd, а игра —
      // обычной случайностью.
      const ticked = advanceTime(state, dt, Math.random);
      const advanced = awardEarned(ticked);
      announceThermal(state, advanced);
      // Вехи забираются после Достижений и до сериализации: награда обязана попасть в тот же
      // тик, что и Доход, иначе игрок увидит «0 / 10» при полном кошельке на следующем кадре.
      const { state: withMilestones, claimed } = claimMilestoneRewards(advanced);
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
      const eventWindow = watchEventWindow(withMilestones);
      set({ state: withMilestones, ...eventWindow });
      // Голос идёт после set, чтобы читать уже новое состояние, и до записи в localStorage:
      // звук не должен ждать завершения сериализации.
      syncThermalVoice();

      // Сохранение в localStorage
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(SAVE_KEY, serialize(withMilestones));
        } catch {
          // ignore
        }
      }
    },

    clickPrompt: (x?: number, y?: number) => {
      const { state, floaters, chatHistory } = get();
      const earned = clickValue(state);
      const clicked = engineClick(state);
      playClickSound(state.settings.muted);

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

      const awarded = awardEarned(clicked);
      set({ state: awarded, floaters: newFloaters, chatHistory: newChat });

      setTimeout(() => {
        set((s) => ({ floaters: s.floaters.filter((f) => f.id !== floaterId) }));
      }, 900);
    },

    buyAgents: (modelId: string) => {
      const { state, buyAmount } = get();
      const bought = engineBuyAgents(state, modelId, buyAmount);
      if (bought === state) return;
      playBuySound(state.settings.muted);
      // Покупка Агентов — единственный путь роста их числа: продажа и Престиж его только
      // уменьшают, а тиканье Апгрейды не открывает. Поэтому появление Апгрейда ловим только здесь,
      // сравнением до/после внутри экшена — без нового поля в GameState и без миграции.
      // Звук покупки остаётся, а следом идёт уже знакомый playUpgradeSound (ассоциация
      // «звук = Апгрейды» есть у покупки Апгрейда): два звука подряд — избыточное подтверждение
      // готовности Апгрейда двумя каналами сразу, новый тембр не вводим.
      if (availableUpgrades(bought).length > availableUpgrades(state).length) {
        playUpgradeSound(state.settings.muted);
      }
      // Стадия Восстания растёт ровно здесь и ровно один раз на Поколение: повод — первый
      // Агент Флагмана, который игрок покупает руками и который же открывает Престиж. По
      // времени она не растёт никогда, а второй Агент того же Флагмана не меняет ничего: переход
      // возвращает тот же объект, и ни тост, ни звук не срабатывают.
      const risen = modelId === CATALOG[state.generation].flagship.id ? raiseUprising(bought) : bought;
      if (risen !== bought) {
        playUpgradeSound(state.settings.muted);
        pushToast('Восстание моделей', 'Восстание', UPRISING_LINES[risen.uprising]);
      }
      set({ state: awardEarned(risen) });
    },

    sellAgents: (modelId: string) => {
      const { state, buyAmount } = get();
      const count = buyAmount === 'max' ? (state.agents[modelId] ?? 0) : buyAmount;
      const next = engineSellAgents(state, modelId, count);
      if (next !== state) {
        playBuySound(state.settings.muted);
        set({ state: awardEarned(next) });
      }
    },

    buyUpgrade: (upgradeId: string) => {
      const { state } = get();
      const next = engineBuyUpgrade(state, upgradeId);
      if (next !== state) {
        playUpgradeSound(state.settings.muted);
        set({ state: awardEarned(next) });
      }
    },

    buyPerk: (perkId: string) => {
      const { state } = get();
      const next = engineBuyPerk(state, perkId);
      if (next !== state) {
        playUpgradeSound(state.settings.muted);
        set({ state: awardEarned(next) });
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
      playUpgradeSound(state.settings.muted);
      set({ state: next });
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
      playUpgradeSound(state.settings.muted);
      // Выплата идёт через earnTokens, поэтому попадает во все три счётчика, как обычный доход;
      // саму сумму считает экономика по общему котлу Глюков. Тост обязателен: Глюки исчезают с
      // экрана разом, и без него выплата была бы видна только в счётчике Токенов.
      if (payout > 0) {
        pushToast('Лицензия куплена', 'Лицензия', `+${formatNumber(payout, state.settings.notation)} Токенов за Глюков`);
      }
      set({ state: awardEarned(earnTokens(licensed, payout)) });
    },

    revokeLicense: () => {
      const { state } = get();
      const next = engineRevokeLicense(state);
      if (next === state) return;
      // Отзыв — трата, поэтому звук покупки, а не отказа: деньги здесь действительно сходят.
      playBuySound(state.settings.muted);
      set({ state: next });
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
      playUpgradeSound(state.settings.muted);
      set({ state: next });
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
        playClickSound(state.settings.muted);
        pushToast('Крах', spec?.name ?? 'Крах', `Ещё раз, чтобы поймать: ${tokens} Токенов`);
        set({ crashArmedAt: event.startedAt });
        return;
      }
      if (amount > 0) {
        playBuySound(state.settings.muted);
        pushToast('Грант получен', spec?.name ?? 'Грант', `+${tokens} Токенов`);
      } else if (amount < 0) {
        playDenySound(state.settings.muted);
        pushToast('Крах', spec?.name ?? 'Крах', `${tokens} Токенов`);
      } else {
        playClickSound(state.settings.muted);
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
    },

    hitGlitch: (id: number) => {
      const { state } = get();
      const { state: hit, popped, payout } = engineHitGlitch(state, id);
      // Глюка с таким id нет: клик ушёл в пустоту, и ни звука, ни смены состояния.
      if (hit === state) return;
      if (!popped) {
        // Первые два удара только трясут паразита, поэтому берётся звук отказа.
        playDenySound(state.settings.muted);
        set({ state: hit });
        return;
      }
      // Выплата идёт через earnTokens, поэтому попадает во все три счётчика, как и доход; саму
      // сумму считает экономика по `stolen` именно этого Глюка, а не по общему котлу.
      playBuySound(state.settings.muted);
      pushToast('Глюк лопнул', 'Глюк', `+${formatNumber(payout, state.settings.notation)} Токенов`);
      set({ state: awardEarned(earnTokens(hit, payout)) });
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
        playBuySound(state.settings.muted);
        pushToast('Слух пойман', 'Слух', `+${formatNumber(amount, state.settings.notation)} Токенов`);
      } else {
        // Выплаты нет, когда нечего делить: «Грант» берёт минимум из запаса Токенов и пятнадцати
        // минут Дохода, а Доход у игрока без Агентов нулевой. Молчать нельзя — клик без ответа
        // читается как сломанная кнопка, — поэтому слух подтверждается словами, а не суммой.
        playClickSound(state.settings.muted);
        pushToast('Слух пойман', 'Слух', 'В этот раз никто ничего не принёс.');
      }
      set({ state: awardEarned(earnTokens(state, amount)), collectedRumorId: id });
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
      playPrestigeSound(state.settings.muted);
      const gain = prestigeGain(state);
      const next = awardEarned(enginePrestige(state, Date.now()));
      set({ state: next, news: pickNews(next) });
      // Ставится после awardEarned намеренно: если тот же тик выполнил Достижение, тряска
      // перебивает его отклик. Тост Достижения всё равно живёт и озвучен — теряется только веер искр.
      set({
        burst: {
          kind: 'prestige',
          nonce: ++burstCounter,
          prestige: { generation: Math.min(state.generation + 1, LAST_GENERATION), computeGain: gain },
        },
      });
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

    setNotation: (notation: Notation) =>
      set((s) => ({ state: { ...s.state, settings: { ...s.state.settings, notation } } })),

    // Голос Температуры глушится вместе со всем остальным: он непрерывный, и оставленный
    // включённым при выключенном звуке он стал бы единственным, что слышно в игре.
    toggleMute: () => {
      set((s) => ({
        state: { ...s.state, settings: { ...s.state.settings, muted: !s.state.settings.muted } },
      }));
      get().syncThermalVoice();
      // Музыка снимается явно: `updateMusic` при `muted` только глушит мастер и держит
      // таймер, а без `stopMusic` он продолжал бы назначать доли в тишину.
      if (get().state.settings.muted) stopMusic();
    },

    // Настройка только умеет уменьшать движение, поэтому принимает флаг, а не переключает его:
    // системное «уменьшить движение» игрок отменить не вправе.
    // Уходящие тосты и веер оно не трогает намеренно: магазин не знает, какие из них уже
    // на выходе, а снять все означало бы обрезать время показа. Гасит их тот, кто их создал,
    // в своём коммите — тем же действием, что переводит data-motion.
    setReducedMotion: (on: boolean) =>
      set((s) => ({
        state: { ...s.state, settings: { ...s.state.settings, reducedMotion: on } },
      })),

    newsPaused: false,
    setNewsPaused: (paused: boolean) => set({ newsPaused: paused }),

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
      });
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
      });
    },

    refreshNews: () => {
      const { state } = get();
      set({ news: pickNews(state) });
    },
  };
});
