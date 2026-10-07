import React from 'react';
import { useStateSlice } from '../store/useGameStore';
import { sparksView } from '../store/selectors';
import { useMotionAllowed } from './EventSprites';

/**
 * Искры жара над шкалой Температуры: тем больше и горячее, чем выше жар.
 *
 * Существует ради одного восприятия — «жар выглядит как жар». Полоса перегрева показывает
 * число, градиент показывает позицию, но ни то, ни другое не сообщает, что офис *горит*.
 * Искры — единственный канал для этого: они летят вверх и гаснут, и глаз читает это как
 * нагрев раньше, чем прочитает подпись.
 *
 * Количество и скорость привязаны к состоянию, а не к времени: при `prefers-reduced-motion`
 * узлы вообще не создаются (проверка `useMotionAllowed`), потому что CSS-гейт умеет сделать
 * элемент неподвижным, но не умеет его убрать — и иначе они жили бы в DOM вечно.
 */

const SPARK = Array.from({ length: 9 }, (_, i) => {
  const a = (i / 9) * Math.PI * 2;
  return {
    dx: Math.round(Math.cos(a) * 46),
    dy: -Math.round(Math.abs(Math.sin(a)) * 34 + 18),
    delay: `calc(${(i % 3) * 0.07}s)`,
  };
});

export const ThermalSparks: React.FC = () => {
  const { count, hot, duration, opacity } = useStateSlice(sparksView);
  // Реактивное чтение настройки, а не ref из эффекта: компонент больше не перерисовывается
  // каждым тиком, и ref, выставленный после первого рендера, остался бы ложным до смены жара.
  const allowed = useMotionAllowed();

  if (count === 0 || !allowed) return null;

  // Цвет берётся от жара, а не от акцента Поколения: искры жара обязаны читаться как
  // нагрев на любом из восьми Поколений, где акцент бывает синим или зелёным.
  const color = hot ? 'var(--thermal-hot)' : 'var(--accent-color)';

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
              animationDuration: `${duration}s`,
              opacity,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
};

