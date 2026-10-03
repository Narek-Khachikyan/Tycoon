import React, { useEffect, useState } from 'react';
import { useGameStore, type ActiveTab } from './store/useGameStore';
import { Header } from './components/Header';
import { NewsTicker } from './components/NewsTicker';
import { ClickColumn } from './components/ClickColumn';
import { OfficeColumn } from './components/OfficeColumn';
import { ShopColumn } from './components/ShopColumn';
import { Footer } from './components/Footer';
import {
  AchievementsModal,
  OfflineModal,
  SettingsModal,
  StatsModal,
} from './components/Modals';
import { Toasts } from './components/Toasts';

export const App: React.FC = () => {
  const tick = useGameStore((s) => s.tick);
  const activeTab = useGameStore((s) => s.activeTab);
  const setActiveTab = useGameStore((s) => s.setActiveTab);

  const [isAchievementsOpen, setAchievementsOpen] = useState(false);
  const [isStatsOpen, setStatsOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

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


  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-primary)',
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
            borderTop: '2px solid var(--border-color)',
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
      <Toasts />
    </div>
  );
};
