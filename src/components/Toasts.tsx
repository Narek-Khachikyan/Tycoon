import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motionAllowed, useGameStore, type ToastMessage } from '../store/useGameStore';
import { TOAST_MARGIN, toastStackWidth } from '../layout';
import { Icon } from './Icon';
import { Num } from './Num';
import { useT } from '../i18n/useT';

const TOAST_MS = 4000;

// Стопка растёт вверх от кнопки Клика, поэтому девять Достижений разом занимали
// весь левый столбец и накрывали логотип, счётчик Токенов и кнопку Клика —
// то есть ровно те элементы, ради которых игрок смотрит на уведомление.
// Показываем только свежие, а длину очереди передаём счётчиком: молча выбрасывать
// Достижения нельзя, они остаются в модальном окне и в счётчике в шапке, но игрок
// должен видеть, что список не кончился.
//
// Верхняя граница: сколько карточек вообще имеет смысл показывать. Реальное количество
// считается из измеренной полосы (см. `useStackBand`) и почти всегда оказывается меньше.
const VISIBLE_TOASTS = 2;

/** Зазор между стопкой и её нижней границей, полосой Клика и зазором между карточками. */
const TOAST_GAP = 8;

// 24 искры вокруг Достижения. Угол и дальность разводит золотой угол: по равномерной сетке
// веер встаёт в правильную розетку и читается как гирлянда, а не как вспышка.
const FAN_COUNT = 24;
const FAN = Array.from({ length: FAN_COUNT }, (_, i) => {
  const angle = (i * 2.399963) % (Math.PI * 2);
  const dist = 34 + ((i * 7) % 11) * 5;
  return { dx: Math.round(Math.cos(angle) * dist), dy: Math.round(Math.sin(angle) * dist), size: 4 + (i % 3) };
});

let fanCounter = 0;

/**
 * Одноразовая CSS-анимация, которая обязана довести элемент до конца.
 *
 * Снимает элемент только кадр анимации, и прерванная анимация кадра не порождает: правила
 * `[data-motion='reduced'] .toast-card--out { animation: none }` и
 * `[data-motion='reduced'] .burst-particle { animation: none }` при смене настройки на ходу
 * убивают идущую анимацию, а animationend после отмены не наступает уже никогда — карточка
 * (а с веером это ещё и слой `inset: 0` поверх всей игры) остаётся в DOM до конца сессии.
 *
 * Каналов три, таймеров нет:
 *   1. animationend — анимация дошла до конца;
 *   2. animationcancel — её сняли, то есть её больше не будет. Слушатель нативный: React 19
 *      не знает про это событие (свойства onAnimationCancel в типах нет), а по кольцу оно
 *      приходит ещё и от каждой искры веера, что и нужно — снимать веер целиком;
 *   3. настройка игрока, прочитанная из магазина: она меняется в том же коммите, что и
 *      data-motion, и потому снимает элемент раньше, чем браузер применит новые стили.
 *
 * Канала 1 в одиночку мало и потому, что системное «уменьшить движение» меняется без
 * действия игрока: магазин о нём не узнаёт, и событие от CSS остаётся единственным сигналом.
 *
 * Имя анимации нужно по делу: у карточки одновременно идут toast-in на ней самой и toast-flash
 * на ::before, и отменяются они тем же событием, что и toast-out.
 */
function useOneShot(started: boolean, name: string, settle: () => void) {
  const reducedMotion = useGameStore((s) => s.state.settings.reducedMotion);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (started && reducedMotion) settle();
  }, [started, reducedMotion, settle]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !started) return;
    const onCancel = (e: AnimationEvent) => {
      if (e.animationName === name) settle();
    };
    node.addEventListener('animationcancel', onCancel);
    return () => node.removeEventListener('animationcancel', onCancel);
  }, [started, name, settle]);

  // Кадр отбирается по имени анимации, а не по факту её окончания: входная анимация карточки
  // завершается раньше, и снимать по ней элемент нельзя.
  const onAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.animationName === name) settle();
  };

  return { ref, onAnimationEnd };
}

const ToastItem: React.FC<{ toast: ToastMessage; onRemove: (id: string) => void }> = ({
  toast,
  onRemove,
}) => {
  const [leaving, setLeaving] = useState(false);
  const t = useT();

  // Выходной кадр ставится только при разрешённом движении: без анимации тост обязан уйти
  // сразу, иначе animationend не наступит и карточка останется на экране навсегда.
  const dismiss = () => {
    if (motionAllowed()) setLeaving(true);
    else onRemove(toast.id);
  };

  const settle = useCallback(() => onRemove(toast.id), [onRemove, toast.id]);
  const { ref, onAnimationEnd } = useOneShot(leaving, 'toast-out', settle);

  useEffect(() => {
    const timer = setTimeout(dismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  // Название и описание приезжают в тосте текстом, а не id. Раньше компонент сам искал запись
  // в ACHIEVEMENTS, и теневой id — а он в другой таблице — выводился бы на экран как есть.
  return (
    <div
      ref={ref}
      onClick={dismiss}
      onAnimationEnd={onAnimationEnd}
      className={`pixel-card toast-card${leaving ? ' toast-card--out' : ''}`}
      style={{
        padding: '12px 14px',
        backgroundColor: 'var(--bg-card)',
        border: '2px solid var(--gold)',
        // Тень остаётся литералом и вдвое гуще карточной: тост висит поверх живой игры,
        // а --tint-strong у .pixel-card рассчитан на фон, лежащий сразу под панелью.
        boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: 'pointer',
        // Карточка не шире стека: сам стек уже ограничен расчётом колонок
        // (см. `toastStackWidth`), а здесь предел — доля, а не пиксели, иначе на
        // 320 px замороженное число снова увело бы правый край за экран.
        maxWidth: '100%',
        // Длинная строка обязана переноситься внутри карточки: горизонтальной
        // прокрутки в игре нет, и обрезанный текст было бы не доскроллить.
        overflowWrap: 'break-word',
        minWidth: 0,
      }}
    >
      <Icon name="trophy" size={22} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--gold)' }}>{t(toast.title)}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 600 }}>
          {t(toast.name)}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t(toast.desc)}</div>
      </div>
      {/* Видимая кнопка закрытия: автозакрытие и клик по карточке остаются, но ждать четыре
          секунды, чтобы убрать тост, игрок не обязан. stopPropagation обязателен — иначе нажатие
          дополнительно уйдёт в обработчик карточки и уведёт её на выход кадром, который
          никто не запускал. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          dismiss();
        }}
        className="pixel-btn"
        aria-label={t("Закрыть уведомление")}
        title={t("Закрыть")}
        style={{ padding: '2px 6px', fontSize: '0.8rem', flexShrink: 0 }}
      >
        ✕
      </button>
    </div>
  );
};

/**
 * Где стопке стоять и сколько в неё влезает.
 *
 * Раньше здесь стояло число в CSS (`bottom: 380px`), и оно перестало совпадать с колонкой:
 * при высоте окна 900 нижний край стопки оказывался на 25 px ВНУТРИ кнопки Клика, а сама
 * стопка закрывала две трети шкалы Температуры. Магическое число не может быть правильным на
 * всех раскладках — их четыре, и колонка растёт вместе с полосой Вех.
 *
 * Полоса, в которой стопка имеет право жить, — от низа счётчика Токенов до верха шкалы
 * Температуры. Верх полосы — именно низ счётчика, а не его верх: стопка, начинавшаяся ровно
 * на счётчике, перекрывала число Токенов и Доход целиком, а комментарий при этом объяснял
 * размещение заботой о магазине — то есть перекрытие задумано не было. Счётчик занимает
 * 93 px (число, подпись «Токенов», Доход и подсказка), карточка с трёхстрочным описанием —
 * 117 px, счётчик очереди — 32, зазоры — 8: две карточки в полосу не влезают, а одна
 * влезает с запасом. Поэтому количество видимых считается из полосы, а не задаётся: полоса
 * меняется вместе с раскладкой, длиной описания и появлением полосы Вех.
 *
 * Измеряется по событиям раскладки — `ResizeObserver` и изменение окна, — а не по таймеру:
 * собственный таймер здесь означал бы шестое место, где что-то перерисовывается двадцать раз
 * в секунду.
 */
const CARD_BUDGET = 128;

function useStackBand(): { top: number; slots: number; width: number } {
  const measure = React.useCallback((): { top: number; slots: number; width: number } | null => {
    const counter = document.querySelector<HTMLElement>('.click-counter');
    // Шкала — нижняя граница полосы. Если её нет (например, вкладка без колонки Клика),
    // нижней границей становится сама кнопка: накрывать её тоже нельзя.
    const floor = document.querySelector<HTMLElement>('[role="slider"]') ?? document.querySelector<HTMLElement>('.click-btn');
    if (!counter) return null;
    // Низ счётчика, а не верх: стопка живёт ПОД числом Токенов и Доходом, а не поверх них.
    const rect = counter.getBoundingClientRect();
    const top = Math.round(rect.bottom + TOAST_GAP);
    const floorTop = floor ? Math.round(floor.getBoundingClientRect().top) : window.innerHeight - 80;
    // Ширина — из расчёта колонок, а не замороженным числом: расчёт уже держит её в окне.
    const width = Math.round(toastStackWidth(window.innerWidth));
    return { top, slots: clamp(Math.floor((floorTop - top - TOAST_GAP) / CARD_BUDGET), 1, VISIBLE_TOASTS), width };
  }, []);

  const [band, setBand] = useState<{ top: number; slots: number; width: number } | null>(null);

  useEffect(() => {
    const update = () => setBand(measure());
    update();
    const counter = document.querySelector<HTMLElement>('.click-counter');
    const floor = document.querySelector<HTMLElement>('[role="slider"]') ?? document.querySelector<HTMLElement>('.click-btn');
    // Наблюдатель срабатывает и на изменение высоты окна, и на изменение высоты самой
    // колонки, то есть на оба случая, когда счётчик или шкала уезжают.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (ro) {
      ro.observe(document.documentElement);
      if (counter) ro.observe(counter);
      if (floor) ro.observe(floor);
    }
    window.addEventListener('resize', update);
    return () => { ro?.disconnect(); window.removeEventListener('resize', update) };
  }, [measure]);

  // До первого измерения показывается одна карточка: это самый осторожный выбор, и он же
  // переживает раскладку, где измерять нечего. Ширина до измерения — тоже из расчёта
  // колонок: первый кадр уже обязан помещаться в окно.
  return band ?? { top: 0, slots: 1, width: Math.round(toastStackWidth(typeof window === 'undefined' ? 0 : window.innerWidth)) };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const Toasts: React.FC = () => {
  const toasts = useGameStore((s) => s.toasts);
  const t = useT();
  const removeToast = useGameStore((s) => s.removeToast);
  const burst = useGameStore((s) => s.burst);
  const stackRef = useRef<HTMLDivElement>(null);
  const [fan, setFan] = useState<{ id: number; x: number; y: number } | null>(null);
  const band = useStackBand();

  // Обрезаем хвост, а не начало: последний элемент — самый свежий, и именно он должен
  // остаться на виду. Порядок внутри оставшихся не трогаем: счётчик веера берёт последнюю
  // карточку как метку о Достижении.
  const slots = band.slots;
  const visible = toasts.slice(-slots);
  const queuedToasts = toasts.slice(0, -slots);
  const queued = queuedToasts.length;

  useEffect(() => {
    if (burst?.kind !== 'achievement') return;
    if (!motionAllowed()) return;
    // Якорь — свежайшая карточка в стопке: она и есть отметка о Достижении, на неё и летят
    // искры. Именно карточка, а не последний узел: когда хвост очереди не пуст, последним
    // узлом стоит счётчик «ещё N», и веер вылетал бы из-под него, то есть из цифры, а не
    // из Достижения, ради которого он и появляется.
    const cards = stackRef.current?.querySelectorAll<HTMLElement>('.toast-card');
    const card = cards && cards.length ? cards[cards.length - 1] : null;
    const rect = card && card.getBoundingClientRect();
    setFan({
      id: ++fanCounter,
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    });
  }, [burst?.nonce]);

  // Веер снимается целиком: у искр одна и та же анимация без задержки, поэтому гаснут они
  // одним кадром и ждать последнюю отдельно незачем. Гасит его useOneShot — иначе отмена
  // анимации оставила бы слой `inset: 0` висеть до конца сессии.
  const stopFan = useCallback(() => setFan(null), []);
  const { ref: fanRef, onAnimationEnd: onFanEnd } = useOneShot(fan !== null, 'burst-fly', stopFan);

  if (toasts.length === 0 && !fan) return null;

  return (
    <>
      {/* Стопка начинается под счётчиком Токенов и идёт вниз. Правый нижний угол закрывал карточки
          магазина — то самое место, ради которого игрок смотрит на тост.

          `top` и количество карточек приходят из измерения (см. `useStackBand`), а не из CSS:
          колонка растёт вместе с полосой Вех, и число в таблице стилей рано или поздно перестаёт
          совпадать с ней. Пока измерения ещё не было, положение задаёт .toast-stack в index.css —
          это первый кадр, а не рабочее состояние. */}
      <div
        ref={stackRef}
        className="toast-stack"
        style={{
          position: 'fixed',
          left: `${TOAST_MARGIN}px`,
          // Ширина по левой колонке, а не во всю окно: тост, растянувшийся под магазин,
          // снова закрыл бы карточки, ради которых игрок его и читает. Число — из расчёта
          // колонок (см. `toastStackWidth`), а страховка держит стек в окне, даже если окно
          // успели сузить между измерением и кадром.
          width: `${band.width}px`,
          maxWidth: `calc(100vw - ${TOAST_MARGIN * 2}px)`,
          top: band.top || undefined,
          // `bottom` обязан быть снят: вместе с `top` оба бы растянули стопку на весь экран,
          // и стопка накрыла бы всё, включая шкалу.
          bottom: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: `${TOAST_GAP}px`,
          zIndex: 100,
        }}
      >
        {visible.map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={removeToast} />
        ))}

        {/* Хвост очереди виден, но не занимает место: счётчик не перекрывает колонку,
            а игрок понимает, что Достижения ещё предъявят. Он же и кнопка закрытия
            очереди — молчаливый хвост выглядел бы как зависшая игра. */}
        {queued > 0 && (
          <button
            onClick={() => queuedToasts.forEach((t) => removeToast(t.id))}
            className="pixel-card"
            style={{
              alignSelf: 'flex-start',
              padding: '6px 10px',
              backgroundColor: 'var(--bg-card)',
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {t('ещё')} <Num>{queued}</Num>
          </button>
        )}
      </div>

      {fan && (
        <div className="burst-layer" ref={fanRef} onAnimationEnd={onFanEnd}>
          {FAN.map((p, i) => (
            <span
              key={`${fan.id}-${i}`}
              className="burst-particle"
              style={
                {
                  left: fan.x,
                  top: fan.y,
                  width: p.size,
                  height: p.size,
                  '--burst-dx': `${p.dx}px`,
                  '--burst-dy': `${p.dy}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
    </>
  );
};
