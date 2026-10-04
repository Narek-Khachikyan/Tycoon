import React, { useEffect, useRef, useState } from 'react';
import { motionAllowed, useGameStore, type ActiveTab } from './store/useGameStore';
import { Header } from './components/Header';
import { NewsTicker } from './components/NewsTicker';
import { ClickColumn } from './components/ClickColumn';
import { OfficeColumn } from './components/OfficeColumn';
import { ShopColumn } from './components/ShopColumn';
import { Footer } from './components/Footer';
import {
  AchievementsModal,
  OfflineModal,
  PrestigeModal,
  SettingsModal,
  StatsModal,
} from './components/Modals';
import { Toasts } from './components/Toasts';
import { CATALOG } from './economy/catalog';

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
  const [isMobile, setIsMobile] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Responsive check
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 960);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
    }, 50);

    return () => clearInterval(interval);
  }, [tick]);

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

  // Единственное, что перекрашивается при смене Поколения (ADR-0002). Ставится на корневой
  // элемент, поэтому производные --accent-hover / --tint-accent из .app-root видят тот же цвет.
  // Приведение нужно потому, что кастомных свойств нет в React.CSSProperties.
  const accent = { '--accent-color': CATALOG[generation].theme.accent } as React.CSSProperties;

  return (
    <div
      ref={rootRef}
      className="app-root"
      // Настройка игрока не умеет вернуть движение, которое уже выключила система: атрибут
      // только снимает анимацию, а @media (prefers-reduced-motion: no-preference) в index.css
      // добавляет её обратно там, где система её разрешает.
      data-motion={reducedMotion ? 'reduced' : 'full'}
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
        {isMobile ? (
          // Мобильный вид с переключением вкладок
          <div style={{ flex: 1, height: '100%', overflowX: 'auto', overflowY: 'hidden' }}>
            {activeTab === 'click' && <ClickColumn />}
            {activeTab === 'office' && <OfficeColumn />}
            {(activeTab === 'shop' || activeTab === 'upgrades' || activeTab === 'perks') && (
              <ShopColumn />
            )}
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

      {/* Мобильная панель навигации внизу экрана */}
      {isMobile && (
        <nav
          style={{
            display: 'flex',
            backgroundColor: 'var(--bg-panel)',
            borderTop: '2px solid var(--border)',
            padding: '4px',
            gap: '4px',
          }}
        >
          {(
            [
              ['click', '💬 Промпт'],
              ['office', '🏢 Офис'],
              ['shop', '🛒 Магазин'],
            ] as [ActiveTab, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`pixel-btn ${activeTab === t ? 'pixel-btn-accent' : ''}`}
              style={{ flex: 1, padding: '10px 4px', fontSize: '0.9rem' }}
            >
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
      <PrestigeModal />
      <Toasts />
    </div>
  );
};
