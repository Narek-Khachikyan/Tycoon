import React, { useEffect, useRef, useState } from 'react';
import { useGameStore, useStateSlice } from '../store/useGameStore';
import { EVENT_MIN_MS } from '../economy/events';
import { newsPool, RUMORS, tickerLine } from '../economy/news';
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

/**
 * Слух: разовая выплата Токенов, которая иногда выпадает в ленте.
 *
 * Шанс выведен из `EVENT_MIN_MS`, а не выдуман: один слух на всё окно между событиями,
 * то есть ровно частота самого редкого события. Лента поэтому не может оказываться щедрее
 * «Гранта», и слух остаётся находкой, а не второй зарплатой.
 */
const RUMOR_ODDS = EVENT_MIN_MS / NEWS_INTERVAL_MS;

const pickRumor = (): string => RUMORS[Math.floor(Math.random() * RUMORS.length)];

/**
 * Обратный отсчёт до следующего слуха.
 *
 * Живёт на модуле, а не в состоянии компонента: лента перерисовывается на каждой смене
 * новости, и счётчик в теле компонента обнулялся бы на каждом таком рендере. Двигает его
 * только обход ленты — ни кнопка смены новости, ни пауза на него не смотрят, поэтому
 * спам-кликами слух вызвать нельзя.
 */
let rumorIn = RUMOR_ODDS;

/**
 * Счётчик слухов на модуле, и он монотонный.
 *
 * Стор отсекает ровно тот id, за который уже заплатили, поэтому id обязан быть сквозным для
 * всей страницы: счётчик в состоянии компонента обнулялся бы на каждом промежутке между
 * слухами (лента гасит его, чтобы вернулась бегущая строка), и тогда каждый слух получал бы
 * первый номер — после первого забора забор отсёк бы все остальные, а кнопка молчала бы.
 * Счётчик на модуле переживает и перемонтирование ленты, и паузу, и не сбрасывается никогда.
 */
let rumorSeq = 0;

export const NewsTicker: React.FC = () => {
  const news = useGameStore((s) => s.news);
  // Пул заголовков нужен ленте, а не только подбору: копии заполняются разными новостями,
  // иначе в начале игры игрок трижды подряд читал одну фразу.
  //
  // Подписка на сам пул: он новый массив на каждый вызов, но поверхностное сравнение видит те же
  // строки, и лента перерисовывается, только когда состав заголовков действительно сменился, а
  // не двадцать раз в секунду ради строки, которая меняется раз в пятнадцать секунд.
  const pool = useStateSlice(newsPool);
  const refreshNews = useGameStore((s) => s.refreshNews);
  // У слуха своё действие, а не `catchEvent`: то живёт внутри окна события, и слух не имеет
  // права занимать чужое окно — у него нет ни Золотого Токена, ни его срока.
  const collectRumor = useGameStore((s) => s.collectRumor);
  const paused = useGameStore((s) => s.newsPaused);
  const setPaused = useGameStore((s) => s.setNewsPaused);

  const viewportRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ copies: MIN_COPIES, cycleMs: COPY_PASS_MS });
  /** Слух живёт один виток ленты: id сквозной, и повторное нажатие на тот же слух не платит. */
  const [rumor, setRumor] = useState<{ id: number; text: string } | null>(null);

  // Сколько копий нужно, решает только сама разметка: из CSS ширину окна не узнать, а без неё
  // полоса пустеет к концу цикла. Замер идёт по событиям — монтирование, смена новости,
  // изменение окна, — поэтому таймер здесь не нужен и опроса тоже. Меряется естественная ширина
  // текста (scrollWidth), а не ширина обрезанной копии, поэтому результат одинаков и под
  // настройкой игрока, где строка неподвижна и обрезана многоточием.
  //
  // На время слуха замер отменяется: бегущей строки в полосе тогда нет, а вернётся она по
  // смене новости, и замер повторится вместе с ней.
  useEffect(() => {
    if (rumor) return;
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
  }, [news, rumor]);

  // Единственный таймер в файле: он меняет текст, а движение задано transform в CSS. На паузе
  // таймер не идёт вовсе — иначе надпись под замершей строкой продолжала бы подменяться.
  // Слух своего таймера не заводит: решение принимает тот же обход, что и смена новости, и
  // держится ровно один виток — следующий виток его снимает.
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      refreshNews();
      if (--rumorIn > 0) {
        setRumor(null);
        return;
      }
      rumorIn = RUMOR_ODDS;
      setRumor({ id: ++rumorSeq, text: pickRumor() });
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
      {/* Слух занимает место бегущей строки, а не дописывается к ней: по движущемуся тексту
          нельзя попасть, поэтому слух, который надо успеть поймать в строке, не был бы
          лутбоксом. Кнопка, а не div с обработчиком: фокус на ней останавливает ленту
          (обработчики на полосе), и озвучка читает, что слух вообще есть.
          key по сквозному id слуха: следующий слух — это всегда новый узел, поэтому смена
          слуха перерисовывает кнопку, даже если бы текст совпал с предыдущим. */}
      {rumor ? (
        <button
          key={rumor.id}
          onClick={() => {
            collectRumor(rumor.id);
            setRumor(null);
          }}
          className="news-rumor"
          aria-label={`Слух: ${rumor.text} Нажми, чтобы забрать разовую выплату`}
        >
          <span style={{ color: 'var(--green)', fontWeight: 700, flexShrink: 0 }}>◆ СЛУХ</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{rumor.text}</span>
        </button>
      ) : (
        <span className="news-ticker-viewport" ref={viewportRef}>
          {/* key только по числу копий: текст обновляется на месте без перезапуска marquee,
              а перемонтирование нужно лишь при резкой смене ширины (другое число копий и срок
              цикла) — иначе дорожка дёрнулась бы на разницу ширин. Пауза идёт классом
              news-ticker--paused, без ключа, чтобы hover/focus не перезапускали строку.
              Копия повторяет разделитель: без него -50% дорожки сдвинет текст на половину
              промежутка и на стыке цикла текст прыгнет. Копии кроме первой скрыты от чтения
              с экрана: для озвучки новость одна.

              Содержимое копий — разные заголовки из доступного пула, а не одна повторённая
              фраза: лента занимает три-четыре копии, и повтор означал бы, что игрок читает
              один заголовок трижды подряд. Первая копия — та, что уже показана как новость. */}
          <span
            key={layout.copies}
            ref={trackRef}
            className="news-ticker-track"
            style={{ '--marquee-dur': `${layout.cycleMs}ms` } as React.CSSProperties}
          >
            {tickerLine(news, pool, layout.copies).map((text, i) => (
              <span
                key={i}
                className={`news-ticker-copy${i > 0 ? ' news-ticker-copy--dup' : ''}`}
                aria-hidden={i > 0 ? true : undefined}
              >
                {text}
                <span className="news-ticker-sep" aria-hidden="true" style={{ margin: '0 14px' }}>
                  ◆
                </span>
              </span>
            ))}
          </span>
        </span>
      )}

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
