import React, { useEffect, useRef } from 'react';
import { motionAllowed, useGameStore } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { ACHIEVEMENTS, ordinaryEarned } from '../economy/achievements';
import { formatNumber } from '../economy/format';
import { Num } from './Num';
import { Icon } from './Icon';

interface HeaderProps {
  onOpenAchievements: () => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenAchievements,
  onOpenStats,
  onOpenSettings,
}) => {
  const state = useGameStore((s) => s.state);
  const toggleMute = useGameStore((s) => s.toggleMute);
  const burst = useGameStore((s) => s.burst);
  const badgeRef = useRef<HTMLButtonElement>(null);

  const gen = CATALOG[state.generation];
  // Числитель — ordinaryEarned, а не achievements.length: тени лежат в том же списке, и
  // прямой длиной счётчик шагал бы выше знаменателя. Знаменатель остаётся только обычный.
  const unlockedAchCount = ordinaryEarned(state);
  const totalAchCount = ACHIEVEMENTS.length;
  const isMuted = state.settings.muted;

  // Значок — единственное место на экране, где Достижение остаётся видимым после того, как
  // тост уйдёт, поэтому пульсирует он, а не тост: вспышка тоста длится полсекунды.
  useEffect(() => {
    if (burst?.kind !== "achievement" || !motionAllowed()) return;
    const node = badgeRef.current;
    if (!node) return;
    node.classList.remove("ach-badge--pulse");
    void node.offsetWidth;
    node.classList.add("ach-badge--pulse");
    const done = () => node.classList.remove("ach-badge--pulse");
    node.addEventListener("animationend", done);
    return () => node.removeEventListener("animationend", done);
  }, [burst?.nonce]);

  return (
    <>
      <header
        className="header-bar"
        style={{
          padding: '10px 16px',
          backgroundColor: 'var(--bg-panel)',
          borderBottom: '2px solid var(--border)',
        }}
      >
        <div className="header-left">
          {/* Логотип — единственное место, где пиксельный шрифт законен на словах (ADR-0003). */}
          <h1 className="pixel-font header-logo">
            TOKEN CLICKER
          </h1>

          {/* Бейдж Поколения: key пересоздаёт узел на смене Поколения, появление — только
              opacity через toast-fade. На узком экране сокращается до «Поколение N»,
              а полное название сохраняется в title для сохранения информативности. */}
          <span
            key={state.generation}
            className="header-gen-badge"
            title={`Поколение ${gen.id}: ${gen.name} (${gen.period})`}
            style={{
              fontSize: "0.85rem",
              backgroundColor: "var(--tint-accent)",
              border: "1px solid var(--border-strong)",
              color: "var(--text-main)",
              padding: "2px 8px",
              borderRadius: "4px",
              animation: "toast-fade 0.15s ease-out",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <span className="tab-badge--pulse" style={{ display: "inline-block" }}>
              <span className="header-gen-full">
                Поколение {gen.id}: {gen.name} ({gen.period})
              </span>
              <span className="header-gen-short">
                Поколение {gen.id}
              </span>
            </span>
          </span>

          {state.compute > 0 && (
            <span
              className="header-compute-badge"
              style={{
                fontSize: "0.85rem",
                backgroundColor: "var(--tint-gold)",
                border: "1px solid var(--gold)",
                color: "var(--gold)",
                padding: "2px 8px",
                borderRadius: "4px",
                animation: "toast-fade 0.15s ease-out",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              title={`Бонус к доходу от Compute: +${state.compute}%`}
            >
              <span className="header-compute-full">
                <Num>{formatNumber(state.compute)}</Num> Compute (+<Num>{state.compute}</Num>%)
              </span>
              <span className="header-compute-short">
                +<Num>{state.compute}</Num>%
              </span>
            </span>
          )}
        </div>

        <div className="header-right">
          {/* Иконочные кнопки получают имя из aria-label: картинка декоративная,
              без подписи скринридер прочитал бы пустую кнопку. */}
          <button
            className="pixel-btn header-btn-icon-only"
            onClick={toggleMute}
            title={isMuted ? "Включить звук" : "Выключить звук"}
            aria-label={isMuted ? "Включить звук" : "Выключить звук"}
          >
            <Icon name={isMuted ? "sound-off" : "sound-on"} />
          </button>

          <button
            ref={badgeRef}
            className="pixel-btn ach-badge header-btn"
            onClick={onOpenAchievements}
            title={`Достижения: ${unlockedAchCount} из ${totalAchCount}`}
            aria-label={`Достижения: ${unlockedAchCount} из ${totalAchCount}`}
          >
            <Icon name="trophy" />
            <Num>{unlockedAchCount}</Num>/<Num>{totalAchCount}</Num>
          </button>

          <button
            className="pixel-btn header-btn"
            onClick={onOpenStats}
            title="Инфо"
            aria-label="Инфо и статистика"
          >
            <Icon name="info" />
            <span className="header-stats-text">Инфо</span>
          </button>

          <button
            className="pixel-btn header-btn-icon-only"
            onClick={onOpenSettings}
            title="Настройки"
            aria-label="Настройки"
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
    </>
  );
};
