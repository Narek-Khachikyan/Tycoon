import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { motionAllowed, reduceMotionMedia, useGameStore } from '../store/useGameStore';
import { totalIncome, clickValue, nextAgentCost, shortfall } from '../economy/engine';
import { formatCount, formatNumber } from '../economy/format';
import { Num } from './Num';
import { Icon } from './Icon';
import { GoldenToken } from './GoldenToken';

/** За сколько миллисекунд счётчик съедает 63% расстояния до цели: каждый кадр отнимает
 *  долю dt / APPROACH_MS остатка, поэтому число тормозит, а не разгоняется, и скорость
 *  не зависит от частоты кадров. */
const APPROACH_MS = 55;

export const ClickColumn: React.FC<{ full?: boolean }> = ({ full = false }) => {
  const state = useGameStore((s) => s.state);
  const clickPrompt = useGameStore((s) => s.clickPrompt);
  const floaters = useGameStore((s) => s.floaters);
  const chatHistory = useGameStore((s) => s.chatHistory);
  const btnRef = useRef<HTMLButtonElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Свежая пара лежит первой, поэтому якорь — это ноль прокрутки, а не конец списка.
  const newestReplyId = chatHistory[0]?.id;
  useEffect(() => {
    chatRef.current?.scrollTo({ top: 0 });
  }, [newestReplyId]);

  const income = totalIncome(state);
  const cVal = clickValue(state, income);
  const notation = state.settings.notation;
  const reducedMotion = state.settings.reducedMotion;

  const counterRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef(state.tokens);
  const shownRef = useRef(state.tokens);

  // Счётчик живёт вне React: колонки перерисовываются каждый тик, и любое значение,
  // проведённое через состояние, копилось бы в очередь ререндеров вместо отрисовки.
  // Узел при этом рендерится пустым — иначе React затрёт написанное в textContent
  // своими детьми на каждом тике.
  useLayoutEffect(() => {
    const node = counterRef.current;
    if (!node) return;

    let painted = '';
    const paint = (value: number) => {
      const text = formatNumber(value, notation);
      if (text !== painted) {
        node.textContent = text;
        painted = text;
      }
    };

    // motionAllowed() дёргает matchMedia на каждом вызов, поэтому кадр читает кэш, а сам
    // кэш пересчитывается при смене системной настройки: настройка игрока пересобирает
    // эффект, система — стреляет в слушатель ниже.
    let allowed = motionAllowed();
    // Список берётся из магазина, а не создаётся здесь заново: литерал запроса и правило
    // «настройка нечитаема, значит движения нет» живут в одном месте. null — тот же ответ,
    // что allowed === false, и слушать в нём нечего, так что guard честнее заглушки.
    const media = reduceMotionMedia();

    let last = performance.now();
    let frame = 0;

    const step = (now: number) => {
      frame = 0;
      const target = targetRef.current;
      const shown = shownRef.current;
      if (shown >= target || !allowed) {
        // Цель ушла вниз (Престиж, Импорт, сброс) или движение выключено — системой или
        // настройкой: показываем ровно её, не пересчитывая вниз через весь ряд.
        shownRef.current = target;
        paint(target);
        return;
      }
      const next = shown + (target - shown) * (1 - Math.exp(-(now - last) / APPROACH_MS));
      // Как только строка совпала, показанное значение выравнивается по цели: около
      // 1e300 прибавка тонет в мантиссе и интерполяция иначе не завершилась бы.
      const settled = formatNumber(next, notation) === formatNumber(target, notation);
      shownRef.current = settled ? target : next;
      paint(shownRef.current);
      last = now;
      // Совпало — цикл встаёт: рисовать больше нечего, а новая цель поднимет его сама.
      if (!settled) frame = requestAnimationFrame(step);
    };

    const start = () => {
      if (frame !== 0) return;
      last = performance.now();
      frame = requestAnimationFrame(step);
    };

    paint(allowed ? shownRef.current : targetRef.current);
    start();

    // Новая цель приходит из стора, а не из рендера: тик зовёт подписчика двадцать раз
    // в секунду, как и разовые set (Клик, Престиж, Импорт), а state.tokens в
    // зависимостях пересобирал бы цикл на каждом тике — дороже, чем сам цикл.
    const unsubscribe = useGameStore.subscribe((s) => {
      if (s.state.tokens === targetRef.current) return;
      targetRef.current = s.state.tokens;
      start();
    });

    // Выключение обязано показать цель сразу, а не последним интерполированным кадром;
    // включению догонять нечего — при выключенном движении показанное уже равно цели.
    const recheck = () => {
      allowed = motionAllowed();
      start();
    };
    media?.addEventListener('change', recheck);

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      media?.removeEventListener('change', recheck);
    };
  }, [notation, reducedMotion]);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + (Math.random() * 40 - 20);
    const y = rect.top + 10;
    clickPrompt(x, y);
    // Перезапуск сквоша тем же сбросом, что у ModelRow: снятие класса и чтение ширины
    // между снятием и возвратом, иначе быстрый повторный Клик не перезапустил бы анимацию.
    const node = btnRef.current;
    if (!node) return;
    node.classList.remove('click-btn--squash');
    void node.offsetWidth;
    node.classList.add('click-btn--squash');
  };

  // Снятие по концу анимации, а не по таймеру: таймеры в компонентах запрещены.
  const handleSquashEnd = () => {
    btnRef.current?.classList.remove('click-btn--squash');
  };

  // Прогресс до ближайшей покупки Агента: цена приходит из движка, компонент только делит.
  const nextCost = nextAgentCost(state);
  const missing = shortfall(nextCost, state.tokens);
  const progress = nextCost > 0 ? Math.min(1, state.tokens / nextCost) : 0;
  const canHire = nextCost > 0 && state.tokens >= nextCost;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '20px 16px',
        backgroundColor: 'var(--bg-panel)',
        borderRight: '2px solid var(--border)',
        // Базис приходит из модуля раскладки, а не из содержимого колонки: раньше ширина была
        // min/max по содержимому, и переключение вкладки магазина дёргало всю сетку.
        // В одноколоночном режиме колонка единственная и занимает всю ширину.
        flex: full ? '1 1 auto' : '0 0 var(--col-click)',
        minWidth: 0,
        gap: '18px',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* Floating numbers */}
      {floaters.map((f) => (
        <div key={f.id} className="floater" style={{ left: f.x, top: f.y }}>
          {f.text}
        </div>
      ))}

      {/* Токены и Доход */}
      <div style={{ textAlign: 'center', width: '100%' }}>
        {/* Пустой узел: текст сюда пишет только requestAnimationFrame, и любой ререндер
            React затирал бы его своими детьми на каждом тике. */}
        <div
          ref={counterRef}
          className="pixel-font"
          style={{
            fontSize: '2.2rem',
            fontWeight: 700,
            color: 'var(--accent-color)',
            lineHeight: 1.1,
            // nowrap плюс блочная коробка во всю ширину держат колонку: разряд больше не
            // перетекает весь столбец. Табличные цифры не заказаны — в Pixelify Sans нет
            // фичи tnum, см. пояснение в index.css.
            whiteSpace: 'nowrap',
            textShadow: '0 0 12px var(--accent-glow)',
          }}
        />
        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '2px' }}>
          Токенов
        </div>
        <div
          style={{
            fontSize: '1.1rem',
            color: 'var(--green)',
            marginTop: '8px',
            fontWeight: 600,
          }}
        >
          +<Num>{formatNumber(income, notation)}</Num> / сек
        </div>
        {/* Подсказка при нулевом Доходе: игрок без Агентов иначе видит голый «+0/сек»
            без следующего шага. Только текст, без анимаций. */}
        {income === 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Нанятый Агент приносит Доход сам — загляни в магазин
          </div>
        )}
      </div>

      {/* Золотой Токен: появляется на время окна события прямо над кнопкой Клика, чтобы
          находка попадала в ту же область взгляда, что и главное действие игры. Карточка
          монтируется и размонтируется вместе с окном, поэтому её появление и есть
          объявление. */}
      <GoldenToken />

      {/* Большая кнопка Клика */}
      <button
        ref={btnRef}
        onClick={handleClick}
        onAnimationEnd={handleSquashEnd}
        className="pixel-btn pixel-btn-accent pulse-glow"
        style={{
          width: '100%',
          padding: '24px 16px',
          fontSize: '1.25rem',
          borderRadius: '8px',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <Icon name="chat" size={30} />
        <span>Отправить промпт</span>
        <span
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-main)',
            fontWeight: 400,
          }}
        >
          +<Num>{formatNumber(cVal, notation)}</Num> Токенов за клик
        </span>
      </button>

      {/* Прогресс до ближайшей покупки Агента: сколько осталось до самой дешёвой Модели.
          При пустом кошельке первого запуска полоска нулевая, но подсказка уже стоит —
          пустой полоски без текста здесь не бывает. */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div
          role="progressbar"
          aria-label="Прогресс до следующей покупки"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          style={{
            width: '100%',
            height: '8px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: '100%',
              backgroundColor: 'var(--accent-color)',
              // Переход ширины — не движение: при reducedMotion остаётся, тряски и сдвига тут нет.
              transition: 'width 0.2s ease-out',
            }}
          />
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          {canHire ? (
            <>Можно нанять Агента — загляни в магазин</>
          ) : (
            <>
              До следующей покупки: не хватает <Num>{formatNumber(missing, notation)}</Num>{' '}
              {/* Нотация обязательна: форма считается по цифрам той же записи, что и число. */}
              {formatCount(missing, 'Токен', 'Токена', 'Токенов', notation)}
            </>
          )}
        </div>
      </div>

      {/* Чат-пузыри */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          marginTop: '6px',
          flex: 1,
        }}
      >
        <div style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>Диалог с моделью:</div>

        {/* Якорь на свежую реплику. Свежая пара кладётся сверху, поэтому после прихода она
            выталкивает прочитанное вниз и без якоря игрок вынужден искать её прокруткой.
            Ставится ровно на смену верхней пары: пока игрок читает старую, лента не дёргается
            под ногами. */}
        <div
          ref={chatRef}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            overflowY: 'auto',
            maxHeight: '340px',
            paddingRight: '4px',
          }}
        >
          {/* Только свежая обменная реплика: старые уже стоят на месте, и анимация на них
              давно доиграла. Класс на новой реплике появляется вместе с её узлом. */}
          {chatHistory.map((item, index) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                fontSize: '0.85rem',
              }}
            >
              {/* Промпт игрока */}
              <div
                className={index === 0 ? 'chat-prompt--in' : undefined}
                style={{
                  alignSelf: 'flex-end',
                  backgroundColor: 'var(--accent-solid-hover)',
                  color: 'var(--text-main)',
                  padding: '6px 10px',
                  borderRadius: '12px 12px 2px 12px',
                  maxWidth: '85%',
                  wordBreak: 'break-word',
                }}
              >
                {item.userPrompt}
              </div>

              {/* Ответ ИИ */}
              <div
                className={index === 0 ? 'chat-reply--in' : undefined}
                style={{
                  alignSelf: 'flex-start',
                  backgroundColor: 'var(--bg-card)',
                  color: 'var(--text-main)',
                  padding: '6px 10px',
                  borderRadius: '12px 12px 12px 2px',
                  border: '1px solid var(--border)',
                  maxWidth: '90%',
                  whiteSpace: 'pre-line',
                  wordBreak: 'break-word',
                }}
              >
                {item.aiResponse}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
