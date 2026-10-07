import React from 'react';
import { useStateSlice } from '../store/useGameStore';
import { coachStep } from '../economy/onboarding';

/**
 * Подсказка онбординга: три шага для первого знакомства с игрой.
 *
 * Читает только состояние и считает шаг чистой функцией coachStep — ни таймеров, ни
 * интервалов, ни собственного счётчика шагов. Показывается в потоке колонки Клика рядом с
 * кнопкой «Отправить промпт»: плавающая карточка поверх экрана вставала бы на сток тостов
 * и перекрывала главное действие, а в потоке колонки подсказка всегда там, куда смотрит
 * игрок. Вход — только opacity через toast-fade, поэтому при reducedMotion картина та же.
 */
export const OnboardingCoach: React.FC = () => {
  // Шаг — запись из таблицы: у тика она та же самая, поэтому подсказка не перерисовывается.
  const step = useStateSlice(coachStep);

  // Пройденный поток не занимает места: пустой шаг — это отсутствие карточки, а не пустая.
  if (!step) return null;

  return (
    <div
      key={step.id}
      className="pixel-card"
      role="status"
      aria-live="polite"
      style={{
        width: '100%',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        borderColor: 'var(--accent-color)',
        animation: 'toast-fade 0.2s ease-out',
      }}
    >
      <div
        style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          color: 'var(--accent-color)',
        }}
      >
        {step.title}
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.35 }}>{step.body}</div>
    </div>
  );
};