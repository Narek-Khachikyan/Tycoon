import React, { useEffect, useRef } from 'react';
import { motionAllowed, useGameStore } from '../store/useGameStore';
import { CATALOG } from '../economy/catalog';
import { ACHIEVEMENTS, nonShadowCount } from '../economy/achievements';
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
  // Числитель — nonShadowCount, а не achievements.length: тени лежат в том же списке, и
  // прямой длиной счётчик шапал бы выше знаменателя. Знаменатель остаётся только обычный.
  const unlockedAchCount = nonShadowCount(state);
  const totalAchCount = ACHIEVEMENTS.length;
  const isMuted = state.settings.muted;
  // Бейдж Compute печатается нотацией игрока, а не значением по умолчанию: иначе в научном
  // режиме вся игра показывала «1.00e4», а шапка — «10,00 K», то есть два разных числа на
  // одном экране для одной и той же величины.
  const notation = state.settings.notation;

  // Значок — единственное место на экране, где Достижение остаётся видимым после того, как
  // тост уйдёт, поэтому пульсирует он, а не тост: вспышка тоста длится полсекунды.
  useEffect(() => {
    if (burst?.kind !== 'achievement' || !motionAllowed()) return;
    const node = badgeRef.current;
    if (!node) return;
    node.classList.remove('ach-badge--pulse');
    void node.offsetWidth;
    node.classList.add('ach-badge--pulse');
    const done = () => node.classList.remove('ach-badge--pulse');
    node.addEventListener('animationend', done);
    return () => node.removeEventListener('animationend', done);
  }, [burst?.nonce]);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        backgroundColor: 'var(--bg-panel)',
        borderBottom: '2px solid var(--border)',
        flexWrap: 'wrap',
        gap: '10px',
        // minWidth: 0 обязателен обеим группам: флекс-элемент иначе не сожмётся ниже
        // содержимого, и на узком экране бейдж Поколения распирал бы строку вместо того,
        // чтобы уступить её соседу. Прокрутка полосы не участвует — шапка обязана помещаться
        // в экран целиком, поэтому лишнее уходит в перенос строки, а не под обрез.
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flexWrap: 'wrap' }}>
        {/* Логотип — единственное место, где пиксельный шрифт законен на словах (ADR-0003).
            clamp вместо фиксированного кегля: на 390 px «TOKEN CLICKER» в 1.4rem переносился
            на две строки и поднимал всю шапку до 131 px, то есть на шестую часть экрана. */}
        <h1
          className="pixel-font"
          style={{
            fontSize: 'clamp(1rem, 4.4vw, 1.4rem)',
            color: 'var(--accent-color)',
            letterSpacing: '1px',
            whiteSpace: 'nowrap',
          }}
        >
          TOKEN CLICKER
        </h1>
        {/* Бейдж Поколения: key пересоздаёт узел на смене Поколения, появление — только
            opacity через toast-fade, а пульс — классом tab-badge--pulse (scale при движении,
            мигание при reducedMotion), перезапуск тем же перемонтированием.

            nowrap плюс многоточие: период Поколения — это данные, и его длина ничем не
            ограничена, а шапка от него не должна зависеть. Без nowrap бейдж «Поколение 5:
            Reasoning (конец 2024 — начало 2025)» занимал четыре строки и выдавливал
            остальную шапку вниз; теперь он всегда одна строка, а не поместившийся хвост
            обрезается многоточием — имя Поколения, ради которого бейдж и нужен, остаётся. */}
        <span
          key={state.generation}
          style={{
            fontSize: '0.85rem',
            backgroundColor: 'var(--tint-accent)',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-main)',
            padding: '2px 8px',
            borderRadius: '4px',
            animation: 'toast-fade 0.15s ease-out',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <span className="tab-badge--pulse" style={{ display: 'inline-block' }}>
            Поколение {gen.id}: {gen.name} ({gen.period})
          </span>
        </span>
        {state.compute > 0 && (
          <span
            style={{
              fontSize: '0.85rem',
              backgroundColor: 'var(--tint-gold)',
              border: '1px solid var(--gold)',
              color: 'var(--gold)',
              padding: '2px 8px',
              borderRadius: '4px',
              // Появление при монтировании — только opacity через toast-fade: бейдж
              // возникает один раз, пульс ему не нужен.
              animation: 'toast-fade 0.15s ease-out',
              whiteSpace: 'nowrap',
            }}
            title="Бонус к доходу от Compute"
          >
            <Num>{formatNumber(state.compute, notation)}</Num> Compute (+<Num>{state.compute}</Num>%)
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {/* Иконочные кнопки получают имя из aria-label: картинка помечена декоративной, и
            без подписи озвучка прочитала бы пустую кнопку. */}
        <button
          className="pixel-btn"
          onClick={toggleMute}
          title={isMuted ? 'Включить звук' : 'Выключить звук'}
          aria-label={isMuted ? 'Включить звук' : 'Выключить звук'}
          style={{ padding: '6px 10px', fontSize: '0.9rem', whiteSpace: 'nowrap' }}
        >
          <Icon name={isMuted ? 'sound-off' : 'sound-on'} />
        </button>

        <button
          ref={badgeRef}
          className="pixel-btn ach-badge"
          onClick={onOpenAchievements}
          title="Достижения"
          // Без aria-label доступное имя кнопки — это «14 / 21», то есть два числа без
          // единого слова; озвучка читала бы их вслух и не называла, что открывается.
          aria-label={`Достижения: ${unlockedAchCount} из ${totalAchCount}`}
          style={{ padding: '6px 12px', fontSize: '0.9rem', whiteSpace: 'nowrap' }}
        >
          <Icon name="trophy" />
          <Num>{unlockedAchCount}</Num>/<Num>{totalAchCount}</Num>
        </button>

        <button
          className="pixel-btn"
          onClick={onOpenStats}
          title="Инфо"
          style={{ padding: '6px 12px', fontSize: '0.9rem', whiteSpace: 'nowrap' }}
        >
          <Icon name="info" />
          Инфо
        </button>

        <button
          className="pixel-btn"
          onClick={onOpenSettings}
          title="Настройки"
          aria-label="Настройки"
          style={{ padding: '6px 12px', fontSize: '0.9rem', whiteSpace: 'nowrap' }}
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
};
