import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { glitchDrainMult } from '../economy/glitches';
import { formatCount, formatNumber } from '../economy/format';
import {
  droneDrop,
  droneFlight,
  GoldenToken,
  GlitchSprite,
  GpuDrone,
  mixVar,
  sceneBands,
  useMotionAllowed,
} from './EventSprites';
import { Num } from './Num';

/**
 * Событийный слой Сцены: Глюки, которые на ней живут, и пролёт Дрона.
 *
 * Таймеров нет: колонка Офиса перерисовывается каждый тик, и всё, что здесь двигается, —
 * дёрганье паразита, пролёт Дрона, падающая монета — считается из `state.lastTick` как
 * производная. Ни CSS-анимации, ни узлов, которые надо гасить правилом: при выключенном
 * движении слой просто не создаёт частицы, и включение настройки не пересоздаёт их на каждом
 * тике.
 *
 * Текст на Сцене лежит либо на собственной затемнённой полосе, либо на собственном
 * затемнённом бейдже (ADR-0002). Голым текстом по живописи здесь не написано ничего:
 * контраст подписи не должен зависеть от того, что выдала машина, рисуя офис. Слой событий
 * не залезает на эти полосы: полосы Сцены считаются в `sceneBands` от измеренной высоты
 * полотна, а не от процентов, иначе на низкой Сцене рой Глюков наезжал бы на счётчики
 * Маскотов, а Дрон — на полосу кражи.
 */

/** Ширина спрайта Дрона в полосе пролёта. */
const DRONE_SIZE = 44;
/** Диаметр сбрасываемой монеты: Токен должен узнаваться в падении, но не перекрывать полёт. */
const DROP_SIZE = 13;

/**
 * Размер полотна Сцены.
 *
 * Слою событий он нужен, чтобы стоять в отведённой полосе, а не в процентах от неизвестного
 * контейнера. Наблюдатель, а не таймер: он срабатывает на смену размера, то есть на перенос
 * окна, переключение вкладки и смену Поколения, а не двадцать раз в секунду.
 */
const usePlateSize = (): [React.RefObject<HTMLDivElement | null>, { w: number; h: number }] => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Первый замер сразу же: до него полосы считались бы по нулю, и слой встал бы на HUD.
    const measure = () =>
      setSize((prev) =>
        prev.w === node.clientWidth && prev.h === node.clientHeight
          ? prev
          : { w: node.clientWidth, h: node.clientHeight },
      );
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
};

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
  const heat = state.heat;
  const drain = glitchDrainMult(state);
  const stolen = state.glitches.reduce((sum, g) => sum + g.stolen, 0);

  return (
    // Сплошная подложка, а не градиент, как у HUD над ней: подпись обязана читаться на любой из
    // четырёх Сцен, а градиент оставил бы её конец на неприкрытой живописи, а самый светлый пол
    // приходится как раз на Сцену 2. Подложка теплеет с перегревом — полоса тоже часть офиса.
    <div
      className="scene__glitch-band"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        backgroundColor: 'var(--bg-void)',
        borderTop: '1px solid var(--border)',
        fontSize: '0.8rem',
        boxShadow:
          heat > 0.02
            ? `inset 0 -8px 12px -8px ${mixVar('var(--accent-color)', 'var(--thermal-hot)', heat, 0.5)}`
            : undefined,
      }}
    >
      <GlitchSprite size={16} heat={heat} />
      <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>
        Глюки: −<Num>{formatNumber(Math.round((1 - drain) * 100), notation)}</Num>% к доходу
      </span>
      <span style={{ color: 'var(--text-muted)' }}>
        унесли <Num>{formatNumber(stolen, notation)}</Num>{' '}
        {formatCount(stolen, 'Токен', 'Токена', 'Токенов', notation)}
      </span>
    </div>
  );
};

/**
 * Дрон с GPU: один пролёт через Сцену на каждое окно события.
 *
 * Появлению не нужны ни таймер, ни перезапуск анимации, ни `key`: пролёт считается из
 * `lastTick − startedAt`, поэтому он сам начнётся с приходом окна и закончится вместе с ним.
 * Престиж окно не трогает, а перемонтировать слой по счётчику Престижей было бы ровно тем
 * таймером, которого здесь нет. С выключенным движением слой не монтируется вовсе: висящий на
 * месте дрон читался бы как забытая деталь офиса.
 */
export const SceneDrone: React.FC = () => {
  const startedAt = useGameStore((s) => s.state.event?.startedAt ?? 0);
  const lastTick = useGameStore((s) => s.state.lastTick);
  const heat = useGameStore((s) => s.state.heat);
  const red = useGameStore((s) => s.state.event?.red ?? false);
  const motion = useMotionAllowed();
  const [plateRef, plate] = usePlateSize();

  const flight =
    motion && startedAt > 0 ? droneFlight(lastTick - startedAt, plate.w, DRONE_SIZE) : null;
  if (!flight) return null;

  const bands = sceneBands(plate.h);
  const drop = droneDrop(lastTick - startedAt);

  return (
    <div
      ref={plateRef}
      style={{
        position: 'absolute',
        inset: 0,
        // Класс `.scene__drone` сюда намеренно не повешен: в index.css на нём висит анимация
        // `drone-fly`, а CSS-анимация в каскаде сильнее инлайнового стиля и перебила бы
        // transform и прозрачность, которые считает этот слой. Полёт живёт здесь, значит и
        // разметка под него — здесь.
        zIndex: 4,
        pointerEvents: 'none',
        opacity: flight.opacity,
        // Полоса пролёта считается от измеренной высоты полотна, поэтому дрон не лезет ни на
        // HUD с полосой кражи, ни на счётчики Маскотов ни на одной из четырёх Сцен.
        transform: `translate(${flight.x}px, ${bands.droneTop + flight.y}px)`,
      }}
    >
      <span style={{ display: 'block', lineHeight: 0 }}>
        <GpuDrone size={DRONE_SIZE} heat={heat} spin={flight.spin} red={red} />
      </span>

      {/* Сбрасываемый Токен: он же объясняет, зачем дрон здесь. Падает от брюха и гаснет, то есть
          читается как «сбросил груз», а не как украшение. Роняется он на середине пути, а не в
          конце: улетевший за край дрон роняет груз уже за кадром. */}
      {drop && (
        <span
          style={{
            position: 'absolute',
            left: `${Math.round(DRONE_SIZE * 0.45)}px`,
            top: `${Math.round(DRONE_SIZE * 0.5)}px`,
            lineHeight: 0,
            opacity: drop.opacity,
            transform: `translateY(${drop.dy}px) scale(${drop.scale})`,
          }}
        >
          <GoldenToken size={DROP_SIZE} heat={heat} red={red} />
        </span>
      )}
    </div>
  );
};
