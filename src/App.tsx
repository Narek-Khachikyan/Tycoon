import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motionAllowed, useGameStore, type ActiveTab } from './store/useGameStore';
import { Header } from './components/Header';
import { NewsTicker } from './components/NewsTicker';
import { ClickColumn } from './components/ClickColumn';
import { OfficeColumn } from './components/OfficeColumn';
import { ShopColumn } from './components/ShopColumn';
import { Footer } from './components/Footer';
import {
  AchievementsModal,
  FinaleModal,
  OfflineModal,
  PrestigeModal,
  SettingsModal,
  StatsModal,
} from './components/Modals';
import { Toasts } from './components/Toasts';
import { PrestigeOverlay } from './components/PrestigeOverlay';
import { Icon, type IconName } from './components/Icon';
import { CATALOG } from './economy/catalog';
import { totalIncome } from './economy/engine';
import { startMusic, updateMusic } from './audio/music';
import {
  clickColWidth,
  HEADER_H,
  NARROW_MAX,
  shopColWidth,
  TAB_BAR_H,
  TAP_MIN,
  THREE_COL_MIN,
  TOAST_CLEARANCE,
} from './layout';

/**
 * Насколько «включилась» игра для музыки: логарифм Дохода, зажатый в 0..1.
 *
 * Логарифм, потому что Доход за Забег проходит шесть порядков, а линейная шкала либо молчала
 * бы первые десять минут, либо упиралась в потолок после первго Престижа. Считается здесь, а
 * не в музыке, чтобы нормализация была одной строкой и проверялась тестом.
 */
const musicIntensity = (income: number): number =>
  income <= 0 ? 0 : Math.min(1, Math.log10(1 + income) / 6);

export const App: React.FC = () => {
  const tick = useGameStore((s) => s.tick);
  const activeTab = useGameStore((s) => s.activeTab);
  const setActiveTab = useGameStore((s) => s.setActiveTab);
  const generation = useGameStore((s) => s.state.generation);
  const reducedMotion = useGameStore((s) => s.state.settings.reducedMotion);
  const burst = useGameStore((s) => s.burst);

  const [isAchievementsOpen, setAchievementsOpen] = useState(false);
  const [isStatsOpen, setStatsOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  // Ширина окна нужна не для порога, а для базиса колонок: он считается из той же доли окна,
  // что и раньше, иначе колонки стали бы постоянными. Порог и базис берутся из одного модуля.
  //
  // Первый кадр обязан быть верным, поэтому ширина читается сразу, а не по умолчанию: с
  // `single: true` по умолчанию на десктопе игра на долю секунды показывала одноколоночный
  // режим и потом переключалась, то есть моргала при каждой загрузке.
  //
  // `narrow` — второй порог того же модуля (NARROW_MAX): ниже него шапка обязана уместиться в
  // один ряд. Раньше этот вопрос решался медиазапросом в CSS, где ширину пришлось продублировать
  // числом; теперь признак вычисляется здесь и уезжает в CSS атрибутом, поэтому ответ на «какая
  // раскладка» у обоих один.
  const [viewport, setViewport] = useState(() => {
    const width = typeof window === 'undefined' ? 0 : window.innerWidth;
    return { width, single: width < THREE_COL_MIN, narrow: width <= NARROW_MAX };
  });
  const rootRef = useRef<HTMLDivElement>(null);

  // Responsive check
  useEffect(() => {
    const measure = () => {
      const width = window.innerWidth;
      // Та же проверка, что и раньше, но порог приходит из модуля раскладки: отдельное число
      // здесь разошлось бы с минимумами колонок при первом же изменении сетки.
      setViewport((prev) =>
        prev.width === width
          ? prev
          : { width, single: width < THREE_COL_MIN, narrow: width <= NARROW_MAX },
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Главный игровой цикл (tick loop 20 FPS)
  useEffect(() => {
    let lastTime = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      // dt может оказаться большим, если вкладка была в фоне или машина спала.
      // Ограничивает начисление advanceTime() — иначе простой обошёл бы лимит оффлайна.
      tick(dt);
      // Музыка читает тот же тик, а не живёт своим интервалом: иначе два таймера решали бы
      // одно и то же и разошлись бы на тике. Интенсивность — логарифм Дохода, поэтому на
      // первой минуте она уже слышна, а не начинается с нуля; приглушение держится, пока
      // открыто окно События, иначе музыка спорила бы с его стингером.
      const s = useGameStore.getState().state;
      updateMusic({
        intensity: musicIntensity(totalIncome(s)),
        generation: s.generation,
        ducking: s.event !== null,
      });
    }, 50);

    return () => clearInterval(interval);
  }, [tick]);

  // Первый жест игрока запускает музыку: до него AudioContext suspended, и браузер не даёт
  // звучать никаким способом. Слушатель одноразовый и снимает себя же — постоянная подписка
  // на все касания ради проверки флага стоила бы дороже самой музыки.
  useEffect(() => {
    let started = false;
    const wake = () => {
      if (started) return;
      started = true;
      startMusic(useGameStore.getState().state.settings);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  // Тряска на Престиж — единственное движение всего корня в игре. Класс ставится вручную:
  // пока атрибут на месте, повторный Престиж не перезапустил бы анимацию, а перезапуск
  // обязателен — иначе второй Престиж в забеге прошёл бы без единого кадра.
  useEffect(() => {
    if (burst?.kind !== 'prestige' || !motionAllowed()) return;
    const node = rootRef.current;
    if (!node) return;

    node.classList.remove('app-root--shake');
    void node.offsetWidth;
    node.classList.add('app-root--shake');
  }, [burst?.nonce]);

  // Класс снимает сама анимация, и слушатель для этого один на всё время жизни корня, а не на
  // событие: иначе класс пережил бы кадр (а под настройкой игрока, где кадра нет вовсе, и
  // подавно) и навсегда отключил бы следующую тряску. По имени анимации, а не по факту
  // окончания: animationend всплывает от потомков, а у корня их сотня.
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const done = (e: AnimationEvent) => {
      if (e.animationName === 'prestige-shake') node.classList.remove('app-root--shake');
    };
    node.addEventListener('animationend', done);
    return () => node.removeEventListener('animationend', done);
  }, []);

  // Ширины колонок и размеры тапа — из модуля раскладки: CSS не умеет взять константу,
  // поэтому числа приезжают кастомными свойствами. Отступ стека тостов здесь не задаётся: он
  // зависит от высоты подвала, а та переносится по ширине окна, и ниже её меряет
  // ResizeObserver. Приведение нужно потому, что кастомных свойств нет в React.CSSProperties.
  const accent = {
    '--accent-color': CATALOG[generation].theme.accent,
    '--col-click': `${clickColWidth(viewport.width)}px`,
    '--col-shop': `${shopColWidth(viewport.width)}px`,
    '--tap-min': `${TAP_MIN}px`,
    '--header-h': `${HEADER_H}px`,
    '--tab-bar-h': `${TAB_BAR_H}px`,
  } as React.CSSProperties;

  // Отступ стека тостов равен высоте полос внизу оболочки
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const bands = ['.tab-bar', '.footer-bar'];
    const measure = () => {
      const height = bands.reduce((sum, sel) => {
        const band = root.querySelector(sel);
        return sum + (band ? band.getBoundingClientRect().height : 0);
      }, 0);
      root.style.setProperty('--toast-bottom', `${Math.round(height + TOAST_CLEARANCE)}px`);
    };
    const observer = new ResizeObserver(measure);
    for (const sel of bands) {
      const band = root.querySelector(sel);
      if (band) observer.observe(band);
    }
    measure();
    return () => observer.disconnect();
  }, [viewport.single, viewport.narrow]);

  // Температура одним атрибутом на корне
  const overheated = useGameStore((s) => s.state.heat);
  const stunned = useGameStore((s) => s.state.overheatedAt > 0 && s.state.lastTick - s.state.overheatedAt < 3500);
  const thermalState = stunned ? 'stunned' : overheated > 0.5 ? 'hot' : 'calm';

  return (
    <div
      ref={rootRef}
      className="app-root"
      // Настройка игрока не умеет вернуть движение, которое уже выключила система: атрибут
      // только снимает анимацию, а @media (prefers-reduced-motion: no-preference) в index.css
      // добавляет её обратно там, где система её разрешает.
      data-motion={reducedMotion ? 'reduced' : 'full'}
      data-narrow={viewport.narrow ? 'true' : 'false'}
      data-thermal={thermalState}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        // Не 100vw: vw — это ширина области просмотра вместе с полосой прокрутки, а блоку
        // доступна ширина без неё. Разница уходила в обрезку за overflow-x: hidden у body —
        // правая кнопка нижней навигации и первая строка подвала становились недостижимы.
        width: '100%',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-primary)',
        ...accent,
      }}
    >
      <Header
        onOpenAchievements={() => setAchievementsOpen(true)}
        onOpenStats={() => setStatsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <NewsTicker />

      {/* Основная рабочая область игры */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {viewport.single ? (
          // Одноколоночный режим: единственная колонка растягивается на всю ширину, поэтому её
          // базис из трёхколоночной раскладки здесь не применяется.
          <div style={{ flex: 1, height: '100%', overflowX: 'auto', overflowY: 'hidden' }}>
            {/* key пересоздаёт обёртку на смене вкладки, поэтому появление через
                существующий toast-fade (только opacity, без движения) проигрывается
                один раз на переключение. Состояние activeTab и порог не тронуты. */}
            <div key={activeTab} style={{ height: '100%', animation: 'toast-fade 0.15s ease-out' }}>
              {activeTab === 'click' && <ClickColumn full />}
              {activeTab === 'office' && <OfficeColumn full />}
              {(activeTab === 'shop' || activeTab === 'upgrades' || activeTab === 'perks') && (
                <ShopColumn full />
              )}
            </div>
          </div>
        ) : (
          // Десктопный вид: классические 3 колонки Cookie Clicker
          <>
            <ClickColumn />
            <OfficeColumn />
            <ShopColumn />
          </>
        )}
      </main>

      {/* Мобильная панель навигации внизу экрана. Ритм и высота — из index.css и layout.ts,
          здесь только то, что знает JS: активная вкладка и разворачивание кнопки. */}
      {viewport.single && (
        <nav className="tab-bar">
          {(
            [
              ['click', 'chat', 'Промпт'],
              ['office', 'office', 'Офис'],
              ['shop', 'shop', 'Магазин'],
            ] as [ActiveTab, IconName, string][]
          ).map(([t, icon, label]) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`pixel-btn tab-bar__btn ${activeTab === t ? 'pixel-btn-accent' : ''}`}
              aria-label={label}
              style={{ flex: 1 }}
            >
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </nav>
      )}

      <Footer />

      {/* Модальные окна */}
      <AchievementsModal
        isOpen={isAchievementsOpen}
        onClose={() => setAchievementsOpen(false)}
      />
      <StatsModal isOpen={isStatsOpen} onClose={() => setStatsOpen(false)} />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <OfflineModal />
      <Toasts />
      <PrestigeModal />
      {/* Экран финала контента: последнее Поколение пройдено, дальше идти некуда — игра обязана
          сказать об этом и предложить честный рестарт, а не прятать Престиж в приглушённую вкладку. */}
      <FinaleModal />
      {/* Оверлей — празднование ПОСЛЕ Престижа, окно выше — подтверждение ДО него. */}
      <PrestigeOverlay />
    </div>
  );
};
