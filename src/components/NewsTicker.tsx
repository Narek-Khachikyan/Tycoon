import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';

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

export const NewsTicker: React.FC = () => {
  const news = useGameStore((s) => s.news);
  const refreshNews = useGameStore((s) => s.refreshNews);

  const viewportRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
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

  // Единственный таймер в файле: он меняет текст, а движение задано transform в CSS.
  useEffect(() => {
    const timer = setInterval(() => {
      refreshNews();
    }, 15000);
    return () => clearInterval(timer);
  }, [refreshNews]);

  return (
    <div
      onClick={refreshNews}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 14px',
        backgroundColor: 'var(--bg-void)',
        borderBottom: '1px solid var(--border)',
        fontSize: '0.9rem',
        cursor: 'pointer',
        gap: '8px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
      title="Нажмите, чтобы сменить новость"
    >
      <span style={{ color: 'var(--gold)', fontWeight: 700, flexShrink: 0 }}>НОВОСТИ:</span>
      <span className="news-ticker-viewport" ref={viewportRef}>
        {/* key по тексту: смена новости меняет и число копий, и срок цикла, поэтому цикл
            начинается заново — иначе дорожка дёрнулась бы на разницу ширин. Копия повторяет
            разделитель: без него -50% дорожки сдвинет текст на половину промежутка и на
            стыке цикла текст прыгнет. Копии кроме первой скрыты от чтения с экрана: для
            озвучки новость одна. */}
        <span
          key={news}
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
    </div>
  );
};