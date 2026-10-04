import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { Icon } from './Icon';

// Сколько миллисекунд копия новости идёт мимо окна. Задаёт скорость ленты: за цикл дорожка
// проезжает ровно половину своей длины, то есть половину копий, поэтому время копии — это и
// есть скорость, и она не зависит ни от ширины окна, ни от длины новости.
const COPY_PASS_MS = 20000;

// Две копии — минимум по существу, а не по вкусу: цикл сдвигает дорожку на её половину,
// поэтому полоса не пустует только если дорожка длиннее двух окон.
const MIN_COPIES = 2;

// Наименьшее чётное число не меньше n: при нечётном сдвиг -50% попадал бы в середину копии,
// и на стыке цикла текст прыгал бы на половину новости.
const roundUpEven = (n: number) => Math.max(MIN_COPIES, Math.ceil(n / 2) * 2);

const NEWS_INTERVAL_MS = 15000;

export const NewsTicker: React.FC = () => {
  const news = useGameStore((s) => s.news);
  const refreshNews = useGameStore((s) => s.refreshNews);
  const paused = useGameStore((s) => s.newsPaused);
  const setPaused = useGameStore((s) => s.setNewsPaused);

  const viewportRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ copies: MIN_COPIES, cycleMs: COPY_PASS_MS });

  // Сколько копий нужно, решает только сама разметка: из CSS ширину окна не узнать, а без неё
  // полоса пустеет к концу цикла. Замер идёт по событиям — монтирование, смена новости,
  // изменение окна, — поэтому таймер здесь не нужен и опроса тоже. Меряется естественная ширина
  // текста (scrollWidth), а не ширина обрезанной копии, поэтому результат одинаков и под
  // настройкой игрока, где строка неподвижна и обрезана многоточием.
  useEffect(() => {
    const measure = () => {
      const viewport = viewportRef.current;
      const copy = trackRef.current?.firstElementChild;
      if (!(viewport instanceof HTMLElement) || !(copy instanceof HTMLElement)) return;
      const copyWidth = copy.scrollWidth;
      const copies = copyWidth > 0 ? roundUpEven((2 * viewport.clientWidth) / copyWidth) : MIN_COPIES;
      const cycleMs = (copies / 2) * COPY_PASS_MS;
      setLayout((prev) => (prev.copies === copies && prev.cycleMs === cycleMs ? prev : { copies, cycleMs }));
    };

    measure();
    // Шрифты приезжают после первого кадра и меняют ширину текста: без второго замера дорожка
    // осталась бы рассчитана на подменный шрифт, и лента пустовала бы первые пол-цикла.
    document.fonts.ready.then(measure);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [news]);

  // Единственный таймер в файле: он меняет текст, а движение задано transform в CSS. На паузе
  // таймер не идёт вовсе — иначе надпись под замершей строкой продолжала бы подменяться.
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      refreshNews();
    }, NEWS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshNews, paused]);

  // Пауза по наведению и по фокусу: игроку, которому мешает движение, не нужно искать кнопку.
  // Размытие ловится только когда фокус действительно ушёл из ленты, иначе переход между
  // соседними кнопками гасил бы паузу на каждом нажатии.
  const pause = () => setPaused(true);
  const resumeIfOutside = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setPaused(false);
  };

  return (
    <div
      ref={barRef}
      onMouseEnter={pause}
      onMouseLeave={() => setPaused(false)}
      onFocus={pause}
      onBlur={resumeIfOutside}
      className={paused ? 'news-ticker--paused' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 14px',
        backgroundColor: 'var(--bg-void)',
        borderBottom: '1px solid var(--border)',
        fontSize: '0.9rem',
        gap: '8px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--gold)', fontWeight: 700, flexShrink: 0 }}>НОВОСТИ:</span>
      <span className="news-ticker-viewport" ref={viewportRef}>
        {/* key только по числу копий: текст обновляется на месте без перезапуска marquee,
            а перемонтирование нужно лишь при резкой смене ширины (другое число копий и срок
            цикла) — иначе дорожка дёрнулась бы на разницу ширин. Пауза идёт классом
            news-ticker--paused, без ключа, чтобы hover/focus не перезапускали строку.
            Копия повторяет разделитель: без него -50% дорожки сдвинет текст на половину
            промежутка и на стыке цикла текст прыгнет. Копии кроме первой скрыты от чтения
            с экрана: для озвучки новость одна. */}
        <span
          key={layout.copies}
          ref={trackRef}
          className="news-ticker-track"
          style={{ '--marquee-dur': `${layout.cycleMs}ms` } as React.CSSProperties}
        >
          {Array.from({ length: layout.copies }, (_, i) => (
            <span
              key={i}
              className={`news-ticker-copy${i > 0 ? ' news-ticker-copy--dup' : ''}`}
              aria-hidden={i > 0 ? true : undefined}
            >
              {news}
              <span className="news-ticker-sep" aria-hidden="true" style={{ margin: '0 14px' }}>
                ◆
              </span>
            </span>
          ))}
        </span>
      </span>

      {/* Два раздельных элемента управления вместо клика по всей полосе: вложенные кнопки
          недостижимы с клавиатуры, а здесь нужен и переход, и остановка. */}
      <button
        onClick={refreshNews}
        className="news-ticker__btn"
        aria-label="Сменить новость"
        title="Сменить новость"
      >
        <Icon name="next" size={14} />
      </button>
      <button
        onClick={() => setPaused(!paused)}
        className="news-ticker__btn"
        aria-pressed={paused}
        aria-label={paused ? 'Продолжить ленту' : 'Остановить ленту'}
        title={paused ? 'Продолжить ленту' : 'Остановить ленту'}
      >
        <Icon name={paused ? 'play' : 'pause'} size={14} />
      </button>
    </div>
  );
};
