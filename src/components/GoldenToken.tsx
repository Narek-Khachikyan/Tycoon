import React, { useEffect, useRef, useState } from 'react';
import { motionAllowed, useGameStore } from '../store/useGameStore';
import { MODEL_BY_ID } from '../economy/catalog';
import { activeSpec, type EventSpec } from '../economy/events';
import type { RedSpec } from '../economy/glitches';
import { formatDuration, formatNumber } from '../economy/format';
import type { Notation } from '../economy/state';
import { GoldenToken as GoldenTokenSprite } from './EventSprites';
import { Num } from './Num';

/**
 * Золотой Токен: единственный способ поймать выпавшее событие.
 *
 * Карточка живёт в колонке Клика и появляется только на время окна события, поэтому
 * «появился Токен» читается сам по себе. Кнопка честная: у неё есть имя, состояние
 * «поймано» выражено `disabled` и сменой подписи, а во что превращается Доход или Клик
 * вынесено в подпись, на которую ссылается `aria-describedby`. Тот же контракт, что у
 * раскрытия Справки AA в магазине: это кнопка, а не div с обработчиком.
 *
 * Здесь нет ни таймера, ни своей анимации: карточка перерисовывается каждый тик вместе с
 * состоянием, поэтому остаток окна считается из `lastTick` сам, а пульс спрайта вешает
 * класс `event-token`, который снимается настройкой движения в index.css.
 *
 * Событие, в котором ловля отнимает Токены, — красный «Крах», и оно единственное спрашивает
 * подтверждения: первое нажатие ничего не списывает, а тост называет сумму, второе списывает.
 * Подпись кнопки говорит об этом прямо: взведённое состояние называет «Списать», а не «Поймать»,
 * иначе игрок решал бы, что кнопка не сработала.
 *
 * Взвод живёт в сторе, а не в этой карточке: решает, списывать ли нажатием, `catchEvent`, и своя
 * копия флага в компоненте разошлась бы с ним при перезагрузке или смене забега — карточка
 * показала бы «подтверждение», а стор взял бы Токены без вопроса. Читать его отсюда и не дублировать
 * можно потому, что поле ключуется моментом старта окна: новое окно приходит с новым `startedAt`,
 * и взвод прошлого окна на него не действует.
 */

/** Один узел на весь экран, поэтому идентификатор подписи постоянен. */
const EFFECT_ID = 'event-effect';

type Spec = EventSpec | RedSpec;

/**
 * Во что превращается Доход или Клик, пока событие живо.
 *
 * Строка собирается из чисел самой таблицы события, а не пишется руками: иначе она
 * разошлась бы с экономикой при первой правке множителя. Разряд вида выводится по
 * наличию поля в объединении — у красного «Ночного кодинга» множителя Клика нет вовсе,
 * а возврат за Клик описан другими числами.
 */
const effectLine = (spec: Spec, red: boolean, notation: Notation): React.ReactNode => {
  if ('catchUpSec' in spec) {
    return (
      <>
        Клик возвращает Доход за <Num>{formatNumber(spec.catchUpSec, notation)}</Num> с
      </>
    );
  }
  if ('minutes' in spec) {
    return (
      <>
        Разовый {red ? '−' : '+'}
        <Num>{formatNumber(Math.round(spec.share * 100), notation)}</Num>% запаса Токенов
      </>
    );
  }
  // Снижение множителя показывается процентом потери, а не дробью: «×0,5» игрок прочитает
  // как «чуть меньше», а красть должно ровно половину.
  const label = spec.kind === 'surge' ? 'Доход Модели' : spec.kind === 'clickRush' ? 'Клик' : 'Доход';
  const m = 'clickMult' in spec ? spec.clickMult : spec.incomeMult;
  if (m < 1) {
    return (
      <>
        {label} −<Num>{formatNumber(Math.round((1 - m) * 100), notation)}</Num>%
      </>
    );
  }
  return (
    <>
      {label} ×<Num>{formatNumber(m, notation)}</Num>
    </>
  );
};

export const GoldenToken: React.FC = () => {
  const state = useGameStore((s) => s.state);
  const caught = useGameStore((s) => s.eventCaught);
  const crashArmedAt = useGameStore((s) => s.crashArmedAt);
  const catchEvent = useGameStore((s) => s.catchEvent);

  // Мгновенный локальный отклик в точке самого знака. Nonce перезапускает анимацию сжатия-разряда
  // длительностью до 0.4с. При выключенном движении остаётся только вспышка прозрачности.
  const [hitNonce, setHitNonce] = useState(0);
  const prevCaught = useRef(caught);
  useEffect(() => {
    if (caught && !prevCaught.current) {
      setHitNonce((n) => n + 1);
    }
    prevCaught.current = caught;
  }, [caught]);

  const handleCatch = () => {
    setHitNonce((n) => n + 1);
    catchEvent();
  };

  // Поле `red` живёт в событии, а вид и его числа — в таблице, поэтому подпись читает и то и
  // другое и обязана спросить оба: по одному виду неизвестно, обычное это событие или красное.
  const spec = activeSpec(state);
  const event = state.event;
  if (!spec || !event) return null;

  const notation = state.settings.notation;
  // По игровым часам, а не по Date.now(): тик движется по lastTick, и системное время
  // отставало бы от окна ровно настолько, на сколько игрок его и так видит.
  const leftMs = Math.max(0, event.startedAt + spec.durationMs - state.lastTick);

  // Единственный вид, в котором ловля отнимает Токены, — красный разовый «Крах»: остальные
  // либо платят, либо не делают ничего. Подпись об уроне и имя кнопки читаются по этому флагу,
  // а сам процент берётся из той же таблицы, что и остальные числа события.
  const costsTokens = event.red && spec.kind === 'grant';
  const costPct = costsTokens ? Math.round(spec.share * 100) : 0;

  // Сверка ровно та же, что в `catchEvent`: взвод — это момент старта окна, и пойманное окно уже
  // ничего не спрашивает, поэтому подпись «Списать» на пойманном не показывается.
  const armed = !caught && crashArmedAt === event.startedAt;

  const catchLabel = caught
    ? 'Поймано'
    : costsTokens
      ? armed
        ? `Списать −${formatNumber(costPct, notation)}%`
        : `Поймать ${spec.name}`
      : 'Поймать';

  return (
    <div
      className="pixel-card"
      style={{
        width: '100%',
        flexShrink: 0,
        padding: '10px 12px',
        border: '2px solid var(--gold)',
        backgroundColor: 'var(--bg-card)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}
    >
      <button
        type="button"
        onClick={!caught ? handleCatch : undefined}
        disabled={caught}
        aria-label={caught ? 'Золотой Токен поймано' : `Поймать Золотой Токен: ${spec.name}`}
        title={caught ? undefined : 'Кликни, чтобы поймать Токен'}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          cursor: caught ? 'default' : 'pointer',
          lineHeight: 0,
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span
          key={hitNonce}
          className={hitNonce === 0 ? 'event-token' : undefined}
          style={{
            display: 'inline-block',
            lineHeight: 0,
            animation:
              hitNonce > 0
                ? motionAllowed()
                  ? 'click-squash 0.28s cubic-bezier(0.2, 0.8, 0.3, 1.2)'
                  : 'click-fade 0.28s ease-out'
                : undefined,
          }}
        >
          <GoldenTokenSprite size={40} />
        </span>
        {/* Мгновенная локальная вспышка-разряд знака при поимке */}
        {hitNonce > 0 && motionAllowed() && (
          <span
            key={`halo-${hitNonce}`}
            style={{
              position: 'absolute',
              inset: '-4px',
              borderRadius: '50%',
              border: '2px solid var(--gold)',
              boxShadow: '0 0 14px 4px var(--accent-glow)',
              pointerEvents: 'none',
              animation: 'tab-badge-pulse 0.35s ease-out forwards',
            }}
          />
        )}
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--gold)' }}>
          {spec.name}
        </div>
        <div
          id={EFFECT_ID}
          // Подпись об уроне не тонет среди нейтральных: красным она читается как цена,
          // а не как ещё одна строка описания.
          style={{ fontSize: '0.8rem', color: costsTokens ? 'var(--red)' : 'var(--text-main)' }}
        >
          {effectLine(spec, event.red, notation)}
          {/* У «Прорыва» бонус получает одна Модель, и без её названия игрок не понимает,
              кому именно он доверяет ×15. */}
          {spec.kind === 'surge' && event.modelId && (
            <span style={{ color: 'var(--text-muted)' }}>
              {' '}
              — {MODEL_BY_ID[event.modelId]?.name ?? 'одна из моделей'}
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Осталось {formatDuration(leftMs / 1000)}
        </div>
      </div>

      {/* Одна кнопка на всё окно, и состояние у неё всегда названо: «Поймано» — почему Токен больше
          не берётся, а имя вида — о чём окно. Во взведённом состоянии подпись называет потерю, а
          красная заливка — тот же знак необратимого действия, что у кнопки Престижа: первое нажатие
          на «Поймать Крах» ничего не списывает, и без этого кнопка выглядела бы сломанной.
          Отдельной рамки под действия нет намеренно: кнопка у события одна, и место под неё не
          должно остаться пустым, если у окна появится причина её не показывать. disabled стоит
          только у пойманного окна. */}
      <button
        onClick={handleCatch}
        disabled={caught}
        aria-describedby={EFFECT_ID}
        aria-label={
          caught
            ? `Событие «${spec.name}» поймано`
            : costsTokens
              ? armed
                ? `Подтвердить потерю: снимет ${formatNumber(costPct, notation)}% запаса Токенов`
                : `Поймать событие «${spec.name}»: снимет ${formatNumber(costPct, notation)}% запаса Токенов, сначала спросит`
              : `Поймать событие «${spec.name}»`
        }
        className={`pixel-btn ${caught || armed ? '' : 'pixel-btn-gold'}`}
        style={{
          flexShrink: 0,
          padding: '8px 12px',
          fontSize: '0.9rem',
          ...(armed ? { backgroundColor: 'var(--red-solid)', borderColor: 'var(--red)' } : undefined),
        }}
      >
        {catchLabel}
      </button>
    </div>
  );
};
