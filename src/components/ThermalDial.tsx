import React from 'react';
import { useGameStore, useStateSlice } from '../store/useGameStore';
import { thermalView } from '../store/selectors';
import { TEMP_MAX, overloadShare } from '../economy/thermal';
import { ThermalSparks } from './ThermalSparks';

/**
 * Температура — живая шкала, а не покупка. Она стоит под кнопкой Клика, потому что это
 * главное решение, которое игрок принимает в секунду: чем горячее, тем выше Доход.
 *
 * Управление мышью и клавиатурой одновременно. Клавиатура обязательна не для доступности,
 * а потому что шкала — это играбельная величина: держать стрелками можно ровно столько,
 * сколько нужно, и не отпуская мышь.
 */
export const ThermalDial: React.FC = () => {
  const view = useStateSlice(thermalView);
  const setTemp = useGameStore((s) => s.setTemp);

  // Проценты шкалы, а не доли: CSS-переменная получает число, которое человек не делит в уме.
  const pct = (view.temp / TEMP_MAX) * 100;

  const setFromClientX = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    setTemp(((e.clientX - rect.left) / rect.width) * TEMP_MAX);
  };

  /**
   * Клавиатура шкалы.
   *
   * Ctrl обязателен: без него стрелки меняли бы Температуру на 8% за нажатие, и игрок,
   * прокручивающий страницу стрелками над шкалой, сдвигал бы её вместо прокрутки. Это
   * требование role=slider в спецификации ARIA, и оно же снимает ловушку.
   *
   * Shift — крупный шаг, чтобы перебрать шкалу грубо, не нажимая двадцать раз.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const fine = TEMP_MAX / 20;
    const coarse = TEMP_MAX / 4;
    const step = e.shiftKey ? coarse : fine;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        setTemp(view.temp + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        setTemp(view.temp - step);
        break;
      case 'Home':
        setTemp(0);
        break;
      case 'End':
        setTemp(TEMP_MAX);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}
      data-thermal={view.tone}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        {/* Подпись — слово из CONTEXT.md, а не «температура генерации»: игрок читает шкалу,
            а не спецификацию, и слово «Температура» здесь и в вики означает одно и то же. */}
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Температура</span>
        <span style={{ fontSize: '0.75rem', color: view.stunned ? 'var(--danger)' : 'var(--text-muted)' }}>
          {view.status}
        </span>
      </div>

      {/* Дорожка: сама ручка и вся зона нагрева. Полоса перегрева лежит СНАРУЖИ шкалы, а не
          поверх неё, потому что это две разные величины — жар и его последствие. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {/* Искры жара живут ПОВЕРХ дорожки и выходят за её пределы: офис должен выглядеть
            горящим, а не «штриховым». Слой не обрезается — обрезка съела бы половину жеста. */}
        <div style={{ position: 'relative' }}>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Температура генерации"
          aria-valuemin={0}
          aria-valuemax={TEMP_MAX}
          aria-valuenow={Number(view.temp.toFixed(2))}
          aria-valuetext={view.valueText}
          aria-describedby="thermal-help"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setFromClientX(e);
          }}
          onPointerMove={(e) => { if (e.buttons === 1) setFromClientX(e); }}
          onKeyDown={onKeyDown}
          style={{
            position: 'relative',
            height: '26px',
            backgroundColor: 'var(--bg-void)',
            border: '1px solid var(--border-strong)',
            // Курсор-решётка, а не стрелка: шкала тянут мышью, и это главный жест.
            cursor: 'ew-resize',
            touchAction: 'none',
            overflow: 'hidden',
          }}
        >
          {/* Заливка до текущей температуры: чем длиннее, тем горячее видно боковым зрением.
              Градиент кладётся на всю дорожку, а не на заливку: иначе при 20% температуры
              игрок увидел бы только холодный синий и не понял бы, куда вообще двинулась шкала. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(90deg, var(--thermal-cold) 0%, var(--accent-color) 62%, var(--thermal-hot) 100%)',
              opacity: 0.28,
            }}
          />
          <div
            className="thermal-dial__fill"
            style={{
              position: 'absolute',
              inset: 0,
              width: `${pct}%`,
              background:
                'linear-gradient(90deg, var(--thermal-cold) 0%, var(--accent-color) 62%, var(--thermal-hot) 100%)',
            }}
          />
          {/* Ручка — тёмная плашка, читаемая на любом участке заливки. */}
          <div
            className="thermal-dial__handle"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `calc(${pct}% - 3px)`,
              width: '6px',
              backgroundColor: 'var(--bg-void)',
              boxShadow: '0 0 0 1px var(--text-main)',
            }}
          />
          {/* Зона перегруза. Заливка читается как «здесь жарче всего», а не как «сломанная
              часть шкалы»: граница пунктирная, потому что пунктир в игровом интерфейсе уже
              занят Disabled-состоянием, а заливка перегрузной зоны — наоборот, единственное
              место, где доход гарантированно выше. */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${overloadShare() * 100}%`,
              right: 0,
              background:
                'repeating-linear-gradient(135deg, color-mix(in srgb, var(--thermal-hot) 22%, transparent) 0 4px, transparent 4px 8px)',
              borderLeft: '1px dashed var(--thermal-hot)',
              pointerEvents: 'none',
            }}
          />
          {/* Подпись зоны: без неё штриховка читается как «сюда нельзя», а не как «здесь
              больше всего». */}
          <div
            style={{
              position: 'absolute',
              right: '4px',
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '0.6rem',
              color: 'var(--thermal-hot)',
              pointerEvents: 'none',
              textShadow: '1px 1px 0 var(--bg-void)',
            }}
          >
            перегруз
          </div>
        </div>
        <ThermalSparks />
        </div>

        {/* Полоса перегрева. Единственная величина, которая тикает сама, поэтому её приходится
            показывать: без неё игрок не понимает, сколько ещё можно греть. */}
        <div
          role="progressbar"
          aria-label="Перегрев"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.heatNow}
          style={{
            position: 'relative',
            height: '6px',
            backgroundColor: 'var(--bg-void)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}
        >
          <div
            className="thermal-dial__heat"
            style={{
              width: `${view.heatBar}%`,
              height: '100%',
              // Цвет перегрева — белый кал, а не красный: он остаётся различимым на
              // акценте любого из восьми Поколений, где красный уходил бы в тот же тон.
              backgroundColor: view.heatHigh ? 'var(--thermal-hot)' : 'var(--accent-color)',
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        <span>
          Доход ×<span className="pixel-font">{view.mult}</span>
        </span>
        <span style={{ color: view.riskHot ? 'var(--thermal-hot)' : 'var(--text-muted)' }}>
          {view.risk}
        </span>
      </div>

      {/* Подсказка видна всегда, а не по наведению: игрок тянет шкалу мышью и не водит
          курсором по подписи, поэтому наведением она не открывалась бы никогда.
          Текст короткий и говорит ровно то, чего не видно на шкале: что ползунок делает
          и как им управлять с клавиатуры. */}
      <div
        id="thermal-help"
        style={{
          fontSize: '0.68rem',
          color: 'var(--text-muted)',
          opacity: 0.8,
          lineHeight: 1.35,
        }}
      >
        Тяни мышью или жми ← → с Ctrl. Чем горячее — тем выше Доход, но копится перегрев.
        {view.stunned ? ' Сейчас оглушение: жар сброшен, Доход вернётся.' : ''}
      </div>
    </div>
  );
};
