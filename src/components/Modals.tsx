import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { ACHIEVEMENTS, nonShadowCount, shadowEarned } from '../economy/achievements';
import { GLOSSARY } from '../data/glossary';
import { ThermalSection } from './ThermalSection';
import { PERKS } from '../economy/perks';
import { exportSave } from '../economy/save';
import { formatCount, formatDuration, formatNumber } from '../economy/format';
import { CATALOG } from '../economy/catalog';
import {
  computeShortfall,
  discountMult,
  isContentFinale,
  labIncomeShare,
  maxAffordable,
  offlineCapHours,
  prestigeGain,
  prestigePreview,
} from '../economy/engine';
import { availableUpgrades } from '../economy/upgrades';
import { SHADOW_ACHIEVEMENTS } from '../economy/shadow';
import { LABS, LAB_IDS } from '../data/labs';
import { Icon } from './Icon';
import { MascotSprite } from './MascotSprite';
import { Num } from './Num';
import { useDialogFocus } from './useDialogFocus';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Текст, который обязан звучать, но не обязан занимать место: клип по пикселю и
 * отрицательные поля уводят подпись из потока, не выключая её для скринридера.
 */
const SR_ONLY: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * Карточка Достижения. Обычная запись и тень отличаются только видом, поэтому рисуются
 * здесь, а не двумя списками.
 *
 * Заработанное и недостигнутое обязаны различаться за долю секунды, и различаться не
 * только цветом: заливка зелёным и золотом — это два оттенка серого для части игроков и
 * для всех на выцветшем экране. Поэтому состояние несёт ещё и форма: у заработанного
 * сплошная рамка в цвет награды и печать, у недостигнутого — пунктирная рамка, приглушённая
 * подложка и замок. Три признака вместо одного, и ни один не спрятан.
 *
 * Название и описание недостигнутого НЕ выключаются: игрок идёт к Достижению, глядя на это
 * окно, и выключенный текст убрал бы ровно ту подсказку, ради которой окно открыто. От
 * заработанного его отделяет форма рамки и печать, а не нечитаемость.
 */
const AchievementCard: React.FC<{
  name: string;
  desc: string;
  unlocked: boolean;
  /** Тень не входит в счёт обычных и не даёт силы, поэтому вид у неё другой: у тени
   *  золотой цвет, пунктир остаётся за недостигнутым, а рамка заработанной тени —
   *  сплошная золотая, как у обычной награды. */
  shadow: boolean;
}> = ({ name, desc, unlocked, shadow }) => {
  const background = unlocked
    ? shadow
      ? 'var(--tint-gold)'
      : 'var(--tint-green)'
    : 'var(--bg-card)';
  const borderColor = unlocked
    ? shadow
      ? 'var(--gold)'
      : 'var(--green)'
    : 'var(--border-strong)';
  // Пунктир — признак «ещё не заработано» и у обычных, и у теней. Раньше пунктир означал
  // «это тень», из-за чего незакрытая тень читалась как заработанная особая вещь.
  const border = `1px ${unlocked ? 'solid' : 'dashed'} ${borderColor}`;

  return (
    <li
      style={{
        backgroundColor: background,
        border,
        borderRadius: '6px',
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        listStyle: 'none',
      }}
    >
      <span
        aria-hidden="true"
        style={{ fontSize: '1.1rem', lineHeight: 1.35, opacity: unlocked ? 1 : 0.55 }}
      >
        {unlocked ? (shadow ? '🌑' : '🏆') : '🔒'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Состояние и для слушающего, а не только для глаза: печать, цвет и рамку
            скринридер не видит, и без этого слова заработанное и недостигнутое звучали
            одинаково. */}
        <span style={SR_ONLY}>
          {unlocked ? (shadow ? 'Теневое получено' : 'Получено') : 'Ещё не получено'}
        </span>
        {/* Без pixel-font: название Достижения по-русски, а в Pixelify Sans нет
            заглавных «О» и «П», и они молча уходили в фолбэк прямо посреди слова
            («Промпт-джуниор»). Это ровно то, что ADR-0003 запрещает. */}
        <div
          /* Светлее --green намеренно: так открытое Достижение читается ярче закрытой
             карточки, а --green на подложке сравнялся бы с --text-muted описания рядом.
             Недостигнутое остаётся --text-main, а не приглушённым: подсказку «к чему
             идти» выключать нельзя, отличие несёт рамка. */
          style={{
            fontSize: '0.9rem',
            fontWeight: unlocked ? 600 : 400,
            color: unlocked
              ? shadow
                ? 'var(--gold)'
                : 'var(--green-text)'
              : 'var(--text-main)',
          }}
        >
          {name}
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{desc}</div>
      </div>
    </li>
  );
};

// Выход модалок — реверс существующего toast-fade (только opacity, поэтому картина
// одинакова при полном и при выключенном движении, нового CSS ноль). Входные
// длительности уже в коде (0.18s / 0.2s), выход везде 0.15s, таймер равен длительности
// выхода. Снятие по таймеру, а не по onAnimationEnd: конец анимации может не наступить
// (свёрнутая вкладка, снятый кадр), а висящее окно осталось бы в DOM навсегда.
const MODAL_EXIT_MS = 150;
const MODAL_EXIT_ANIMATION = 'toast-fade 0.15s ease-out reverse';

// Строка настройки и её управляющий элемент. Общая форма для всех трёх строк нужна из-за
// узкого экрана: без переноса управление сжималось до ширины, при которой его подпись
// переносилась внутрь — «Буквы (M, B)» занимала две строки вдвое выше соседней «1e6», и
// пара выглядела поломанной. nowrap запрещает перенос внутри кнопки, а перенос строки
// отдаёт управляющий элемент целиком: подпись настройки при этом переносится, то есть
// текст, который и так читается, вместо текста, который должен помещаться в кнопку.
// marginLeft: 'auto' прижимает управление к правому краю и на отдельной строке тоже.
const SETTING_ROW: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '10px',
  flexWrap: 'wrap',
};
const SETTING_CONTROL: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '0.85rem',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  marginLeft: 'auto',
};
// У пары кнопок наружным элементом управления считается группа, поэтому прижимать к правому
// краю надо её, а не каждую кнопку: auto-отступ внутри группы всегда ноль, потому что
// свободного места в ней нет.
const SETTING_GROUP: React.CSSProperties = { display: 'flex', gap: '6px', flexShrink: 0, marginLeft: 'auto' };

// Отложенное размонтирование окна: запрос закрытия лишь взводит closing, а настоящий
// onClose приходит по одному bounded one-shot таймеру. Очистка в эффекте обязательна —
// иначе размонтирование с висящим таймером дёрнуло бы onClose уже снятого окна.
// Повторный запрос во время выхода — игнор: иначе спам ✕ перезапускал бы выход.
// Открытие (open поменялся) сбрасывает closing, иначе повторное открытие показало бы
// выходной кадр вместо окна. Один вызов хука — одно окно, один таймер.
function useModalExit(
  open: boolean,
  onClose: () => void,
): { closing: boolean; requestClose: () => void } {
  const [closing, setClosing] = useState(false);
  // onClose в рефе, а не в зависимостях таймера: стрелка из оболочки пересоздаётся на
  // каждом рендере, и с ней в зависимостях таймер перезапускался бы, растягивая выход.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  // Сброс closing — layout-эффектом, до кадра: иначе при повторном открытии виден
  // один кадр выходной анимации (пассивный эффект срабатывает уже после отрисовки).
  useLayoutEffect(() => {
    if (open) setClosing(false);
  }, [open]);
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => closeRef.current(), MODAL_EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing]);
  const requestClose = (): void => {
    if (closing) return;
    setClosing(true);
  };
  return { closing, requestClose };
}

// Анатомия окна. Раньше шесть окон отличались шириной (560 / 520 / 500), высотой
// (80 / 85 / 90vh), отступами (20 / 24), зазором (14 / 16), размером заголовка
// (1.3 / 1.4rem), а крестик на экране финала вообще стоял отдельно от строки заголовка.
// Итог был не «у окна есть оболочка», а шесть почти одинаковых, но разных каркасов:
// игрок переучивался расположению крестика при каждом переходе.
const MODAL_MAX_WIDTH = 520;
const MODAL_MAX_HEIGHT = '85vh';
const MODAL_PAD = 20;
const MODAL_GAP = 14;
const MODAL_TITLE_SIZE = '1.2rem';

/** Слой окон. Тосты живут на 100 (см. useDialogFocus: тост о Достижении обязан пережить
 *  открытое окно), оверлей Престижа — на 40, поэтому единого 50 хватает всем окнам. Бывшие
 *  исключения 60 и 65 больше не нужны: экран финала открывается из Престижа, и при равном
 *  слое его перекрывает порядок в DOM — FinaleModal смонтирован после PrestigeModal. */
const MODAL_Z = 50;

/**
 * Тон окна. Обычные окна нейтральны; золото — трофейные и разрушающие (Достижения,
 * Престиж, Финал контента), акцент Поколения — приветственное Окно Возвращения.
 * Именно тон, а не три независимых цвета, держит рамку и заголовок согласованными:
 * раньше они расходились (золотой заголовок при обычной рамке, акцентная рамка при
 * золотом заголовке), и ни одно окно нельзя было описать одним словом.
 */
type ModalTone = 'plain' | 'gold' | 'accent';

const TONE_BORDER: Record<ModalTone, string> = {
  plain: '2px solid var(--border)',
  gold: '2px solid var(--gold)',
  accent: '2px solid var(--accent-color)',
};

const TONE_TITLE: Record<ModalTone, string> = {
  plain: 'var(--text-main)',
  gold: 'var(--gold)',
  accent: 'var(--accent-color)',
};

interface ModalFrameProps {
  /** Открыто ли окно: значение уходит в ловушку фокуса. */
  isOpen: boolean;
  /** Идёт ли кадр выхода (см. useModalExit). */
  closing: boolean;
  /** Запрос закрытия из скрима, крестика и Esc. Владелец окна зовёт его и сам — из своих
   *  кнопок, поэтому закрытие изнутри идёт тем же путём выхода, а не мимо него. */
  requestClose: () => void;
  /** id заголовка — на него ссылается aria-labelledby окна, поэтому он обязателен. */
  titleId: string;
  /** Содержимое заголовка. Счётчик («12 / 21») передаётся сюда же узлом, а не строкой:
   *  у окна одно доступное имя, и разрыв его на части сделал бы имя обрезанным. */
  title: React.ReactNode;
  /** Значок слева от заголовка. */
  icon?: React.ReactNode;
  /**
   * Окно закрывается как обычное: крестик в шапке, Esc, клик по скриму. `false` оставляет
   * только кнопку в «ногах» — так устроено Окно Возвращения, где игрок обязан сначала
   * забрать начисленное и увидеть сумму.
   */
  dismissible?: boolean;
  tone?: ModalTone;
  /** Тело по центру: так оформлены приветствие и экран финала. */
  centered?: boolean;
  /** Действия под прокручиваемым телом — они не уезжают, пока тело листается. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Единственный каркас окна. Оболочка владеет всем, что должно совпадать: скримом,
 * шириной, высотой, отступами, шапкой с заголовком и крестиком, прокручиваемым телом
 * и «ногами». Содержимое окон приходит children и своей разметкой не влияет ни на одну
 * из этих величин.
 *
 * Оболочка без хуков намеренно, кроме ловушки фокуса: useModalExit остаётся у
 * окна-владельца, потому что владельцу нужен его requestClose — Настройки и экран финала
 * закрываются из своих кнопок, и закрытие обязано идти тем же кадром выхода, а не мимо
 * него. Каркас, который сам открывает и закрывает окно, заставил бы каждое окно заводить
 * обходной путь.
 *
 * Прокручиваемое тело — обязательная часть каркаса, а не украшение: без него содержимое
 * длинных окон (Настройки, экран финала) выпирало за maxHeight, и крестик уезжал за край
 * экрана вместе с хвостом настроек. Тело всегда с `flex: 1; minHeight: 0` — у
 * флекс-элемента автоматический минимум равен содержимому, и без minHeight оно не
 * сожмётся, а шапка выдавится наружу.
 *
 * Свой зазор внутри тела нужен не всем: окно с плотной собственной вёрсткой (Настройки)
 * оборачивает содержимое в один div и задаёт ритм сам — оболочка не навязывает его
 * содержимому, но и не запрещает ему свой.
 */
const ModalFrame: React.FC<ModalFrameProps> = ({
  isOpen,
  closing,
  requestClose,
  titleId,
  title,
  icon,
  dismissible = true,
  tone = 'plain',
  centered = false,
  footer,
  children,
}) => {
  // Ловушка фокуса — единственный хук каркаса, и он про окно, а не про разметку.
  const cardRef = useDialogFocus<HTMLDivElement>(isOpen, requestClose, dismissible);
  if (!isOpen) return null;

  // Вход и выход — существующий toast-fade, только opacity, поэтому при reducedMotion
  // картина та же и нового CSS не требуется.
  const fade = closing ? MODAL_EXIT_ANIMATION : 'toast-fade 0.18s ease-out';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--bg-scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: MODAL_Z,
        padding: '16px',
        animation: fade,
      }}
      onClick={dismissible ? requestClose : undefined}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="pixel-card"
        style={{
          width: '100%',
          maxWidth: MODAL_MAX_WIDTH,
          maxHeight: MODAL_MAX_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          padding: MODAL_PAD,
          gap: MODAL_GAP,
          // Ширина и высота заданы один раз для всех окон, поэтому окно не «прыгает» по
          // ширине при переходе между вкладками.
          border: TONE_BORDER[tone],
          animation: fade,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            flexShrink: 0,
          }}
        >
          {/* Настоящий заголовок, а не крупный текст: h1 в игре один (логотип в шапке),
              поэтому окно — второй уровень, и скринридер получает имя из aria-labelledby. */}
          <h2
            id={titleId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              // Узкий экран: заголовок с длинным счётчиком переносится, а не выдавливает
              // крестик, поэтому minWidth 0 плюс перенос, а не жёсткое nowrap.
              flexWrap: 'wrap',
              minWidth: 0,
              fontSize: MODAL_TITLE_SIZE,
              color: TONE_TITLE[tone],
              // Капс даёт text-transform, а не текст в DOM: иначе скринридер читал бы
              // «Д О С Т И Ж Е Н И Я» по буквам, а имя окна — это то, что он произносит.
              textTransform: 'uppercase',
            }}
          >
            {icon}
            {title}
          </h2>
          {dismissible && (
            <button
              className="pixel-btn"
              onClick={requestClose}
              aria-label="Закрыть"
              title="Закрыть"
              style={{ padding: '4px 10px', flexShrink: 0 }}
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            // Растягивание по умолчанию нужно строкам статистики, а центрированному окну —
            // по центру: иначе иконка-молния и кубок уехали бы в левый край вместо середины.
            alignItems: centered ? 'center' : 'stretch',
            textAlign: centered ? 'center' : 'left',
          }}
        >
          {children}
        </div>

        {footer && (
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>{footer}</div>
        )}
      </div>
    </div>
  );
};

/**
 * Счётчик рядом с названием окна: «12 из 21». Слово «из», а не слеш, — и для читающего
 * глаза, и для произносимого вслух (слеш скринридер читает как «слэш»). Цифры остаются
 * пиксельным шрифтом: строка из одних чисел такой шрифт по ADR-0003 выдерживает.
 */
const ModalCount: React.FC<{ earned: number; total: number }> = ({ earned, total }) => (
  <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 400 }}>
    (<Num>{earned}</Num> из <Num>{total}</Num>)
  </span>
);

export const AchievementsModal: React.FC<ModalProps> = ({ isOpen, onClose }) => {
  const state = useGameStore((s) => s.state);
  // Все пути закрытия (скрим, ✕, Esc из хука) идут через один запрос: мгновенного
  // onClose больше нет ни на одном пути.
  const { closing, requestClose } = useModalExit(isOpen, onClose);
  if (!isOpen) return null;

  const unlockedSet = new Set(state.achievements);

  return (
    <ModalFrame
      isOpen
      closing={closing}
      requestClose={requestClose}
      titleId="achievements-title"
      tone="gold"
      icon={<Icon name="trophy" />}
      /* Числитель — nonShadowCount, а не achievements.length: id теней лежат в том же
         списке, и прямой длиной счётчик шапал бы выше знаменателя. */
      title={
        <>
          Достижения <ModalCount earned={nonShadowCount(state)} total={ACHIEVEMENTS.length} />
        </>
      }
    >
      {/* role=list обязателен: у карточек list-style none, и без него Safari и VoiceOver
          выбрасывают список из дерева доступности — вместе со счётчиком «сколько
          осталось». */}
      <ul
        role="list"
        style={{
          display: 'grid',
          // auto-fill вместо фиксированного числа колонок: на широком окне карточки идут
          // в две, на узком — в одну, и пересчитывать вручную по ширине не нужно.
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: '8px',
          margin: 0,
          padding: 0,
        }}
      >
        {ACHIEVEMENTS.map((a) => (
          <AchievementCard
            key={a.id}
            name={a.name}
            desc={a.desc}
            unlocked={unlockedSet.has(a.id)}
            shadow={false}
          />
        ))}
      </ul>

      {/* Отдельная секция, а не хвост общего списка: у теней другой счётчик и нулевая сила,
          и вперемешку с обычными они читались бы как обычные. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: '8px',
          marginTop: '4px',
          paddingTop: '10px',
          borderTop: '1px solid var(--border)',
        }}
      >
        {/* Без pixel-font: в строке есть кириллица, а по ADR-0003 пиксельный шрифт
            допустим только там, где её нет. */}
        <span style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>
          <span aria-hidden="true">🌑</span> Теневые Достижения
        </span>
        <ModalCount earned={shadowEarned(state)} total={SHADOW_ACHIEVEMENTS.length} />
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        Не дают силы и не входят в счёт выше — их берут ради рекордов.
      </div>

      <ul
        role="list"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: '8px',
          margin: 0,
          padding: 0,
        }}
      >
        {SHADOW_ACHIEVEMENTS.map((a) => (
          <AchievementCard
            key={a.id}
            name={a.name}
            desc={a.desc}
            unlocked={unlockedSet.has(a.id)}
            shadow
          />
        ))}
      </ul>
    </ModalFrame>
  );
};

export const StatsModal: React.FC<ModalProps> = ({ isOpen, onClose }) => {
  const state = useGameStore((s) => s.state);
  // Все пути закрытия (скрим, ✕, Esc из хука) идут через один запрос: мгновенного
  // onClose больше нет ни на одном пути.
  const { closing, requestClose } = useModalExit(isOpen, onClose);
  if (!isOpen) return null;

  const now = Date.now();
  const playTimeSec = (now - state.startedAt) / 1000;
  const runTimeSec = (now - state.runStartedAt) / 1000;
  const notation = state.settings.notation;
  const totalAgents = Object.values(state.agents).reduce((a, b) => a + b, 0);

  // План Престижа вместо потери от него: сброс выглядит наказанием ровно потому, что игрок
  // не видит, во сколько обходится единица Compute. Поэтому показываем темп.
  const gain = prestigeGain(state);
  const runHours = Math.max(0, runTimeSec) / 3600;
  // Время всех завершённых забегов: Престиж ставит runStartedAt в момент перехода, поэтому
  // разница со стартом игры — это ровно часы до текущего Забега, а compute — весь прирост,
  // который игрок набрал за них. Историю по забегам хранить не нужно, и поле в GameState
  // не появляется.
  //
  // Оба темпа считаются по стенным часам, поэтому простои, когда игра была закрыта, попадают в
  // них целиком: активного времени в GameState нет и взять его неоткуда, поэтому строки и вывод
  // под ними называют это «вместе с простоями». Молчаливое деление Compute на время, в которое
  // Compute не качался, давало бы число, тем меньшее, чем дольше игрок не открывал игру, — и
  // подпись под ним подталкивала бы к Престижу ровно за то, что он отсутствовал.
  const pastHours = Math.max(0, (state.runStartedAt - state.startedAt) / 3600);
  const runRate = runHours > 0 ? gain / runHours : null;
  const pastRate = pastHours > 0 ? state.compute / pastHours : null;
  // Порог следующей единицы считает движок: инвертировать кубический корень Престижа вручную
  // значило бы держать в компоненте вторую копию формулы, которая разойдётся с ним при первой
  // правке баланса.
  const toNextUnit = computeShortfall(state);
  // Единица измерения — кириллица, поэтому она стоит рядом с числом, а не внутри него
  // (ADR-0003): пиксельный шрифт на строке с «ч» ушёл бы в фолбэк.
  const perHour = (v: number | null): React.ReactNode =>
    v === null ? '—' : (
      <>
        <Num>{formatNumber(v, notation)}</Num> / ч
      </>
    );

  // Значение-узел, а не строка: строка целиком из числа остаётся пиксельной (ADR-0003), а
  // строка со словом («3 ч 12 мин», «1: Рассвет») набирается Nunito.
  const statRows: [string, React.ReactNode][] = [
    ['Токенов сейчас', <Num key="tokens">{formatNumber(state.tokens, notation)}</Num>],
    ['Токенов за текущий Забег', <Num key="runTokens">{formatNumber(state.runTokens, notation)}</Num>],
    ['Токенов за всё время', <Num key="totalTokens">{formatNumber(state.totalTokens, notation)}</Num>],
    ['Кликов за Забег', state.runClicks.toLocaleString('ru-RU')],
    ['Кликов за всё время', state.clicks.toLocaleString('ru-RU')],
    ['Агентов в текущем офисе', <Num key="agents">{totalAgents}</Num>],
    ['Апгрейдов куплено', <Num key="upgrades">{state.upgrades.length}</Num>],
    ['Текущее Поколение', `${CATALOG[state.generation].id}: ${CATALOG[state.generation].name}`],
    ['Максимальное Поколение', `${CATALOG[state.maxGeneration].id}: ${CATALOG[state.maxGeneration].name}`],
    ['Престижей совершено', <Num key="prestiges">{state.prestiges}</Num>],
    [
      'Всего Compute',
      <>
        <Num key="compute">{state.compute}</Num> (+<Num>{state.compute}</Num>% к доходу)
      </>,
    ],
    ['Перков открыто', `${state.perks.length} / ${PERKS.length}`],
    ['Compute в час: этот Забег (с простоями)', perHour(runRate)],
    ['Compute в час: время до Забега (с простоями)', perHour(pastRate)],
    [
      'До +1 Compute осталось',
      <>
        <Num key="toNext">{formatNumber(toNextUnit, notation, 'price')}</Num>{' '}
        {formatCount(toNextUnit, 'Токен', 'Токена', 'Токенов', notation, 'price')}
      </>,
    ],
    ['Событий выпало', <Num key="eventsSeen">{formatNumber(state.eventsSeen, notation)}</Num>],
    ['Глюков пришло в офис', <Num key="glitchSeq">{formatNumber(state.glitchSeq, notation)}</Num>],
    ['Кристаллов в запасе', <Num key="crystals">{formatNumber(state.crystals, notation)}</Num>],
    ['Время в текущем Забеге', formatDuration(runTimeSec)],
    ['Время за всё время игры', formatDuration(playTimeSec)],
  ];

  return (
    <ModalFrame
      isOpen
      closing={closing}
      requestClose={requestClose}
      titleId="stats-title"
      tone="accent"
      icon={<Icon name="info" />}
      title="Статистика"
    >
      {/* План Престижа. Одно предложение вместо ещё трёх строк: строки ниже дают числа,
          а читать их вывод — работа игрока, и именно поэтому сброс выглядит наказанием.
          Здесь вывод назван прямо, и он собран из тех же чисел, что и строки, поэтому
          разойтись с ними он не может. Простои в знаменателе обоих темпов не вычитаются,
          поэтому сравнение не выносит вердикта: решение принимается по выплате. */}
      {(runRate !== null || pastRate !== null) && (
        <div
          style={{
            padding: '8px 10px',
            backgroundColor: 'var(--tint-gold)',
            border: '1px solid var(--gold)',
            borderRadius: '4px',
            fontSize: '0.85rem',
            color: 'var(--text-main)',
          }}
        >
          {pastRate === null ? (
            <>
              Это первый твой Забег, сравнивать не с чем. Престиж сейчас даст{' '}
              <Num>{formatNumber(gain, notation)}</Num> Compute — и это правильный момент:
              забег без первого Престижа копится впустую.
            </>
          ) : runRate === null ? (
            <>
              Забег только начался, темпа Compute в нём пока нет. У времени до этого Забега он
              был <Num>{formatNumber(pastRate, notation)}</Num> в час — вместе с простоями, как
              и все числа здесь.
            </>
          ) : (
            <>
              Сейчас <Num>{formatNumber(runRate, notation)}</Num> Compute в час против{' '}
              <Num>{formatNumber(pastRate, notation)}</Num> у времени до этого Забега. Оба
              числа считают и простои, поэтому ровнять на них решение нельзя — судить приходится
              по выплате: Престиж сейчас даст <Num>{formatNumber(gain, notation)}</Num> Compute.
            </>
          )}
        </div>
      )}

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
          <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{val}</span>
        </div>
      ))}

      {/* Температура идёт ПЕРВОЙ, до словаря: это главная механика игры */}
      <ThermalSection />

      {/* Справка по словарю игры. Формулировки сверены с CONTEXT.md — он источник
          правды для словаря, а не этот файл. Живёт в том же прокручиваемом теле,
          чтобы окно не переполнялось на маленьком экране. */}
      <div style={{ marginTop: '2px' }}>
        {/* Заголовок раздела — тоже заголовок: без него скринридер читает СПРАВКУ
            как ещё одну строку статистики, а не как вложенный раздел. */}
        <h3 style={{ fontSize: '0.95rem', color: 'var(--text-main)', marginBottom: '6px' }}>
          СПРАВКА
        </h3>
        <dl style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: 0 }}>
          {GLOSSARY.map((g) => (
            <div
              key={g.term}
              style={{
                padding: '6px 8px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '4px',
                fontSize: '0.85rem',
              }}
            >
              <dt style={{ color: 'var(--text-main)', fontWeight: 600 }}>{g.term}</dt>
              <dd style={{ color: 'var(--text-muted)', margin: '2px 0 0' }}>{g.text}</dd>
            </div>
          ))}
</dl>
      </div>
    </ModalFrame>
  );
};

export const SettingsModal: React.FC<ModalProps> = ({ isOpen, onClose }) => {
  const state = useGameStore((s) => s.state);
  // Все пути закрытия (скрим, ✕, Esc из хука, удачные импорт/сброс) идут через один
  // запрос: мгновенного onClose больше нет ни на одном пути.
  const { closing, requestClose } = useModalExit(isOpen, onClose);
  const setNotation = useGameStore((s) => s.setNotation);
  const toggleMute = useGameStore((s) => s.toggleMute);
  const setVolume = useGameStore((s) => s.setVolume);
  const setReducedMotion = useGameStore((s) => s.setReducedMotion);
  const importSaveData = useGameStore((s) => s.importSaveData);
  const resetGame = useGameStore((s) => s.resetGame);

  const [importCode, setImportCode] = useState('');
  const [copyStatus, setCopyStatus] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  // Подтверждение импорта — то же переходное состояние, что и подтверждение сброса:
  // переживать закрытие оно не обязано, иначе следующее открытие встретило бы игрока
  // armed-кнопкой «точно заменить» вместо обычного импорта.
  const [confirmImport, setConfirmImport] = useState(false);
  // id таймера сброса «Скопировано»: окно при закрытии не размонтируется (возвращает
  // null, а состояние живёт), поэтому висящий таймер дотянулся бы до следующей сессии
  // и погасил статус свежей копии. Реф + гашение в cleanup ниже и перед перевзведением.
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setConfirmReset(false);
      setConfirmImport(false);
      setErrorMsg('');
      // Подтверждение копирования — переходное: переживать закрытие оно не обязано.
      setCopyStatus(false);
    }
    // Cleanup бежит и на смену isOpen, и на размонтирование: в обоих случаях сбросу
    // чужой сессии срабатывать не на чем — он уже погашен здесь.
    return () => {
      if (copyTimer.current !== null) {
        clearTimeout(copyTimer.current);
        copyTimer.current = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleExport = () => {
    const code = exportSave(state);
    navigator.clipboard.writeText(code).then(
      () => {
        // Повторная копия перевзводит таймер: иначе первый же таймер погасил бы статус
        // свежей копии раньше её двух секунд.
        if (copyTimer.current !== null) clearTimeout(copyTimer.current);
        setErrorMsg('');
        setCopyStatus(true);
        copyTimer.current = setTimeout(() => {
          copyTimer.current = null;
          setCopyStatus(false);
        }, 2000);
      },
      // Отказ буфера (запрет доступа, документ не в фокусе) виден игроку тем же
      // предупреждением, что и битый код импорта: молчание читалось бы как сломанная кнопка.
      () => {
        setErrorMsg('Не удалось скопировать: браузер запретил доступ к буферу обмена.');
      },
    );
  };

  const handleImport = () => {
    setErrorMsg('');
    const trimmed = importCode.trim();
    if (!trimmed) return;
    // Подтверждение рисуется внутри игры, как у сброса: системный диалог блокирующий,
    // оформлен системой, на английской системе говорит по-английски, а во встроенных
    // просмотрах вообще не показывается.
    if ((state.totalTokens > 0 || state.prestiges > 0) && !confirmImport) {
      setConfirmImport(true);
      return;
    }
    const ok = importSaveData(trimmed);
    if (ok) {
      setImportCode('');
      setConfirmImport(false);
      requestClose();
    } else {
      // Отказ виден и не трогает забег: importSaveData возвращает false, не меняя состояние.
      setErrorMsg('Неверный код сохранения: в нём нет знакомого прогресса. Текущий Забег не тронут.');
    }
  };

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    resetGame();
    setConfirmReset(false);
    requestClose();
  };

  return (
    <ModalFrame
      isOpen
      closing={closing}
      requestClose={requestClose}
      titleId="settings-title"
      tone="plain"
      icon={<Icon name="settings" />}
      title="Настройки"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Настройка нотации чисел */}
        <div style={SETTING_ROW}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>Формат больших чисел</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              1,23 M или 1.23e6
            </div>
          </div>
          <div style={SETTING_GROUP}>
            <button
              onClick={() => setNotation('short')}
              className={`pixel-btn ${state.settings.notation === 'short' ? 'pixel-btn-accent' : ''}`}
              style={{ padding: '6px 10px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
            >
              Буквы (M, B)
            </button>
            <button
              onClick={() => setNotation('sci')}
              className={`pixel-btn ${state.settings.notation === 'sci' ? 'pixel-btn-accent' : ''}`}
              style={{ padding: '6px 10px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
            >
              1e6
            </button>
          </div>
        </div>

        {/* Настройка звука */}
        <div style={SETTING_ROW}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>8-битный звук</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Звуковые эффекты клика и событий
            </div>
          </div>
          <button
            onClick={toggleMute}
            className={`pixel-btn ${!state.settings.muted ? 'pixel-btn-accent' : ''}`}
            style={SETTING_CONTROL}
          >
            <Icon name={state.settings.muted ? 'sound-off' : 'sound-on'} />{' '}
            {state.settings.muted ? 'выключен' : 'включен'}
          </button>
        </div>

        {/* Громкость: честная доля, а не только мьют. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <label htmlFor="settings-volume" style={{ fontWeight: 600, display: 'flex', gap: '6px' }}>
              <Icon name="volume" /> Громкость
            </label>
            <span style={{ color: 'var(--text-main)' }}>
              <Num>{Math.round(state.settings.volume * 100)}</Num>%
            </span>
          </div>
          <input
            id="settings-volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={state.settings.volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent-color)', cursor: 'pointer' }}
            aria-describedby="settings-volume-hint"
            aria-valuetext={`${Math.round(state.settings.volume * 100)} процентов`}
          />
          <div id="settings-volume-hint" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Громкость звуковых эффектов и музыки
          </div>
        </div>

        {/* Настройка анимации */}
        <div style={SETTING_ROW}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>Меньше анимации</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Выключает движение в игре
            </div>
          </div>
          <button
            onClick={() => setReducedMotion(!state.settings.reducedMotion)}
            className={`pixel-btn ${state.settings.reducedMotion ? 'pixel-btn-accent' : ''}`}
            style={SETTING_CONTROL}
          >
            {state.settings.reducedMotion ? 'Включено' : 'Выключено'}
          </button>
        </div>

        {/* Экспорт и Импорт */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontWeight: 600 }}>Сохранение данных</div>

          <button onClick={handleExport} className="pixel-btn" style={{ width: '100%' }}>
            {copyStatus ? 'Скопировано в буфер!' : 'Скопировать сохранение в буфер'}
          </button>

          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              flex: 1,
              minWidth: 0,
              marginTop: '4px',
            }}
          >
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Вставь код сохранения
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={importCode}
                onChange={(e) => {
                  setImportCode(e.target.value);
                  // Протухшая жалоба на прошлый код не должна встречать следующий:
                  // показ ошибки принадлежит текущей попытке, а не полю.
                  if (errorMsg) setErrorMsg('');
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-main)',
                  padding: '8px',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                }}
              />
              <button onClick={handleImport} className="pixel-btn pixel-btn-accent" style={{ padding: '8px 12px' }}>
                Импорт
              </button>
            </div>
            {/* Второе нажатие подтверждает замену забега — тем же двухшаговым
                подтверждением, что и сброс выше, а не системным диалогом. */}
            {confirmImport && (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '6px' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Текущий Забег и весь прогресс будут полностью заменены.
                </span>
                <button
                  onClick={handleImport}
                  className="pixel-btn"
                  style={{
                    backgroundColor: 'var(--red-solid)',
                    borderColor: 'var(--red)',
                    color: 'var(--text-main)',
                    padding: '8px 12px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Точно заменить?
                </button>
                <button
                  onClick={() => setConfirmImport(false)}
                  className="pixel-btn"
                  style={{ padding: '8px 12px' }}
                >
                  Отмена
                </button>
              </div>
            )}
          </label>
          {errorMsg && (
            <div
              role="alert"
              style={{
                marginTop: '6px',
                padding: '8px 10px',
                backgroundColor: 'var(--tint-red)',
                border: '1px solid var(--red)',
                borderRadius: '4px',
                fontSize: '0.8rem',
                color: '#fca5a5',
                display: 'flex',
                gap: '6px',
                alignItems: 'center',
              }}
            >
              <Icon name="warning" size={14} /> {errorMsg}
            </div>
          )}
        </div>

        {/* Чистый сброс в отдельной опасной зоне */}
        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div
            style={{
              fontWeight: 600,
              color: 'var(--red)',
              fontSize: '0.9rem',
              display: 'flex',
              gap: '6px',
              alignItems: 'center',
            }}
          >
            <Icon name="warning" size={14} /> Опасная зона: Сброс прогресса
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Сброс удалит Токены, Агентов, Апгрейды и Compute навсегда. Начнётся новая чистая игра с первого Забега.
          </div>
          {confirmReset ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleReset}
                className="pixel-btn"
                style={{
                  flex: 1,
                  backgroundColor: 'var(--red-solid)',
                  borderColor: 'var(--red)',
                  color: 'var(--text-main)',
                  padding: '8px',
                  fontSize: '0.85rem',
                  display: 'flex',
                  gap: '6px',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Icon name="warning" size={14} /> Точно стереть всё?
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="pixel-btn"
                style={{ padding: '8px 12px', fontSize: '0.85rem' }}
              >
                Отмена
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="pixel-btn"
              style={{
                width: '100%',
                backgroundColor: 'var(--tint-red)',
                borderColor: 'var(--red)',
                color: 'var(--red-text)',
                padding: '8px',
                fontSize: '0.85rem',
                display: 'flex',
                gap: '6px',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Icon name="reset" size={14} /> Сбросить весь прогресс
            </button>
          )}
        </div>
      </div>
    </ModalFrame>
  );
};

export const OfflineModal: React.FC = () => {
  const offlineReport = useGameStore((s) => s.offlineReport);
  const dismiss = useGameStore((s) => s.dismissOfflineReport);
  const state = useGameStore((s) => s.state);
  const notation = state.settings.notation;
  // Esc здесь не закрывает: игрок должен забрать начисленное и увидеть сумму, поэтому окно
  // закрывается только своей кнопкой. Кнопка идёт через тот же closing-путь, что и
  // остальные окна: мгновенного dismiss больше нет.
  const { closing, requestClose } = useModalExit(offlineReport !== null, dismiss);

  if (!offlineReport) return null;

  const capHours = offlineCapHours(state);
  const capSeconds = capHours * 3600;
  const isCapped = offlineReport.seconds >= capSeconds;

  const gen = CATALOG[state.generation];

  // Разбор по Лабораториям делит уже начисленную сумму на доли Лабораторий в общем Доходе.
  // Сырые секунды простоя не пересчитываются: их вместе с капом уже учёл applyOffline, и своя
  // формула здесь дала бы расхождение с числом выше. Доля считается в движке, а не делением
  // здесь, иначе пустой общий Доход дал бы NaN прямо на экране. Лаборатории без Агентов
  // отфильтрованы — нулевой строкой в отчёте смотреть не на что.
  const labRows = LAB_IDS.map((lab) => {
    const share = labIncomeShare(state, lab);
    return { lab, share, earned: offlineReport.earned * share };
  })
    .filter((row) => row.share > 0)
    .sort((a, b) => b.earned - a.earned);

  // Подсказки покупки — только из движка: цены и доступность в компоненте не считаются.
  // availableUpgrades уже отсортирован по цене, а maxAffordable отвечает за Модели.
  const discount = discountMult(state);
  const affordableUpgrades = availableUpgrades(state)
    .filter((u) => u.cost <= state.tokens)
    .slice(0, 2);
  const affordableModels = gen.models.filter(
    (m) => maxAffordable(m, state.agents[m.id] ?? 0, state.tokens, discount) > 0
  );
  // Модели в Поколении идут по Рангу, а Доход по Рангу растёт — поэтому последняя из доступных
  // и есть самая доходная, и сортировать по Доходу заново не нужно.
  const bestModel = affordableModels[affordableModels.length - 1];
  const bestCount = bestModel
    ? maxAffordable(bestModel, state.agents[bestModel.id] ?? 0, state.tokens, discount)
    : 0;

  return (
    <ModalFrame
      isOpen
      closing={closing}
      requestClose={requestClose}
      titleId="offline-title"
      tone="accent"
      icon={<Icon name="bolt" size={22} />}
      title="С возвращением!"
      /* Окно выигрыша: забрать начисленное можно только своей кнопкой, поэтому ни крестика,
         ни Esc, ни клика по скриму. Доступное имя у окна при этом обязано остаться. */
      dismissible={false}
      centered
      footer={
        <button
          onClick={requestClose}
          className="pixel-btn pixel-btn-accent"
          style={{ flex: 1, padding: '12px', fontSize: '1.1rem' }}
        >
          Забрать Токены!
        </button>
      }
    >
      <div style={{ fontSize: '2.4rem', lineHeight: 1 }}>
        <Icon name="bolt" size={40} />
      </div>

      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        Пока тебя не было (
        <span style={{ color: 'var(--gold)', fontWeight: 700 }}>
          {formatDuration(offlineReport.seconds)}
        </span>
        ), твои ИИ-Агенты усердно трудились и заработали:
      </div>

      {isCapped && (
        <div
          style={{
            fontSize: '0.8rem',
            color: 'var(--gold)',
            backgroundColor: 'var(--tint-gold)',
            border: '1px solid var(--gold)',
            borderRadius: '4px',
            padding: '6px 10px',
            maxWidth: '420px',
            alignSelf: 'center',
          }}
        >
          Достигнут потолок Оффлайн-дохода (<Num>{capHours}</Num> ч). Время отсутствия сверх лимита было срезано потолком.
        </div>
      )}

      <div
        style={{
          fontSize: '2rem',
          color: 'var(--green-text)',
          // Ореол — переменная со своим назначением: --tint-green это 10% подложка, а
          // свечению нужно 50%, ради него и заведена --green-glow.
          textShadow: '0 0 10px var(--green-glow)',
        }}
      >
        +<Num>{formatNumber(offlineReport.earned, notation)}</Num> Токенов
      </div>

      {/* Кристалл дозревает по стенным часам, и в простое он единственный, кто ещё что-то
          принёс: доход за простой бывает нулевым (например, когда все Агенты проданы), а
          кристалл всё равно один. Молчать о нём нельзя — игрок узнал бы только по прибавке
          к Доходу на экране и не понял бы, откуда она. Строка стоит под крупной суммой
          Токенов и до прокручиваемого разбора: кристалл ждал именно этих часов. */}
      {offlineReport.crystals > 0 && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          За простой дозрел{' '}
          <span style={{ color: 'var(--gold)', fontWeight: 600 }}>
            +<Num>{formatNumber(offlineReport.crystals, notation)}</Num>{' '}
            {formatCount(
              offlineReport.crystals,
              'Compute-кристалл',
              'Compute-кристалла',
              'Compute-кристаллов',
              notation
            )}
          </span>
        </div>
      )}

      {/* Разбор — левое выравнивание в центрированном окне: колонки чисел по краям от
          центра разъезжаются, и суммы перестают выравниваться в столбик. */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          textAlign: 'left',
        }}
      >
        {labRows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* Без pixel-font: в заголовке есть кириллица, а по ADR-0003 пиксельный шрифт
                допустим только на строках без неё. */}
            <div style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>Кто заработал</div>
            {labRows.map((row) => (
              <div
                key={row.lab}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 8px',
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: '4px',
                  fontSize: '0.85rem',
                }}
              >
                <MascotSprite lab={row.lab} size={20} />
                {/* Подпись Лаборатории — в --text-main, а не в её фирменный цвет: самый
                    тёмный из восьми цветов на карточке даёт 1.08:1 и просто исчезает. */}
                <span style={{ flex: 1, minWidth: 0, color: 'var(--text-main)' }}>
                  {LABS[row.lab].name}
                </span>
                {/* Строка целиком из числа: пиксельный шрифт тут разрешён (ADR-0003). */}
                <span className="pixel-font" style={{ color: 'var(--green)', fontWeight: 600 }}>
                  +{formatNumber(row.earned, notation)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>Теперь доступно</div>

          {bestModel && (
            <div
              style={{
                padding: '8px',
                backgroundColor: 'var(--tint-gold)',
                border: '1px solid var(--gold)',
                borderRadius: '4px',
                fontSize: '0.85rem',
              }}
            >
              {/* Имя Модели без pixel-font: оно склеено со словом «Агент:», а по ADR-0003
                  пиксельный шрифт допустим только на строках без кириллицы. */}
              <div style={{ color: 'var(--text-main)' }}>
                Агент: <span>{bestModel.name}</span>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                {/* После «на» 1 и 2–4 стоят в родительном: 1 Агента, 2 Агента, 5 Агентов.
                    Форма берётся по той же нотации, что и напечатанное число, иначе на
                    больших числах слово и цифры разъедутся. */}
                Хватит на <Num>{formatNumber(bestCount, notation)}</Num>{' '}
                {formatCount(bestCount, 'Агента', 'Агента', 'Агентов', notation)} ·{' '}
                {LABS[bestModel.lab].name}
                {bestModel.isFlagship ? ' · Флагман открывает Престиж' : ''}
              </div>
            </div>
          )}

          {affordableUpgrades.map((u) => (
            <div
              key={u.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '4px',
                fontSize: '0.85rem',
              }}
            >
              {/* Имя Апгрейда без pixel-font — та же причина, что и у Модели выше. */}
              <span style={{ flex: 1, minWidth: 0, color: 'var(--text-main)' }}>
                Апгрейд: <span>{u.name}</span>
              </span>
              <span className="pixel-font" style={{ color: 'var(--accent-color)' }}>
                {formatNumber(u.cost, notation)}
              </span>
            </div>
          ))}

          {!bestModel && affordableUpgrades.length === 0 && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Токенов пока не хватает ни на одну покупку — они уйдут в Агентов.
            </div>
          )}
        </div>
      </div>
    </ModalFrame>
  );
};

/**
 * Окно подтверждения Престижа: единственное место, где игрок видит, сколько Compute
 * начислит переход, что сгорит и в какое Поколение он попадёт. Открывается из обеих
 * колонок через `requestPrestige`, а сам переход выполняет `triggerPrestige` — условия
 * отказа живут в сторе, поэтому окно их только показывает словами.
 */
export const PrestigeModal: React.FC = () => {
  const isOpen = useGameStore((s) => s.prestigePrompt);
  const dismiss = useGameStore((s) => s.dismissPrestigePrompt);
  const triggerPrestige = useGameStore((s) => s.triggerPrestige);
  const openFinale = useGameStore((s) => s.openFinale);
  const state = useGameStore((s) => s.state);
  // Хуки стоят до раннего выхода, иначе окно то ловило бы Esc, то нет. Выход — тем же
  // closing-путём, что и у остальных окон: мгновенный dismiss возвращал бы карточку в DOM
  // без последнего кадра анимации.
  const { closing, requestClose } = useModalExit(isOpen, dismiss);
  if (!isOpen) return null;

  const preview = prestigePreview(state);
  const gen = CATALOG[state.generation];
  const nextGen = CATALOG[preview.generation];
  const flagship = gen.flagship;
  const finale = isContentFinale(state);
  const notation = state.settings.notation;

  const blocked = finale
    ? `Финал контента: Поколение ${gen.id} — последнее. Продолжение выйдет с новыми реальными Моделями.`
    : `Нужен 1 Агент Флагмана — ${flagship.name} (${LABS[flagship.lab].name}). Найми первого Агента, и Престиж откроется.`;

  const burns: [string, React.ReactNode][] = [
    [
      'Агенты',
      <>
        <Num>{formatNumber(preview.agentsLost, notation)}</Num>{' '}
        {formatCount(preview.agentsLost, 'Агент', 'Агента', 'Агентов', notation)}
      </>,
    ],
    [
      'Апгрейды',
      <>
        <Num>{formatNumber(preview.upgradesLost, notation)}</Num>{' '}
        {formatCount(preview.upgradesLost, 'Апгрейд', 'Апгрейда', 'Апгрейдов', notation)}
      </>,
    ],
    [
      'Токены',
      <>
        <Num>{formatNumber(preview.tokensLost, notation)}</Num> Токенов
      </>,
    ],
  ];

  // Подтверждение зовёт тот же переход, что и раньше: условия отказа живут в сторе, и вторую
  // проверку в окне писать нельзя. Закрытие здесь мгновенное, а не через requestClose: переход
  // уже сменил Поколение, и оставшийся кадр выхода показал бы вместо разбора «нужен Агент
  // Флагмана» нового Поколения — вперемешку с оверлеем Престижа.
  const handleConfirm = () => {
    if (finale) {
      // Финал — тупик с честным выходом: не сбрасываем забег молча, а открываем экран финала,
      // где игрок видит итоги и сам решает, начинать ли заново.
      dismiss();
      openFinale();
      return;
    }
    triggerPrestige();
    dismiss();
  };

  return (
    <ModalFrame
      isOpen
      closing={closing}
      requestClose={requestClose}
      titleId="prestige-title"
      tone="gold"
      /* Разрушающее окно, поэтому рамка и заголовок золотые — тот же тон, что у Достижений
         и экрана финала: золото в игре означает «трофей или разрушение Забега». */
      icon={<span aria-hidden="true">🚀</span>}
      title="Престиж"
      footer={
        <>
          <button className="pixel-btn" onClick={requestClose} style={{ flex: 1, padding: '12px' }}>
            Отмена
          </button>
          <button
            onClick={handleConfirm}
            disabled={preview.blocked && !finale}
            className="pixel-btn pixel-btn-gold"
            style={{ flex: 2, padding: '12px' }}
          >
            {finale
              ? 'Экран финала'
              : preview.blocked
                ? 'Нужен Агент Флагмана'
                : 'Сделать Престиж!'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          Сейчас Поколение {gen.id}: {gen.name}.
          {!preview.blocked && (
            <>
              {' '}
              Престиж завершит Забег и перенесёт тебя в Поколение {nextGen.id}: {nextGen.name}.
            </>
          )}
        </div>

        {/* Пока Престиж невозможен, окно не обещает ни Compute, ни сгорания: и то и другое
            было бы обещанием, которое переход не выполнит. */}
        {preview.blocked ? (
          <div
            style={{
              backgroundColor: 'var(--tint-red)',
              border: '1px solid var(--red)',
              borderRadius: '4px',
              padding: '10px 12px',
              fontSize: '0.9rem',
              // Светлее --red намеренно: на собственной красной подложке --red тонет в
              // заливке, а причина отказа обязана читаться.
              color: 'var(--red-text)',
            }}
          >
            Престиж сейчас невозможен. {blocked}
          </div>
        ) : (
          <>
            <div
              style={{
                backgroundColor: 'var(--tint-gold)',
                border: '1px solid var(--gold)',
                borderRadius: '4px',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '10px',
              }}
            >
              <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
                Начислим Compute
              </span>
              <span style={{ fontSize: '1.6rem', color: 'var(--gold)', fontWeight: 700 }}>
                <Num>{`+${formatNumber(preview.gain, notation)}`}</Num>
              </span>
            </div>

            <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>Сгорит:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {burns.map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '10px',
                    padding: '6px 8px',
                    backgroundColor: 'var(--bg-card)',
                    borderRadius: '4px',
                    fontSize: '0.85rem',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                  {/* Слово рядом с числом — в Nunito: по ADR-0003 пиксельный шрифт живёт
                      только внутри числа, поэтому Num стоит на самом числе. */}
                  <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Останутся: Compute, Перки, Достижения и вся статистика за всё время.
            </div>
          </>
        )}
      </div>
    </ModalFrame>
  );
};

/**
 * Экран финала контента: полноценная модалка, открывающаяся при прохождении последнего
 * доступного Поколения и найме всех Моделей (isContentFinale === true).
 *
 * Показывает итоги забега: Поколение, престижи, общее число Токенов, Достижения,
 * реплики в Переписке и Compute. Сообщает игроку о будущем («продолжение выйдет с новыми
 * реальными Моделями»). Даёт возможность продолжить осмотр империи либо начать заново
 * с подтверждением в два шага («Точно начать заново?»), сбрасывающим Забег через resetGame.
 */
export const FinaleModal: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const resetGame = useGameStore((s) => s.resetGame);
  const finaleDismissed = useGameStore((s) => s.finaleDismissed);
  const dismissFinale = useGameStore((s) => s.dismissFinale);
  const notation = state.settings.notation;

  const isFinale = isContentFinale(state);
  const [confirmReset, setConfirmReset] = useState(false);

  // Флаг «игрок закрыл» живёт в сторе вместе с openFinale: экран должен открываться сам при
  // входе в последнее Поколение и возвращаться из Престижа — модульная переменная компонента
  // для этого не годится, её не видно ни в отладке, ни в тестах.
  const isOpen = isFinale && !finaleDismissed;
  const { closing, requestClose } = useModalExit(isOpen, () => {
    // Закрытие без рестарта оставляет игру в финале целой: экран можно вернуть из Престижа.
    dismissFinale();
    setConfirmReset(false);
  });

  if (!isOpen) return null;

  const gen = CATALOG[state.generation];

  const handleResetClick = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    resetGame();
    requestClose();
  };

  return (
    <ModalFrame
      isOpen
      closing={closing}
      requestClose={requestClose}
      titleId="finale-title"
      tone="gold"
      icon={<Icon name="trophy" size={22} />}
      title="Финал контента"
      centered
      footer={
        <>
          <button
            onClick={handleResetClick}
            className={`pixel-btn ${confirmReset ? '' : 'pixel-btn-accent'}`}
            style={{
              flex: 1,
              padding: '10px 14px',
              fontSize: '0.95rem',
              ...(confirmReset
                ? {
                    backgroundColor: 'var(--red-solid)',
                    borderColor: 'var(--red)',
                    // --text-main на --red-solid держит 6.4:1, а насыщенная заливка не
                    // требует чистого белого: тот же тёплый белый, что и у всех кнопок.
                    color: 'var(--text-main)',
                  }
                : {}),
            }}
          >
            {confirmReset ? 'Точно начать заново? (весь прогресс сбросится)' : 'Начать заново'}
          </button>

          {confirmReset ? (
            <button
              onClick={() => setConfirmReset(false)}
              className="pixel-btn"
              style={{ padding: '10px 14px', fontSize: '0.95rem' }}
            >
              Отмена
            </button>
          ) : (
            <button
              onClick={requestClose}
              className="pixel-btn"
              style={{ padding: '10px 14px', fontSize: '0.95rem', color: 'var(--text-muted)' }}
            >
              Продолжить осмотр
            </button>
          )}
        </>
      }
    >
      <div style={{ fontSize: '2.2rem', lineHeight: 1 }}>
        <Icon name="trophy" size={38} />
      </div>

      {/* Что произошло */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>
          Последнее Поколение пройдено, все Модели собраны!
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
          Твоя империя искусственного интеллекта достигла вершины доступных технологий.
        </div>
      </div>

      {/* Честная строка про будущее по CONTEXT.md */}
      <div
        style={{
          width: '100%',
          padding: '8px 12px',
          backgroundColor: 'var(--tint-gold)',
          border: '1px solid var(--gold)',
          borderRadius: '4px',
          fontSize: '0.85rem',
          color: 'var(--gold)',
          textAlign: 'center',
        }}
      >
        Продолжение выйдет с новыми реальными Моделями.
      </div>

      {/* Итоги забега */}
      <div
        style={{
          width: '100%',
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '8px',
          textAlign: 'left',
        }}
      >
        <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-card)', borderRadius: '4px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Поколение</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--accent-color)' }}>
            Поколение <Num>{state.generation + 1}</Num>: {gen.name}
          </div>
        </div>

        <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-card)', borderRadius: '4px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Престижей за всё время</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)' }}>
            <Num>{state.prestiges}</Num>
          </div>
        </div>

        <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-card)', borderRadius: '4px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Токенов всего</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--green)' }}>
            <Num>{formatNumber(state.totalTokens, notation)}</Num>
          </div>
        </div>

        <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-card)', borderRadius: '4px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Compute в запасе</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--accent-color)' }}>
            <Num>{formatNumber(state.compute, notation)}</Num>
          </div>
        </div>

        <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-card)', borderRadius: '4px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Достижений</div>
          {/* Числитель — nonShadowCount, а не achievements.length: id теневых лежат в том же
              списке, и прямой длиной счётчик на экране финала показывал «25 / 21». */}
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--gold)' }}>
            <Num>{nonShadowCount(state)}</Num> / <Num>{ACHIEVEMENTS.length}</Num>
          </div>
        </div>

        <div style={{ padding: '8px 10px', backgroundColor: 'var(--bg-card)', borderRadius: '4px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Реплик в Переписке</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)' }}>
            <Num>{state.quipsSeen.length}</Num>
          </div>
        </div>
      </div>

      {/* Кнопки рестарта — в «ногах» каркаса, поэтому на низком экране они остаются на
          виду, а прокручивается только итоговая таблица. */}
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
        {confirmReset
          ? 'Весь прогресс будет сброшен! Забег начнётся с первого Поколения.'
          : 'Хочешь пройти путь с начала? Можно начать заново.'}
      </div>
    </ModalFrame>
  );
};
