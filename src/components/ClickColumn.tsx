import React, { useLayoutEffect, useRef } from 'react';
import { useGameStore } from '../store/useGameStore';
import { totalIncome, clickValue } from '../economy/engine';
import { formatNumber } from '../economy/format';

/** За сколько миллисекунд счётчик съедает 63% расстояния до цели: каждый кадр отнимает
 *  долю dt / APPROACH_MS остатка, поэтому число тормозит, а не разгоняется, и скорость
 *  не зависит от частоты кадров. */
const APPROACH_MS = 55;

export const ClickColumn: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const clickPrompt = useGameStore((s) => s.clickPrompt);
  const floaters = useGameStore((s) => s.floaters);
  const chatHistory = useGameStore((s) => s.chatHistory);
  const btnRef = useRef<HTMLButtonElement>(null);

  const income = totalIncome(state);
  const cVal = clickValue(state, income);
  const notation = state.settings.notation;
  const reducedMotion = state.settings.reducedMotion;

  const counterRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef(state.tokens);
  const shownRef = useRef(state.tokens);

  useLayoutEffect(() => {
    targetRef.current = state.tokens;
  }, [state.tokens]);

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

    let last = performance.now();
    let frame = 0;
    paint(reducedMotion ? targetRef.current : shownRef.current);

    const step = (now: number) => {
      const target = targetRef.current;
      const shown = shownRef.current;
      if (reducedMotion || shown >= target) {
        // Цель ушла вниз (Престиж, Импорт, сброс) или движение выключено: показываем
        // ровно её, не пересчитывая вниз через весь ряд.
        shownRef.current = target;
        paint(target);
      } else {
        const next = shown + (target - shown) * (1 - Math.exp(-(now - last) / APPROACH_MS));
        // Как только строка совпала, показанное значение выравнивается по цели: около
        // 1e300 прибавка тонет в мантиссе и интерполяция иначе не завершилась бы.
        shownRef.current =
          formatNumber(next, notation) === formatNumber(target, notation) ? target : next;
        paint(shownRef.current);
      }
      last = now;
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [notation, reducedMotion]);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + (Math.random() * 40 - 20);
    const y = rect.top + 10;
    clickPrompt(x, y);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '20px 16px',
        backgroundColor: 'var(--bg-panel)',
        borderRight: '2px solid var(--border)',
        // Не даём колонке стать шире контейнера: на мобильном экране это обрезало бы правую часть.
        minWidth: 'min(320px, 100%)',
        maxWidth: '380px',
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
          className="pixel-font"
          style={{
            fontSize: '1.1rem',
            color: 'var(--green)',
            marginTop: '8px',
            fontWeight: 600,
          }}
        >
          +{formatNumber(income, notation)} / сек
        </div>
      </div>

      {/* Большая кнопка Клика */}
      <button
        ref={btnRef}
        onClick={handleClick}
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
        <span style={{ fontSize: '2rem' }}>💬</span>
        <span>Отправить промпт</span>
        <span
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-main)',
            fontWeight: 400,
            fontFamily: 'Nunito',
          }}
        >
          +{formatNumber(cVal, notation)} Токенов за клик
        </span>
      </button>

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
        <div
          className="pixel-font"
          style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}
        >
          Диалог с моделью:
        </div>

        <div
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
