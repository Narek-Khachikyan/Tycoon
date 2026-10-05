import React from 'react';
import { useGameStore } from '../store/useGameStore';
import { currentGoals } from '../economy/goals';
import { Icon } from './Icon';

/**
 * «Следующие шаги» — до трёх строк: номер шага, название и приглушённая подсказка.
 *
 * Строки чисто информационные: клик ничего не делает, анимаций нет вообще, поэтому при
 * выключенном движении глушить нечего. Появление по одной — тоже мигание, а не
 * информирование: цели меняются при каждом закрытии шага, и поочерёдный показ означал бы
 * мигание ровно в те моменты, когда игрок что-то сделал. Пусто — рендерит null.
 *
 * Оформление намеренно не похоже на список дел: у шага нет галочки и зачёркивания, потому
 * что здесь нечего отмечать — шаг либо ещё впереди, либо уже пройден и исчез. Номер даёт
 * порядок и ощущение близкой цели, а подсказка объясняет действие.
 */
export const GoalsBanner: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const goals = currentGoals(state);
  if (goals.length === 0) return null;

  return (
    <section
      aria-label="Следующие шаги"
      className="pixel-card"
      style={{
        padding: '10px 12px',
        marginBottom: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
        }}
      >
        <Icon name="bolt" size={13} />
        Следующие шаги
      </div>
      {goals.map((g, i) => (
        <div key={g.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          {/* Номер шага — цифра, поэтому пиксельный шрифт тут разрешён (ADR-0003).
              Не «1 / 3»: второе число читалось бы как счётчик задач, а здесь важно только
              место в порядке. Не aria-hidden: порядок шагов — часть смысла, и тому, кто
              слушает баннер, номер должен звучать так же, как тому, кто на него смотрит. */}
          <span
            className="pixel-font"
            style={{
              fontSize: '0.85rem',
              color: 'var(--accent-color)',
              // Ширина фиксирована, чтобы названия всех трёх шагов встали в одну колонку.
              minWidth: '14px',
              textAlign: 'right',
            }}
          >
            {i + 1}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>{g.title}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{g.hint}</div>
          </div>
        </div>
      ))}
    </section>
  );
};
