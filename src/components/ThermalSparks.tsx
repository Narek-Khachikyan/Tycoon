import React, { useEffect, useRef } from 'react';
import { useGameStore, effectAllowed, reduceMotionMedia } from '../store/useGameStore';
import { TEMP_MAX } from '../economy/thermal';

/**
 * Искры жара над шкалой Температуры: тем больше и горячее, чем выше жар.
 *
 * Существует ради одного восприятия — «жар выглядит как жар». Полоса перегрева показывает
 * число, градиент показывает позицию, но ни то, ни другое не сообщает, что офис *горит*.
 * Искры — единственный канал для этого: они летят вверх и гаснут, и глаз читает это как
 * нагрев раньше, чем прочитает подпись.
 *
 * Количество и скорость привязаны к состоянию, а не к времени: при `prefers-reduced-motion`
 * узлы вообще не создаются (проверка `effectAllowed`: «меньше анимации» и выключатель частиц),
 * потому что CSS-гейт умеет сделать
 * элемент неподвижным, но не умеет его убрать — и иначе они жили бы в DOM вечно.
 */

/** Три ступени количества: непрерывный ряд из двадцати частиц бьёт по кадру на 20 тиках
 *  в секунду, а ступени дают читаемый «больше жара — больше искр» без рваного счёта. */
const TIERS = [0, 4, 9] as const;

/** Порог жара для каждой ступени. Верхняя ступень включается на 0.55 перегрева — раньше
 *  перегрева, чтобы игрок видел искры до того, как увидит шкалу целиком. */
const TIER_AT = [0, 0.22, 0.55];

const SPARK = Array.from({ length: 9 }, (_, i) => {
  const a = (i / 9) * Math.PI * 2;
  return {
    dx: Math.round(Math.cos(a) * 46),
    dy: -Math.round(Math.abs(Math.sin(a)) * 34 + 18),
    delay: `calc(${(i % 3) * 0.07}s)`,
  };
});

export const ThermalSparks: React.FC = () => {
  const heat = useGameStore((s) => s.state.heat);
  const temp = useGameStore((s) => s.state.temp);
  // Настройки игрока читаются подпиской: переключение должно перерисовать искры, а не ждать
  // следующего изменения жара. Системный запрос движения подписки не имеет — для него кэш ниже.
  const particles = useGameStore((s) => s.state.settings.particles);
  const reducedMotion = useGameStore((s) => s.state.settings.reducedMotion);

  // Один раз на смонтированную настройку, а не на каждый жар: `effectAllowed()` дёргает
  // matchMedia, и вызывать его двадцать раз в секунду дороже, чем весь рендер искр.
  const allowed = useRef(false);
  useEffect(() => {
    allowed.current = effectAllowed('particles');
    const mq = reduceMotionMedia();
    // Именованный обработчик, а не две стрелки: removeEventListener с чужой функцией
    // молча ничего не снимает, и каждое перемонтирование оставляло живой слушатель.
    const onChange = () => { allowed.current = effectAllowed('particles'); };
    mq?.addEventListener('change', onChange);
    return () => mq?.removeEventListener('change', onChange);
  }, [particles, reducedMotion]);

  // Выключатель проверяется и в рендере, а не только в кэше: кэш обновится эффектом уже после
  // этого кадра, и выключенные искры показывались бы ещё один тик.
  if (!particles) return null;
  if (!allowed.current && heat < TIER_AT[1]) return null;

  const count = TIERS[TIER_AT.filter((at) => heat >= at).length - 1];
  if (count === 0 || !allowed.current) return null;

  // Цвет берётся от жара, а не от акцента Поколения: искры жара обязаны читаться как
  // нагрев на любом из восьми Поколений, где акцент бывает синим или зелёным.
  const color = heat > 0.6 ? 'var(--thermal-hot)' : 'var(--accent-color)';

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {SPARK.slice(0, count).map((s, i) => (
        <span
          key={i}
          // Низ ставится по центру дорожки минус половина высоты искры: без этого все частицы
          // стартовали бы на нижней кромке шкалы и вылетали вниз на половину кадра.
          className="thermal-spark"
          style={
            {
              left: '50%',
              top: 'calc(50% - 1.5px)',
              backgroundColor: color,
              // Каждая искра едет из своей стороны: веер, а не пучок. Иначе все они шли бы
              // одной траекторией и читались бы как одна вспышка, а не как жар.
              '--spark-dx': `${s.dx}px`,
              '--spark-dy': `${s.dy}px`,
              animationDelay: s.delay,
              // Скорость растёт с жаром: при 0.6 перегрева искра живёт 0.5 с, при 0.95 — 0.28.
              // Это и есть главный признак «горит», а не «мигает».
              animationDuration: `${(0.5 - heat * 0.24).toFixed(2)}s`,
              opacity: 0.5 + Math.min(0.5, temp / TEMP_FOR_FULL),
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
};

/** Температура, при которой искры горят в полную силу: край шкалы. */
const TEMP_FOR_FULL = TEMP_MAX;
