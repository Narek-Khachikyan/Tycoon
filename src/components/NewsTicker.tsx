import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { EVENT_MIN_MS } from '../economy/events';
import { RUMORS } from '../economy/news';
import { Icon } from './Icon';

/**
 * Скорость ленты, пикселей в секунду: единственное число, из которого выводится и скорость, и
 * срок цикла (`ширина периода ÷ скорость`).
 *
 * Раньше скорость выводилась из «одна копия идёт мимо окна 20 секунд», то есть зависела от ширины
 * самой новости, а число копий — от её ширины и ширины окна. Смена новости меняла и то и другое,
 * и дорожка дёргалась. Теперь едет всегда одинаково, а срок цикла считается от окна: полоса
 * не может ехать быстрее или медленнее заданного ни при какой ширине новостей.
 */
const TICKER_SPEED_PX_PER_SEC = 24;

/** Сколько раз подряд полоса может попросить другую новость, прежде чем согласится на повтор. */
const MAX_NEWS_REPEATS = 3;

/**
 * Сколько новостей набирать в период сразу при монтировании.
 *
 * Две: окно ленты на десктопе — около 1200 px, и одна новость занимает его наполовину, то есть
 * либо повтор, либо дыра в пол-окна. Две разные новости — это уже читаемая лента, а не «заголовок,
 * пауза, тот же заголовок». Больше не нужно: на телефоне окно узкое, и лишнее уходит в хвост
 * полосы, а не на экран.
 */
const SEED_NEWS = 2;

const NEWS_INTERVAL_MS = 15000;

/** Первое значение срока цикла: замер приходит сразу же, до него работает запасное из CSS. */
const FIRST_CYCLE_MS = 20000;

/**
 * Слух: разовая выплата Токенов, которая иногда выпадает в ленте.
 *
 * Шанс выведен из `EVENT_MIN_MS`, а не выдуман: один слух на самое короткое окно между
 * событиями, то есть ровно частота самого частого события. Лента поэтому не может оказываться
 * щедрее «Гранта», и слух остаётся находкой, а не второй зарплатой.
 */
const RUMOR_ODDS = EVENT_MIN_MS / NEWS_INTERVAL_MS;

/**
 * Слухи живут в экономике (economy/news), а не здесь: таблица правится контентом в одном
 * месте, а лента только тянет из неё. Короткие, потому что полоса показывает одну строку
 * и обрезает её многоточием.
 * Обещания с числом здесь нет намеренно: сумму считает экономика в момент нажатия, и
 * показанная цифра разошлась бы с выплатой, если бы игрок успел потратить Токены.
 */

const pickRumor = (): string => RUMORS[Math.floor(Math.random() * RUMORS.length)];

/**
 * Разделитель новостей. Живёт внутри каждой копии, а не между копиями: только так ширина копии
 * одинакова и узор дорожки повторяется без сдвига — на стыке цикла текст не прыгает.
 */
const NEWS_SEP = (
  <span className="news-ticker-sep" aria-hidden="true" style={{ margin: '0 14px' }}>
    ◆
  </span>
);

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
  const refreshNews = useGameStore((s) => s.refreshNews);
  // У слуха своё действие, а не `catchEvent`: то живёт внутри окна события, и слух не имеет
  // права занимать чужое окно — у него нет ни Золотого Токена, ни его срока.
  const collectRumor = useGameStore((s) => s.collectRumor);
  const paused = useGameStore((s) => s.newsPaused);
  const setPaused = useGameStore((s) => s.setNewsPaused);
  // Настройка движения — в зависимостях замера: переключатель меняет, едет ли дорожка, а
  // вместе с этим и то, чего от дорожки вообще требуется.
  const reducedMotion = useGameStore((s) => s.state.settings.reducedMotion);

  const viewportRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const [rumor, setRumor] = useState<{ id: number; text: string } | null>(null);

  /**
   * Период полосы: список новостей, из которых собрана половина дорожки.
   *
   * Сначала в нём одна новость — та, что пришла из стора, поэтому первый кадр не пустой.
   * Все новости в периоде разные (это проверяет ротация ниже), и ровно поэтому одна новость
   * не может оказаться в поле зрения дважды: окно не шире периода, а период повторяется целиком.
   */
  const [strip, setStrip] = useState<string[]>([news]);
  /** Отступ до края окна в пикселях и срок цикла: единственное, что знает про геометрию. */
  const [layout, setLayout] = useState({ filler: 0, cycleMs: FIRST_CYCLE_MS });
  /**
   * Самая широкая новость, которую игрок уже видел, и она же нижняя граница периода.
   *
   * Число монотонное намеренно: иначе короткая новость сузила бы период, и сдвиг -50%
   * перестал бы попадать на стык — дорожка дёрнулась бы на ширину новости, то есть ровно
   * в момент смены текста.
   */
  const widestNews = useRef(0);

  /**
   * Ротация без немедленного повтора: лента крутила одну новость копиями подряд, и это читалось
   * как сломанный контент. Запрет теперь на саму новость, а не на её соседство в ленте: то, что
   * в периоде уже есть, повторно не добавляется, и подряд могут стоять только разные новости.
   *
   * Живёт в рефах, а не в состоянии: это решение о показе, а не данные.
   */
  const lastNews = useRef(news);
  const repeats = useRef(0);
  useEffect(() => {
    if (news === lastNews.current) return;
    lastNews.current = news;
    // Пул новостей короткий и может выдать ту же, что в полосе: пара попыток достаётся, а
    // потолок не даёт зациклиться, когда доступна ровно одна новость.
    if (strip.includes(news) && repeats.current < MAX_NEWS_REPEATS) {
      repeats.current++;
      refreshNews();
      return;
    }
    repeats.current = 0;
    setStrip((prev) => (prev.includes(news) ? prev : [...prev, news]));
  }, [news, refreshNews, strip]);

  /**
   * Добор полосы на старте: без него первые полминуты в периоде одна новость и пробел в
   * пол-окна, и лента читается как «заголовок, долгая пауза» — хуже, чем прежние копии одной
   * строки, потому что тишина здесь заметнее повтора. Набираем несколько РАЗНЫХ новостей подряд;
   * повторы отсекает проверка выше, поэтому лишние вызовы просто ничего не добавят.
   */
  useEffect(() => {
    let left = SEED_NEWS;
    const seed = () => {
      if (left <= 0) return;
      left--;
      refreshNews();
    };
    seed();
    seed();
  }, [refreshNews]);

  /**
   * Геометрия дорожки: замер решает, сколько новостей влезает в половину и какого размера
   * отступ добирает остальное.
   *
   * Решение принимает только разметка: из CSS ширину окна не узнать. Замер идёт по событиям —
   * монтирование, смена новости, изменение окна, движение, — поэтому таймер здесь не нужен и
   * опроса тоже. Ширина берётся у самой дорожки (`scrollWidth`), а не у копии: половина
   * дорожки — это ровно половина её содержимого, потому что обе половины одинаковые.
   *
   * На время слуха замер отменяется: бегущей строки в полосе тогда нет, а вернётся она по
   * смене новости, и замер повторится вместе с ней.
   */
  useEffect(() => {
    if (rumor) return;
    const measure = () => {
      const viewport = viewportRef.current;
      const track = trackRef.current;
      if (!(viewport instanceof HTMLElement) || !(track instanceof HTMLElement)) return;
      const width = viewport.clientWidth;
      if (width <= 0) return;

      // Пока строка неподвижна, геометрия дорожки не нужна: она всё равно не едет, и рассчитывать
      // её незачем. Признак — сама анимация из index.css, а не собственная копия настройки:
      // CSS решает, едет полоса или нет, и компонент спрашивает ровно его.
      if (getComputedStyle(track).animationName === 'none') {
        setLayout((prev) => (prev.filler === 0 ? prev : { ...prev, filler: 0 }));
        return;
      }

      // Ширина каждой копии нужна для нижней границы периода: одиночная новость длиннее окна
      // всё равно должна поместиться в половину целиком, иначе половины станут разными.
      for (const child of track.children) {
        if (child instanceof HTMLElement && child.classList.contains('news-ticker-copy')) {
          widestNews.current = Math.max(widestNews.current, child.offsetWidth);
        }
      }
      const target = Math.max(width, widestNews.current);
      const content = track.scrollWidth / 2 - layout.filler;

      // Новостей не помещается: самая старая уходит. Пока период шире окна, дорожка за цикл
      // проезжает больше, чем посчитано от окна, и полоса едет быстрее заданной скорости.
      // Стык цикла при этом цел — половины одинаковые, — но скорость обязана быть одна.
      if (content > target && strip.length > 1) {
        setStrip((prev) => prev.slice(1));
        return;
      }
      const filler = Math.max(0, Math.ceil(target - content));
      const cycleMs = Math.round((target * 1000) / TICKER_SPEED_PX_PER_SEC);
      setLayout((prev) =>
        prev.filler === filler && prev.cycleMs === cycleMs ? prev : { filler, cycleMs },
      );
    };

    measure();
    // Шрифты приезжают после первого кадра и меняют ширину текста: без второго замера дорожка
    // осталась бы рассчитана на подменный шрифт, и лента пустовала бы первые пол-цикла.
    document.fonts.ready.then(measure);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [strip, layout.filler, rumor, reducedMotion]);

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

  // Половина дорожки: тот же список новостей и тот же отступ, что и в первой половине. Копии
  // кроме первой и вся вторая половина скрыты от чтения с экрана (класс дубликата включает и
  // display:none, когда полоса неподвижна), поэтому для озвучки новость всегда одна.
  const half = (h: number) => (
    <>
      {strip.map((text, i) => (
        <span
          key={`${h}-${i}`}
          className={`news-ticker-copy${h > 0 || i > 0 ? ' news-ticker-copy--dup' : ''}`}
          aria-hidden={h > 0 || i > 0 ? true : undefined}
        >
          {text}
          {NEWS_SEP}
        </span>
      ))}
      {layout.filler > 0 && (
        <span className="news-ticker-copy--dup" aria-hidden="true">
          <span style={{ display: 'inline-block', width: layout.filler }} />
        </span>
      )}
    </>
  );

  return (
    <div
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
          {/* Дорожка без key намеренно: обе половины всегда одинаковые, поэтому сдвиг -50%
              попадает ровно на стык, а её ширина и срок цикла зависят только от окна, не от
              текста. Перезапуск marquee при смене новости был бы единственным источником
              рывка, а раньше он и был: key стоял на числе копий. */}
          <span
            ref={trackRef}
            className="news-ticker-track"
            style={{ '--marquee-dur': `${layout.cycleMs}ms` } as React.CSSProperties}
          >
            {half(0)}
            {half(1)}
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
