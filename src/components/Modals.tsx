import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { ACHIEVEMENTS, ordinaryEarned, shadowEarned } from '../economy/achievements';
import { GLOSSARY } from '../data/glossary';
import { PERKS } from '../economy/perks';
import { exportSave } from '../economy/save';
import { formatCount, formatDuration, formatNumber } from '../economy/format';
import { discountMult, isContentFinale, labIncomeShare, maxAffordable, prestigePreview } from '../economy/engine';
import { availableUpgrades } from '../economy/upgrades';
import { SHADOW_ACHIEVEMENTS } from '../economy/shadow';
import { CATALOG } from '../economy/catalog';
import { LABS, LAB_IDS } from '../data/labs';
import { Icon } from './Icon';
import { MascotSprite } from './MascotSprite';
import { Num } from './Num';
import { useDialogFocus } from './useDialogFocus';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Строка Достижения. Обычная запись и тень отличаются только видом, поэтому рисуются здесь,
 *  а не двумя списками. */
const AchievementRow: React.FC<{
  name: string;
  desc: string;
  unlocked: boolean;
  /** Тень не входит в счёт обычных и не даёт силы, поэтому вид у неё другой и без цвета:
   *  зелёной печати у тени нет, а рамка пунктирная. */
  shadow: boolean;
}> = ({ name, desc, unlocked, shadow }) => {
  const background = unlocked
    ? shadow
      ? 'var(--tint-gold)'
      : 'var(--tint-green)'
    : 'var(--bg-card)';
  const border = shadow
    ? `1px dashed ${unlocked ? 'var(--gold)' : 'var(--border-strong)'}`
    : `1px solid ${unlocked ? 'var(--green)' : 'var(--border)'}`;

  return (
    <div
      style={{
        backgroundColor: background,
        border,
        borderRadius: '6px',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <div aria-hidden="true" style={{ fontSize: '1.5rem', opacity: shadow ? 0.7 : 1 }}>
        {unlocked ? (shadow ? '🌑' : '🏆') : '🔒'}
      </div>
      <div style={{ flex: 1 }}>
        {/* Без pixel-font: название Достижения по-русски, а в Pixelify Sans нет
            заглавных «О» и «П», и они молча уходили в фолбэк прямо посреди слова
            («Промпт-джуниор»). Это ровно то, что ADR-0003 запрещает. */}
        <div
          /* Светлее --green намеренно: так открытое Достижение читается ярче
             закрытой строки, а --green на подложке сравнялся бы с --text-muted
             соседнего описания. */
          style={{
            fontSize: '0.95rem',
            color: unlocked ? (shadow ? 'var(--gold)' : '#86efac') : 'var(--text-muted)',
          }}
        >
          {name}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{desc}</div>
      </div>
    </div>
  );
};

// Выход модалок — реверс существующего toast-fade (только opacity, поэтому картина
// одинакова при полном и при выключенном движении, нового CSS ноль). Входные
// длительности уже в коде (0.18s / 0.2s), выход везде 0.15s, таймер равен длительности
// выхода. Снятие по таймеру, а не по onAnimationEnd: конец анимации может не наступить
// (свёрнутая вкладка, снятый кадр), а висящее окно осталось бы в DOM навсегда.
const MODAL_EXIT_MS = 150;
const MODAL_EXIT_ANIMATION = 'toast-fade 0.15s ease-out reverse';

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

export const AchievementsModal: React.FC<ModalProps> = ({ isOpen, onClose }) => {
  const state = useGameStore((s) => s.state);
  // Все пути закрытия (скрим, ✕, Esc из хука) идут через один запрос: мгновенного
  // onClose больше нет ни на одном пути.
  const { closing, requestClose } = useModalExit(isOpen, onClose);
  // Хук обязан стоять до раннего выхода: иначе окно то открывалось бы с ловушкой, то без неё.
  const cardRef = useDialogFocus<HTMLDivElement>(isOpen, requestClose);
  if (!isOpen) return null;

  const unlockedSet = new Set(state.achievements);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--bg-scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '16px',
        // Вход — существующий toast-fade, выход — тот же кадр в реверсе (только opacity,
        // поэтому при reducedMotion картина та же, нового CSS ноль).
        animation: closing ? MODAL_EXIT_ANIMATION : 'toast-fade 0.18s ease-out',
      }}
      onClick={requestClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="achievements-title"
        className="pixel-card"
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px',
          gap: '14px',
          // Карточка ходит тем же кадром, что и скрим: вход — прямо, выход — в реверсе.
          animation: closing ? MODAL_EXIT_ANIMATION : 'toast-fade 0.18s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 id="achievements-title" style={{ fontSize: '1.3rem', color: 'var(--gold)' }}>
            {/* Числитель — ordinaryEarned, а не achievements.length: id теней лежат в том же
                списке, и прямой длиной счётчик шапал бы выше знаменателя. */}
            <Icon name="trophy" /> ДОСТИЖЕНИЯ ({ordinaryEarned(state)} / {ACHIEVEMENTS.length})
          </h2>
          <button
            className="pixel-btn"
            onClick={requestClose}
            aria-label="Закрыть"
            title="Закрыть"
            style={{ padding: '4px 10px' }}
          >
            ✕
          </button>
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {ACHIEVEMENTS.map((a) => (
            <AchievementRow
              key={a.id}
              name={a.name}
              desc={a.desc}
              unlocked={unlockedSet.has(a.id)}
              shadow={false}
            />
          ))}

          {/* Отдельная секция, а не хвост общего списка: у теней другой счётчик и нулевая сила,
              и вперемешку с обычными они читались бы как обычные. */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: '8px',
              marginTop: '6px',
              paddingTop: '10px',
              borderTop: '1px solid var(--border)',
            }}
          >
            {/* Без pixel-font: в строке есть кириллица, а по ADR-0003 пиксельный шрифт
                допустим только там, где её нет. */}
            <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>
              <span aria-hidden="true">🌑</span> Теневые Достижения
            </span>
            {/* Счётчик — строка из одного числа, пиксельный шрифт тут разрешён. */}
            <span className="pixel-font" style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              {shadowEarned(state)} / {SHADOW_ACHIEVEMENTS.length}
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Не дают силы и не входят в счёт выше — их берут ради рекордов.
          </div>

          {SHADOW_ACHIEVEMENTS.map((a) => (
            <AchievementRow
              key={a.id}
              name={a.name}
              desc={a.desc}
              unlocked={unlockedSet.has(a.id)}
              shadow
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export const StatsModal: React.FC<ModalProps> = ({ isOpen, onClose }) => {
  const state = useGameStore((s) => s.state);
  // Все пути закрытия (скрим, ✕, Esc из хука) идут через один запрос: мгновенного
  // onClose больше нет ни на одном пути.
  const { closing, requestClose } = useModalExit(isOpen, onClose);
  const cardRef = useDialogFocus<HTMLDivElement>(isOpen, requestClose);
  if (!isOpen) return null;

  const now = Date.now();
  const playTimeSec = (now - state.startedAt) / 1000;
  const runTimeSec = (now - state.runStartedAt) / 1000;
  const notation = state.settings.notation;
  const totalAgents = Object.values(state.agents).reduce((a, b) => a + b, 0);

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
    ['Время в текущем Забеге', formatDuration(runTimeSec)],
    ['Время за всё время игры', formatDuration(playTimeSec)],
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--bg-scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '16px',
        // Вход — существующий toast-fade, выход — тот же кадр в реверсе (только opacity,
        // поэтому при reducedMotion картина та же, нового CSS ноль).
        animation: closing ? MODAL_EXIT_ANIMATION : 'toast-fade 0.18s ease-out',
      }}
      onClick={requestClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-title"
        className="pixel-card"
        style={{
          width: '100%',
          maxWidth: '520px',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px',
          gap: '14px',
          animation: closing ? MODAL_EXIT_ANIMATION : 'toast-fade 0.18s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 id="stats-title" style={{ fontSize: '1.3rem', color: 'var(--accent-color)' }}>
            <Icon name="info" /> СТАТИСТИКА
          </h2>
          <button
            className="pixel-btn"
            onClick={requestClose}
            aria-label="Закрыть"
            title="Закрыть"
            style={{ padding: '4px 10px' }}
          >
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
              <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{val}</span>
            </div>
          ))}

          {/* Справка по словарю игры. Формулировки сверены с CONTEXT.md — он источник
              правды для словаря, а не этот файл. Живёт в том же прокручиваемом теле,
              чтобы окно не переполнялось на маленьком экране. */}
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '6px' }}>
              СПРАВКА
            </div>
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
        </div>
      </div>
    </div>
  );
};

export const SettingsModal: React.FC<ModalProps> = ({ isOpen, onClose }) => {
  const state = useGameStore((s) => s.state);
  const setNotation = useGameStore((s) => s.setNotation);
  const toggleMute = useGameStore((s) => s.toggleMute);
  const setReducedMotion = useGameStore((s) => s.setReducedMotion);
  const importSaveData = useGameStore((s) => s.importSaveData);
  const resetGame = useGameStore((s) => s.resetGame);
  // Все пути закрытия (скрим, ✕, Esc из хука, удачные импорт/сброс) идут через один
  // запрос: мгновенного onClose больше нет ни на одном пути.
  const { closing, requestClose } = useModalExit(isOpen, onClose);
  const cardRef = useDialogFocus<HTMLDivElement>(isOpen, requestClose);

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
      requestClose();
    } else {
      setErrorMsg('Неверный код сохранения!');
    }
  };

  const handleReset = () => {
    if (window.confirm(
        'Сбросить весь прогресс? Токены, агенты, апгрейды и Compute пропадут навсегда. Отменить это нельзя.',
      )) {
      resetGame();
      requestClose();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--bg-scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '16px',
        // Вход — существующий toast-fade, выход — тот же кадр в реверсе (только opacity,
        // поэтому при reducedMotion картина та же, нового CSS ноль).
        animation: closing ? MODAL_EXIT_ANIMATION : 'toast-fade 0.18s ease-out',
      }}
      onClick={requestClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="pixel-card"
        style={{
          width: '100%',
          maxWidth: '500px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px',
          gap: '16px',
          animation: closing ? MODAL_EXIT_ANIMATION : 'toast-fade 0.18s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 id="settings-title" style={{ fontSize: '1.3rem', color: 'var(--text-main)' }}>
            <Icon name="settings" /> НАСТРОЙКИ
          </h2>
          <button
            className="pixel-btn"
            onClick={requestClose}
            aria-label="Закрыть"
            title="Закрыть"
            style={{ padding: '4px 10px' }}
          >
            ✕
          </button>
        </div>

        {/* Настройка нотации чисел */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>Формат больших чисел</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              1,23 M или 1.23e6
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
            <Icon name={state.settings.muted ? 'sound-off' : 'sound-on'} />{' '}
            {state.settings.muted ? 'выключен' : 'включен'}
          </button>
        </div>

        {/* Настройка анимации */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>Меньше анимации</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Выключает движение в игре
            </div>
          </div>
          <button
            onClick={() => setReducedMotion(!state.settings.reducedMotion)}
            className={`pixel-btn ${state.settings.reducedMotion ? 'pixel-btn-accent' : ''}`}
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
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

          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
            <input
              type="text"
              placeholder="Вставь код сохранения..."
              value={importCode}
              onChange={(e) => setImportCode(e.target.value)}
              style={{
                flex: 1,
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text-main)',
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
          {errorMsg && <div style={{ color: 'var(--red)', fontSize: '0.8rem' }}>{errorMsg}</div>}
        </div>

        {/* Полный сброс */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
          <button
            onClick={handleReset}
            className="pixel-btn"
            style={{
              width: '100%',
              backgroundColor: 'var(--tint-red)',
              borderColor: 'var(--red)',
              // Светлее --red намеренно: на собственной красной подложке --red даёт 3.43:1
              // и подпись тонет в заливке.
              color: '#fca5a5',
            }}
          >
            Сбросить весь прогресс
          </button>
        </div>
      </div>
    </div>
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
  const cardRef = useDialogFocus<HTMLDivElement>(offlineReport !== null, requestClose, false);

  if (!offlineReport) return null;

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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--bg-scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: '16px',
        // Вход — существующий toast-fade, выход — тот же кадр в реверсе (только opacity,
        // поэтому при reducedMotion картина та же, нового CSS ноль).
        animation: closing ? MODAL_EXIT_ANIMATION : 'toast-fade 0.2s ease-out',
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="offline-title"
        className="pixel-card"
        style={{
          width: '100%',
          maxWidth: '520px',
          maxHeight: '85vh',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '14px',
          border: '2px solid var(--accent-color)',
          animation: closing ? MODAL_EXIT_ANIMATION : 'toast-fade 0.2s ease-out',
        }}
      >
        <div style={{ fontSize: '3rem', lineHeight: 1 }}>
          <Icon name="bolt" size={40} />
        </div>
        <h2 id="offline-title" style={{ fontSize: '1.4rem', color: 'var(--accent-color)' }}>
          С ВОЗВРАЩЕНИЕМ!
        </h2>

        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          Пока ты отдыхал (
          <span style={{ color: 'var(--gold)', fontWeight: 700 }}>
            {formatDuration(offlineReport.seconds)}
          </span>
          ), твои ИИ-Агенты усердно трудились и заработали:
        </div>

        <div
          style={{
            fontSize: '2rem',
            color: 'var(--green)',
            // Ореол остаётся литералом: --tint-green — это 10% подложка, а свечению нужно 50%.
            textShadow: '0 0 10px rgba(74, 222, 128, 0.5)',
          }}
        >
          +<Num>{formatNumber(offlineReport.earned, notation)}</Num> Токенов
        </div>

        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            textAlign: 'left',
            // minHeight: 0 обязателен: у флекс-элемента автоматический минимум равен
            // содержимому, и без него разбор не сжимался бы, а выпирал из-под кнопки.
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
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

        <button
          onClick={requestClose}
          className="pixel-btn pixel-btn-accent"
          style={{ width: '100%', padding: '12px', fontSize: '1.1rem', marginTop: '6px', flexShrink: 0 }}
        >
          Забрать Токены!
        </button>
      </div>
    </div>
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
  const state = useGameStore((s) => s.state);
  // Хуки стоят до раннего выхода, иначе окно то ловило бы Esc, то нет. Выход — тем же
  // closing-путём, что и у остальных окон: мгновенный dismiss возвращал бы карточку в DOM
  // без последнего кадра анимации.
  const { closing, requestClose } = useModalExit(isOpen, dismiss);
  const cardRef = useDialogFocus<HTMLDivElement>(isOpen, requestClose);
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
    triggerPrestige();
    dismiss();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--bg-scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: '16px',
        // Вход — существующий toast-fade, выход — тот же кадр в реверсе (только opacity,
        // поэтому при reducedMotion картина та же, нового CSS ноль).
        animation: closing ? MODAL_EXIT_ANIMATION : 'toast-fade 0.2s ease-out',
      }}
      onClick={requestClose}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prestige-title"
        className="pixel-card"
        style={{
          width: '100%',
          maxWidth: '520px',
          maxHeight: '85vh',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          border: '2px solid var(--gold)',
          animation: closing ? MODAL_EXIT_ANIMATION : 'toast-fade 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          {/* Без pixel-font: в заголовке есть кириллица, а по ADR-0003 пиксельный шрифт
              допустим только на строках без неё. */}
          <h2 id="prestige-title" style={{ fontSize: '1.3rem', color: 'var(--gold)' }}>
            <span aria-hidden="true">🚀</span> ПРЕСТИЖ
          </h2>
          <button
            className="pixel-btn"
            onClick={requestClose}
            aria-label="Закрыть"
            title="Закрыть"
            style={{ padding: '4px 10px' }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            // minHeight: 0 обязателен: без него флекс-элемент не сожмётся ниже своего
            // содержимого и окно выпирало бы за 85vh на низком экране.
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
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
                color: '#fca5a5',
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

        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button className="pixel-btn" onClick={requestClose} style={{ flex: 1, padding: '12px' }}>
            Отмена
          </button>
          <button
            onClick={handleConfirm}
            disabled={preview.blocked}
            className="pixel-btn pixel-btn-gold"
            style={{ flex: 2, padding: '12px' }}
          >
            {preview.blocked
              ? finale
                ? 'Финал контента'
                : 'Нужен Агент Флагмана'
              : 'Сделать Престиж!'}
          </button>
        </div>
      </div>
    </div>
  );
};
