import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { HEAT_PENALTY, TEMP_MAX, overloadShare, thermalRead } from '../economy/thermal';
import { formatNumber } from '../economy/format';
import { ThermalSparks } from './ThermalSparks';
import { useT } from '../i18n/useT';

/**
 * Температура — живая шкала, а не покупка. Она стоит под кнопкой Клика, потому что это
 * главное решение, которое игрок принимает в секунду: чем горячее, тем выше Доход.
 *
 * Управление мышью и клавиатурой одновременно. Клавиатура обязательна не для доступности,
 * а потому что шкала — это играбельная величина: держать стрелками можно ровно столько,
 * сколько нужно, и не отпуская мышь.
 */
export const ThermalDial: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const setTemp = useGameStore((s) => s.setTemp);
  const t = useT();
  const read = thermalRead(state);
  const notation = state.settings.notation;
  const lang = state.settings.lang;

  const pct = (read.temp / TEMP_MAX) * 100;
  const heatPct = read.heat * 100;

  const setFromClientX = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    setTemp(((e.clientX - rect.left) / rect.width) * TEMP_MAX);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const fine = TEMP_MAX / 20;
    const coarse = TEMP_MAX / 4;
    const step = e.shiftKey ? coarse : fine;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        setTemp(read.temp + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        setTemp(read.temp - step);
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

  const status = read.stunned
    ? t('Перегрев: Доход падает')
    : read.heat > 0.75
      ? t('Почти перегрев')
      : read.heat > 0.4
        ? t('Копится перегрев')
        : t('Стабильно');

  return (
    <div
      style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}
      data-thermal={read.stunned ? 'stunned' : read.heat > 0.5 ? 'hot' : 'calm'}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('Температура')}</span>
        <span style={{ fontSize: '0.75rem', color: read.stunned ? 'var(--danger)' : 'var(--text-muted)' }}>
          {status}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ position: 'relative' }}>
          <div
            role="slider"
            tabIndex={0}
            aria-label={t('Температура генерации')}
            aria-valuemin={0}
            aria-valuemax={TEMP_MAX}
            aria-valuenow={Number(read.temp.toFixed(2))}
            aria-valuetext={t('{temp} из {max}, Доход ×{mult}, {status}', {
              temp: read.temp.toFixed(2),
              max: TEMP_MAX,
              mult: read.mult.toFixed(2),
              status,
            })}
            aria-describedby="thermal-help"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setFromClientX(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) setFromClientX(e);
            }}
            onKeyDown={onKeyDown}
            style={{
              position: 'relative',
              height: '26px',
              backgroundColor: 'var(--bg-void)',
              border: '1px solid var(--border-strong)',
              cursor: 'ew-resize',
              touchAction: 'none',
              overflow: 'hidden',
            }}
          >
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
              {t('перегруз')}
            </div>
          </div>
          <ThermalSparks />
        </div>

        <div
          role="progressbar"
          aria-label={t('Перегрев')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(heatPct)}
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
              width: `${heatPct}%`,
              height: '100%',
              backgroundColor: read.heat > 0.75 ? 'var(--thermal-hot)' : 'var(--accent-color)',
            }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        <span>
          {t('Доход ×')}<span className="pixel-font">{formatNumber(lang, read.mult, notation)}</span>
        </span>
        <span style={{ color: read.heat > 0.6 ? 'var(--thermal-hot)' : 'var(--text-muted)' }}>
          {read.heat > 0.6
            ? t('перегрев {pct}%', { pct: Math.round(heatPct) })
            : read.halluRate > 0
              ? t('галлюцинации {rate}/мин', { rate: Math.round(read.halluRate * 60) })
              : t('риска нет')}
        </span>
      </div>

      <div
        id="thermal-help"
        style={{
          fontSize: '0.68rem',
          color: 'var(--text-muted)',
          opacity: 0.8,
          lineHeight: 1.35,
        }}
      >
        {t('Тяни мышью или жми ← → с Ctrl. Чем горячее — тем выше Доход, но копится перегрев.')}
        {read.stunned ? t(' Сейчас оглушение: жар сброшен, Доход вернётся.') : ''}
      </div>
    </div>
  );
};

export const HEAT_LOSS_LABEL = Math.round(HEAT_PENALTY * 100);
