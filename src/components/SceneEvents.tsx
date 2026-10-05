import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { GLITCH_CLICKS, glitchDrainMult } from '../economy/glitches';
import { formatCount, formatNumber } from '../economy/format';
import { GlitchSprite, GpuDrone } from './EventSprites';
import { Num } from './Num';

/**
 * Событийный слой Сцены: Глюки, которые на ней живут, и пролёт Дрона.
 *
 * Всё, что здесь двигается, вешает классом на CSS в index.css, поэтому выключенная
 * настройка движения снимает дёрганье, мерцание и пролёт одним правилом. Таймеров нет:
 * колонка Офиса перерисовывается каждый тик, а появление Дрона перезапускается `key`.
 *
 * Текст на Сцене лежит либо на собственной затемнённой полосе, либо на собственном
 * затемнённом бейдже (ADR-0002). Голым текстом по живописи здесь не написано ничего:
 * контраст подписи не должен зависеть от того, что выдала машина, рисуя офис.
 */

/** Размер Глюка на Сцене: вдвое меньше Маскота, потому что это паразит, а не сотрудник, и он
 *  должен читаться как то, что мешает, а не как ещё один Маскот в ряду. */
const GLITCH_SIZE = 28;

/**
 * Собственная тёмная подложка под любой текст события на Сцене: под полосу кражи и под
 * счётчик ударов.
 *
 * Плотная, а не жёсткая обводка: обводка это приём бейджа числа Агентов, и она держит
 * контраст на светлом полу Сцены 2, но на почти чёрной Сцене 4 белая кайма теряется в шуме
 * Сцены. Счётчик ударов при этом обязателен к прочтению (он решает, бросать ли ещё один
 * удар), а значит, не может зависеть от того, что нарисовала машина.
 */
const DARK_STRIP = 'var(--bg-void)';

const GLITCH_CHIP = {
  backgroundColor: DARK_STRIP,
  border: '1px solid var(--border)',
  borderRadius: '3px',
  color: 'var(--text-main)',
  fontSize: '0.7rem',
  lineHeight: 1.4,
  padding: '0 4px',
} as const;

/**
 * Полоса кражи под HUD Сцены: сколько Дохода Глюки уносят прямо сейчас и сколько уже унесли.
 *
 * Обратная связь живёт на самой Сцене, а не в модалке: без неё игрок видит, что Доход упал, и
 * не видит почему.
 */
export const SceneGlitchBand: React.FC = () => {
  const state = useGameStore((s) => s.state);
  if (state.glitches.length === 0) return null;

  const notation = state.settings.notation;
  const drain = glitchDrainMult(state);
  const stolen = state.glitches.reduce((sum, g) => sum + g.stolen, 0);

  return (
    // Сплошная подложка, а не градиент, как у HUD над ней: подпись обязана читаться на любой из
    // четырёх Сцен, а градиент оставил бы её конец на неприкрытой живописи, а самый светлый пол
    // приходится как раз на Сцену 2.
    <div
      className="scene__glitch-band"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        backgroundColor: DARK_STRIP,
        borderTop: '1px solid var(--border)',
        fontSize: '0.8rem',
      }}
    >
      <GlitchSprite size={16} />
      <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>
        Глюки: −<Num>{formatNumber(Math.round((1 - drain) * 100), notation)}</Num>% к доходу
      </span>
      <span style={{ color: 'var(--text-muted)' }}>
        унесли <Num>{formatNumber(stolen, notation)}</Num>{' '}
        {formatCount(Math.round(stolen), 'Токен', 'Токена', 'Токенов')}
      </span>
    </div>
  );
};

/** Паразиты на Сцене: каждый показывает, сколько кликов осталось, и лопается от третьего. */
export const SceneGlitchSwarm: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const hitGlitch = useGameStore((s) => s.hitGlitch);

  const glitches = state.glitches;
  if (glitches.length === 0) return null;

  const notation = state.settings.notation;

  return (
    // Слой не перехватывает указатель: кликабельны только кнопки, иначе пустая часть полосы
    // съедала бы наведение на Сцену.
    <div
      className="scene__glitches"
      style={{
        position: 'absolute',
        top: '30%',
        left: '6%',
        right: '6%',
        zIndex: 3,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignContent: 'flex-start',
        gap: '10px 12px',
        pointerEvents: 'none',
      }}
    >
      {glitches.map((g) => {
        const left = GLITCH_CLICKS - g.clicks;
        return (
          <button
            key={g.id}
            className="glitch-node"
            onClick={(e) => {
              const node = e.currentTarget;
              hitGlitch(g.id);
              // Перезапуск тем же сбросом, что у сквоша Клика: класс не меняется между
              // ударами, иначе второй удар не откликнулся бы.
              node.classList.remove('glitch-hit');
              void node.offsetWidth;
              node.classList.add('glitch-hit');
            }}
            // Класс гасится без сверки с animationName: под настройкой игрока анимация
            // называется glitch-hit-fade, и сверка оставила бы класс на кнопке навсегда. Чужих
            // animationend внутри быть не может, потому что дёрганье в покое бесконечно.
            onAnimationEnd={(e) => e.currentTarget.classList.remove('glitch-hit')}
            aria-label={`Глюк: осталось ${left} ${formatCount(left, 'удар', 'удара', 'ударов')}`}
            title={`Осталось ${left} ${formatCount(left, 'удар', 'удара', 'ударов')} — кликни, чтобы лопнул`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '3px',
              padding: 0,
              background: 'none',
              border: 'none',
              lineHeight: 0,
              cursor: 'pointer',
              pointerEvents: 'auto',
            }}
          >
            {/* Дёрганье в покое живёт на обёртке, а удар на кнопке: две анимации на одном узле
                перезаписали бы друг друга, а вложенные transform складываются. */}
            <span className="glitch-jitter" style={{ display: 'block', lineHeight: 0 }}>
              <GlitchSprite size={GLITCH_SIZE} />
            </span>
            <span style={GLITCH_CHIP}>
              ×<Num>{formatNumber(left, notation)}</Num>
            </span>
          </button>
        );
      })}
    </div>
  );
};

/**
 * Дрон с GPU: один пролёт через Сцену на каждое событие и на каждый Престиж.
 *
 * Появлению не нужны ни таймер, ни ручной перезапуск анимации: узел и есть `key`, поэтому смена
 * события и смена числа Престижей монтируют его заново и проигрывают пролёт один раз. С
 * выключенным движением слой скрыт правилом в index.css: висящий на месте дрон читался бы как
 * забытая деталь офиса.
 */
export const SceneDrone: React.FC = () => {
  const eventStartedAt = useGameStore((s) => s.state.event?.startedAt ?? 0);
  const prestiges = useGameStore((s) => s.state.prestiges);
  if (eventStartedAt === 0) return null;

  return (
    <div className="scene__drone" key={`${eventStartedAt}:${prestiges}`}>
      <span className="drone">
        <GpuDrone size={40} />
      </span>
    </div>
  );
};
