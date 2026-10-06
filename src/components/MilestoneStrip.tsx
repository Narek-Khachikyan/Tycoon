import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { MILESTONES, nextMilestone, milestoneHint, milestoneReward } from '../economy/milestones';
import { formatNumber } from '../economy/format';
import { Num } from './Num';

/**
 * Полоса вех: единственное место, где игрок видит, сколько шагов осталось до конца первого
 * получаса.
 *
 * Стоит под счётчиком Токенов, а не в магазине: веха — это цель, а магазин про покупки.
 * Игрок возвращается к цели после каждой выплаты, а до магазина идёт, когда уже знает, зачем.
 *
 * Число «N / 10» и заполненные деления — единственные два факта, которые нужны. Подробный
 * список условий скрыт: десять строк текста на старте читаются как список дел и отпугивают,
 * а не помогают.
 */
export const MilestoneStrip: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const notation = state.settings.notation;
  const current = nextMilestone(state);

  if (!current) return null;

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      {/* Деления: одно на веху, заполненное — выполненное. Чистый пиксельный счётчик,
          читаемый боковым зрением, без цифр. Заполненное деление берёт акцент Поколения,
          а незаполненное — пустоту сцены: контраст между «сделано» и «ещё нет» должен быть
          виден на расстоянии вытянутой руки. */}
      <div style={{ display: 'flex', gap: '2px', height: '10px' }} aria-hidden="true">
        {MILESTONES.map((m) => {
          const done = state.milestones.includes(m.id);
          return (
            <div
              key={m.id}
              style={{
                flex: 1,
                backgroundColor: done ? 'var(--accent-color)' : 'var(--bg-void)',
                border: done ? '1px solid var(--accent-color)' : '1px solid var(--border)',
              }}
            />
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{current.title}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {state.milestones.length} / {MILESTONES.length}
        </span>
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{milestoneHint(state, current)}</div>
      {/* Награда видна сразу, а не по факту: игрок должен видеть, ради чего тянуть.
          Число и слово разбираются на части — «+2.50 K» не является числом (ADR-0003). */}
      <div style={{ fontSize: '0.75rem', color: 'var(--gold)' }}>
        Награда: +<Num>{formatNumber(milestoneReward(state, current), notation)}</Num> Токенов
      </div>
    </div>
  );
};