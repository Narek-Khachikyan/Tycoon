import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { currentGoals } from '../economy/goals';
import { Icon } from './Icon';

/** Что сказать, когда список шагов кончился. Пустая строка была бы молчанием о достижении. */
const ALL_DONE = 'Все шаги пройдены — дальше свободная игра.';

/**
 * «Следующие шаги» — до трёх строк: номер шага, название и приглушённая подсказка.
 *
 * Строки чисто информационные: клик ничего не делает, анимаций нет вообще, поэтому при
 * выключенном движении глушить нечего. Появление по одной — тоже мигание, а не
 * информирование: цели меняются при каждом закрытии шага, и поочерёдный показ означал бы
 * мигание ровно в те моменты, когда игрок что-то сделал. Пусто — не рисуем ничего, кроме
 * живой области.
 *
 * Оформление намеренно не похоже на список дел: у шага нет галочки и зачёркивания, потому
 * что здесь нечего отмечать — шаг либо ещё впереди, либо уже пройден и исчез. Номер даёт
 * порядок и ощущение близкой цели, а подсказка объясняет действие.
 *
 * Озвучка. Баннер меняется мимо чтения заголовка: игрок читает счётчик Токенов, закрывает шаг,
 * а первая строка «Следующие шаги» на экране стала другой. Без живой области тот, кто слушает,
 * узнаёт об этом только тогда, когда полезет читать магазин, — то есть почти никогда.
 *
 * Область поэтому одна и всегда в DOM, а текст в ней меняется только при смене цели. Область
 * на всю секцию была бы хуже: при каждом закрытии шага она объявляла бы все три строки целиком,
 * а на первой загрузке заговорила бы вообще, не дожидаясь действия. Первый кадр молчит — баннер
 * виден целиком, объявлять нечего.
 *
 * Формулировка «Следующая цель», а не «шаг пройден», выбрана тоже по правде: после Престижа
 * список откатывается к началу (Агенты обнулены, и условие второго шага снова не выполнено),
 * и заявление о выполнении было бы ложью. «Следующая цель» верна в обе стороны.
 */
export const GoalsBanner: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const goals = currentGoals(state);

  // Хуки стоят до раннего выхода: список пустеет после второго Престижа, а объявление об
  // этом — тоже сообщение, и без него оно потерялось бы вместе с секцией.
  const [announced, setAnnounced] = useState<string | null>(null);
  const lastTop = useRef<string | null | undefined>(undefined);
  // Зависимости — примитивы, а не объект цели: баннер перерисовывается каждый тик (двадцать
  // раз в секунду), и эффект с объектом в зависимостях гонял бы сравнение на каждом кадре.
  const topId = goals[0]?.id;
  const topTitle = goals[0]?.title;
  const topHint = goals[0]?.hint;

  useEffect(() => {
    if (topId === lastTop.current) return;
    const firstFrame = lastTop.current === undefined;
    lastTop.current = topId;
    if (firstFrame) return;
    setAnnounced(topId === undefined ? ALL_DONE : `Следующая цель: ${topTitle}. ${topHint}`);
  }, [topId, topTitle, topHint]);

  return (
    <>
      {/* aria-live="polite" написан рядом с role=status, хотя роль его и подразумевает: так же
          оформлена подсказка онбординга, и пара «роль + вежливость» читается с одного взгляда, а
          не по памяти о том, что role=status — это уже вежливая область. */}
      <div role="status" aria-live="polite" className="visually-hidden">
        {announced ?? ''}
      </div>
      {goals.length > 0 && (
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
      )}
    </>
  );
};