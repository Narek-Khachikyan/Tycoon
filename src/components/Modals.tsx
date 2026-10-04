import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { ACHIEVEMENTS } from '../economy/achievements';
import { GLOSSARY } from '../data/glossary';
import { PERKS } from '../economy/perks';
import { exportSave } from '../economy/save';
import { formatCount, formatDuration, formatNumber } from '../economy/format';
import { CATALOG } from '../economy/catalog';
import { computeShortfall, prestigeGain } from '../economy/engine';
import { Icon } from './Icon';
import { Num } from './Num';
import { useDialogFocus } from './useDialogFocus';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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
            <Icon name="trophy" /> ДОСТИЖЕНИЯ ({state.achievements.length} / {ACHIEVEMENTS.length})
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
          {ACHIEVEMENTS.map((a) => {
            const unlocked = unlockedSet.has(a.id);
            return (
              <div
                key={a.id}
                style={{
                  backgroundColor: unlocked ? 'var(--tint-green)' : 'var(--bg-card)',
                  border: unlocked ? '1px solid var(--green)' : '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div aria-hidden="true" style={{ fontSize: '1.5rem' }}>{unlocked ? '🏆' : '🔒'}</div>
                <div style={{ flex: 1 }}>
                  <div
                    /* Светлее --green намеренно: так открытое Достижение читается ярче
                       закрытой строки, а --green на подложке сравнялся бы с --text-muted
                       соседнего описания. */
                    style={{
                      fontSize: '0.95rem',
                      color: unlocked ? '#86efac' : 'var(--text-muted)',
                    }}
                  >
                    {a.name}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{a.desc}</div>
                </div>
              </div>
            );
          })}
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
        <Num key="toNext">{formatNumber(toNextUnit, notation)}</Num>{' '}
        {formatCount(Math.round(toNextUnit), 'Токен', 'Токена', 'Токенов')}
      </>,
    ],
    ['Событий выпало', <Num key="eventsSeen">{formatNumber(state.eventsSeen, notation)}</Num>],
    ['Глюков пришло в офис', <Num key="glitchSeq">{formatNumber(state.glitchSeq, notation)}</Num>],
    ['Кристаллов в запасе', <Num key="crystals">{formatNumber(state.crystals, notation)}</Num>],
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
          {/* План Престижа. Одно предложение вместо ещё трёх строк: строки выше дают числа,
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
  const notation = useGameStore((s) => s.state.settings.notation);
  // Esc здесь не закрывает: игрок должен забрать начисленное и увидеть сумму, поэтому окно
  // закрывается только своей кнопкой. Кнопка идёт через тот же closing-путь, что и
  // остальные окна: мгновенного dismiss больше нет.
  const { closing, requestClose } = useModalExit(offlineReport !== null, dismiss);
  const cardRef = useDialogFocus<HTMLDivElement>(offlineReport !== null, requestClose, false);

  if (!offlineReport) return null;

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
          maxWidth: '440px',
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

        <button
          onClick={requestClose}
          className="pixel-btn pixel-btn-accent"
          style={{ width: '100%', padding: '12px', fontSize: '1.1rem', marginTop: '6px' }}
        >
          Забрать токены!
        </button>
      </div>
    </div>
  );
};
