import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motionAllowed, useGameStore, type ToastMessage } from '../store/useGameStore';
import { Icon } from './Icon';
import { Num } from './Num';

const TOAST_MS = 4000;

// Стопка растёт вверх от низа экрана и лежит поверх колонки Клика, поэтому верхняя карточка
// на невысоком экране доходит до счётчика Токенов и кнопки «Отправить промпт» — ровно до
// того, ради чего игрок смотрит на уведомление. Две карточки, а не три: карточка занимает
// 78 px (4 рамки + 24 отступа + три строки текста), и на телефоне в 667 px стопка из трёх
// вместе с кнопкой очереди поднимается примерно на 330 px от низа — над 132 px отступа
// под подвалом и табами это оставляет видимыми меньше 200 px игры, и Клик оказывается под
// стопкой. Две карточки — около 200 px, и счётчик Токенов с кнопкой остаются открытыми.
//
// Молча выбрасывать хвост нельзя: Достижения остаются в модальном окне и в счётчике в шапке,
// но игрок должен видеть, что список не кончился. За это отвечает уже существующая кнопка
// «ещё N» — вторая очередь не заводится.
const VISIBLE_TOASTS = 2;

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

const ToastItem: React.FC<{ toast: ToastMessage; onRemove: (id: string) => void; isNewest?: boolean }> = ({
  toast,
  onRemove,
  isNewest,
}) => {
  const [leaving, setLeaving] = useState(false);

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
      data-toast-id={toast.id}
      data-toast-newest={isNewest ? 'true' : undefined}
      className={`pixel-card toast-card${leaving ? ' toast-card--out' : ''}`}
      style={{
        padding: '10px 12px',
        backgroundColor: 'var(--bg-card)',
        border: '2px solid var(--gold)',
        // Тень на переменной темы, а не на литерале: карточка висит поверх живой игры, и
        // оторвать её от фона должен размытый контур, а не альфа. Тот же приём, что у
        // .pixel-card, только мягче и глубже.
        boxShadow: '0 6px 18px var(--tint-strong)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: 'pointer',
        width: '320px',
        maxWidth: 'calc(100vw - 40px)',
        boxSizing: 'border-box',
      }}
    >
      <Icon name="trophy" size={22} />
      {/* Достижение объявляется голосом: карточка появляется мимо чтения заголовка, и без
          живой области скринридер о ней не узнает вовсе. role=status — это уже
          aria-live=polite, то есть сообщение не перебивает то, что игрок слушает сейчас.

          Область стоит на тексте, а не на всей карточке: иначе в каждое объявление попадала бы
          и кнопка закрытия («Закрыть уведомление, кнопка»), и слушатель узнавал бы про кнопку
          вместо Достижения.

          Про повтор, которого нет. Тост, рождённый только что сделанным действием (пойманное
          Событие, лопнувший Глюк, пойманный Слух), частично повторяет то, что скринридер
          только что прочёл с самой кнопки: у кнопки ловли События есть aria-describedby на
          строку эффекта. Повторяется формулировка, но не факт — в тосте названа выплата и
          само подтверждение, и больше их нет нигде. Подавлять такое объявление нечем:
          ToastMessage не знает, какое действие его вызвало, а список заголовков тостов стал бы
          вторым источником правды, который молча перестанет работать на первом же новом тосте.
          Assertive тоже не подходит: Достижения в игре сыплются часто, и прерывание речи
          каждые несколько секунд хуже молчания. */}
      <div role="status" style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--gold)' }}>{toast.title}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 600 }}>
          {toast.name}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{toast.desc}</div>
      </div>
      {/* Видимая кнопка закрытия: автозакрытие и клик по карточке остаются, но ждать четыре
          секунды, чтобы убрать тост, игрок не обязан. stopPropagation обязателен — иначе нажатие
          дополнительно уйдёт в обработчик карточки и уведёт её на выход кадром, который
          никто не запускал.

          Кнопка отвечает и за нажатие по самой карточке, которая фокус не получает ни при
          каком раскладе: закрыть тост можно с клавиатуры, поэтому недостижимости действия
          нет, а второй останов в обход Tab только путал бы переход по странице. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          dismiss();
        }}
        className="pixel-btn"
        aria-label="Закрыть уведомление"
        title="Закрыть"
        style={{ padding: '2px 6px', flexShrink: 0 }}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
};

export const Toasts: React.FC = () => {
  const toasts = useGameStore((s) => s.toasts);
  const removeToast = useGameStore((s) => s.removeToast);
  const burst = useGameStore((s) => s.burst);
  const stackRef = useRef<HTMLDivElement>(null);
  const [fan, setFan] = useState<{ id: number; x: number; y: number } | null>(null);

  // Обрезаем хвост, а не начало: стопка прижата к низу экрана, поэтому её последний
  // элемент — самый свежий, и именно он должен остаться на виду. Порядок внутри
  // оставшихся не трогаем: счётчик веера берёт последнюю карточку как метку о Достижении.
  const visible = toasts.slice(-VISIBLE_TOASTS);
  const queuedToasts = toasts.slice(0, -VISIBLE_TOASTS);
  const queued = queuedToasts.length;

  useEffect(() => {
    if (burst?.kind !== 'achievement') return;
    if (!motionAllowed()) return;
    // Якорь — свежайшая карточка в стопке: именно на карточку Достижения летят искры,
    // а не на счётчик очереди или случайный соседний узел.
    const card =
      stackRef.current?.querySelector('[data-toast-newest="true"]') ??
      stackRef.current?.querySelector('.toast-card');
    const rect = card instanceof HTMLElement ? card.getBoundingClientRect() : null;
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
      {/* Стопка переехала в левый нижний угол: правый нижний закрывал карточки магазина —
          то самое место, ради которого игрок смотрит на тост. Слева внизу у колонки Клика
          живёт только чат, а интерактивных элементов там нет.

          Отступ снизу перекрывает подвал на широком экране; в одноколоночном режиме
          сток поднимает `.toast-stack` в index.css, иначе тост ложился бы на табы. */}
      {/* Стопка прижата к левому нижнему краю. Используем column-reverse:
          самый старый видимый тост стабильно лежит внизу у базы (bottom: 72px / 132px),
          а новые карточки и кнопка очереди аккуратно ложатся поверх. Ранее при column
          каждый новый входящий тост внизу отталкивал всю стопку вверх, вызывая скачки
          высоты и дёрганье экрана для читающего игрока. */}
      <div
        ref={stackRef}
        className="toast-stack"
        style={{
          position: 'fixed',
          left: '20px',
          display: 'flex',
          flexDirection: 'column-reverse',
          gap: '8px',
          zIndex: 100,
        }}
      >
        {/* Достижение — событие, а не украшение: без живой области скринридер о нём не
            узнает вообще, ведь оно появляется мимо чтения заголовка. Область живёт на
            самой карточке, а не на общем узле стопки: счётчик очереди тогда не попадает
            в неё и не объявляет «ещё 2» поверх самого Достижения. */}
        {visible.map((t, idx) => (
          <ToastItem
            key={t.id}
            toast={t}
            onRemove={removeToast}
            isNewest={idx === visible.length - 1}
          />
        ))}

        {/* Хвост очереди виден, но не занимает место: счётчик не перекрывает колонку,
            а игрок понимает, что Достижения ещё предъявят. В column-reverse он встаёт
            наверху стопки и не толкает уже показанные тосты. Он же и кнопка закрытия
            очереди — молчаливый хвост выглядел бы как зависшая игра. */}
        {queued > 0 && (
          <button
            onClick={() => queuedToasts.forEach((t) => removeToast(t.id))}
            className="pixel-btn"
            style={{ alignSelf: 'flex-start', padding: '4px 10px', fontSize: '0.8rem' }}
            // Подпись «ещё 2» сама по себе не говорит, что это кнопка и что её нажатие
            // убирает очередь: без этих подсказок она читалась бы как текст, а не как
            // действие, — особенно тем, кто слушает, а не смотрит.
            title="Убрать оставшиеся уведомления"
            aria-label={`Убрать оставшиеся уведомления: ${queued}`}
          >
            ещё <Num>{queued}</Num>
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
