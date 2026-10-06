import React from 'react';
import { THERMAL_COPY, THERMAL_RISKS, thermalZone } from '../data/thermalCopy';
import { useGameStore } from '../store/useGameStore';
import { clampTemp, isOverloaded, overloadShare } from '../economy/thermal';
import { useT } from '../i18n/useT';

/**
 * Справка по Температуре для окна «Инфо».
 *
 * Живёт своим компонентом, а не строкой в Modals: окно «Инфо» — это общий словарь на 37
 * терминов, и секция про главную механику игры должна стоять в нём ПЕРВОЙ, а не в общем
 * списке двадцать вторым. Всё содержимое приходит из `thermalCopy`, где числа вычислены из
 * констант баланса, поэтому правка механики обязана менять и этот текст.
 */
export const ThermalSection: React.FC = () => {
  const temp = useGameStore((s) => s.state.temp);
  const heat = useGameStore((s) => s.state.heat);
  const t = useT();
  const here = thermalZone(temp);
  const share = Math.round(overloadShare() * 100);

  return (
    <section
      style={{
        marginBottom: '10px',
        padding: '10px',
        backgroundColor: 'var(--bg-card)',
        borderRadius: '4px',
        borderLeft: '3px solid var(--thermal-cold)',
      }}
    >
      <h3 style={{ margin: '0 0 4px', fontSize: '1rem', color: 'var(--text-main)' }}>
        {t(THERMAL_COPY.title)}
      </h3>
      <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        {t(THERMAL_COPY.summary)}
      </p>

      <dl style={{ display: 'flex', flexDirection: 'column', gap: '4px', margin: '0 0 8px' }}>
        {THERMAL_COPY.zones.map((z) => {
          const current = z.id === here.id;
          return (
            <div key={z.id} style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
              <dt
                style={{
                  flexShrink: 0,
                  width: '5.5rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: current ? 'var(--accent-color)' : 'var(--text-muted)',
                }}
              >
                {t(z.label)}
                <span style={{ fontWeight: 400, opacity: 0.7 }}>
                  {' '}
                  {z.range[0]}–{z.range[1]}
                </span>
              </dt>
              <dd
                style={{
                  margin: 0,
                  fontSize: '0.8rem',
                  color: current ? 'var(--text-main)' : 'var(--text-muted)',
                }}
              >
                {t(z.text)}
              </dd>
            </div>
          );
        })}
      </dl>

      <ul style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: '0 0 8px', paddingLeft: '18px' }}>
        {THERMAL_RISKS.map((r) => (
          <li key={r.kind} style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{t(r.title)}</span>{' '}
            {t(r.text)}
          </li>
        ))}
      </ul>

      <p style={{ margin: '0 0 6px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t(THERMAL_COPY.cold)}</p>
      <p
        style={{
          margin: 0,
          fontSize: '0.85rem',
          color: 'var(--text-main)',
          paddingTop: '6px',
          borderTop: '1px solid var(--border)',
        }}
      >
        {t(THERMAL_COPY.tip)}
      </p>

      <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        {t('Сейчас:')} {t(here.label.toLowerCase())}
        {isOverloaded(temp) ? ` (${t('зона перегруза начинается с {share}% шкалы', { share })})` : ''}, {t('перегрев')}{' '}
        {Math.round(heat * 100)}%.
      </p>
    </section>
  );
};

export const OVERLOAD_SHARE = Math.round(overloadShare() * 100);
export const thermalValue = clampTemp;
