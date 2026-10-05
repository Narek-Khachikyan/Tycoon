import React, { useEffect, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { MODEL_BY_ID } from '../economy/catalog';
import { activeSpec, type EventSpec } from '../economy/events';
import type { RedSpec } from '../economy/glitches';
import { formatDuration, formatNumber } from '../economy/format';
import type { Notation } from '../economy/state';
import {
  COIN_TOSS_COUNT,
  coinToss,
  GoldenToken as GoldenTokenSprite,
  mixVar,
  useMotionAllowed,
} from './EventSprites';
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
 * состоянием, поэтому остаток окна считается из `lastTick` сам, а фаза пульса, толчок от
 * поимки и разлетающиеся монеты — тоже производные от `lastTick`. Всё движение снимается
 * настройкой через `useMotionAllowed`, и в покое остаётся один кроссфейд прозрачности:
 * выцветание не вестибулярный триггер, в отличие от масштаба.
 *
 * **Карточка отражает перегрев.** Рамка и ореол идут от золота к белому калу тем же числом,
 * что и свечение края Сцены, поэтому жар читается на всей площади интерфейса сразу, а не
 * только под шкалой. У красного события рамка красная от начала окна, а не после прочтения
 * подписи про минус.
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

/** Диаметр монеты в карточке: событие читается крупнее своей подписи, а не наоборот. */
const TOKEN_SIZE = 44;
/** Сколько живёт разлёт монет после поимки. */
const TOSS_MS = 420;
/** Сколько живёт толчок монеты. */
const PUNCH_MS = 240;

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
  const motion = useMotionAllowed();

  // Поле `red` живёт в событии, а вид и его числа — в таблице, поэтому подпись читает и то и
  // другое и обязана спросить оба: по одному виду неизвестно, обычное это событие или красное.
  const spec = activeSpec(state);
  const event = state.event;
  if (!spec || !event) return null;

  const notation = state.settings.notation;
  // По игровым часам, а не по Date.now(): тик движется по lastTick, и системное время
  // отставало бы от окна ровно настолько, на сколько игрок его и так видит.
  const leftMs = Math.max(0, event.startedAt + spec.durationMs - state.lastTick);
  const windowAge = Math.max(0, state.lastTick - event.startedAt);

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

  // Толчок и разлёт привязаны к состоянию, а не к своему таймеру: момент поимки — это смена
  // подписи и disabled, то есть те же поля, что читает всё остальное в карточке. Отдельный
  // таймер означал бы второй цикл в компоненте и второй источник «когда нажали».
  const punchNonce = `${event.startedAt}:${caught}:${armed}`;
  const [punchedAt, setPunchedAt] = useState(-1);
  useEffect(() => {
    if (caught || armed) setPunchedAt(useGameStore.getState().state.lastTick);
    // lastTick в зависимостях не нужен и вреден: он меняется двадцать раз в секунду, и отклик
    // перезапускался бы на каждом тике, пока окно взведено или поймано. Отклик привязан к смене
    // подписи, то есть к nonce, а часы берутся из стора в момент этой смены.
  }, [punchNonce, caught, armed]);

  // Фаза пульса — возраст окна, поэтому он не нулевой уже на первом кадре и не «прыгает» при
  // перезагрузке страницы посреди окна. Период сокращается с перегревом: на горячем офисе
  // Токен зовёт клик заметно настойчивее.
  const heat = state.heat;
  const period = 1600 - Math.round(Math.min(1, Math.max(0, heat)) * 700);
  const wave = Math.sin((windowAge % period) / period * Math.PI * 2);

  const punchAge = state.lastTick - punchedAt;
  const punch = punchAge >= 0 && punchAge < PUNCH_MS ? Math.sin((punchAge / PUNCH_MS) * Math.PI) : 0;

  // Пойманное окно больше не зовёт: Токен тускнеет, кнопка говорит «Поймано». Тускнение — это
  // прозрачность, то есть единственное, что остаётся в режиме покоя.
  const scale = caught ? 0.82 : 1 + (motion ? wave * 0.05 : 0) + punch * 0.22;
  const opacity = caught ? 0.45 : 1;

  const left = leftMs / spec.durationMs;
  const accent = event.red ? 'var(--red)' : 'var(--gold)';
  const accentHot = event.red ? '#ff9a72' : 'var(--thermal-hot)';

  return (
    <div
      className="pixel-card"
      style={{
        width: '100%',
        flexShrink: 0,
        padding: '10px 12px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        // Рамка идёт от золота к белому калу тем же перегревом, что и ореол: карточка события
        // греется вместе со Сценой, иначе жар читался бы только на краю и по шкале.
        border: `2px solid ${mixVar(accent, accentHot, heat)}`,
        backgroundColor: 'var(--bg-card)',
        boxShadow: [
          '0 4px 12px var(--tint-strong)',
          // Ореол слабеет на холоде до полного нуля: постоянный ореол означал бы, что событие
          // всегда «горит», и перегрев перестал бы быть новостью.
          heat > 0.02
            ? `0 0 ${Math.round(6 + heat * 16)}px ${Math.round(heat * 3)}px ${mixVar(accent, accentHot, heat, 0.45)}`
            : '',
        ]
          .filter(Boolean)
          .join(', '),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          style={{
            position: 'relative',
            width: TOKEN_SIZE,
            height: TOKEN_SIZE,
            flexShrink: 0,
            // Масштаб идёт от центра: монета растёт и оседает на месте, а не уезжает в угол
            // карточки, иначе толчок читался бы как сдвиг вёрстки.
            transform: `scale(${scale.toFixed(3)})`,
            opacity,
            // Строка не анимируется переходом: она меняется двадцать раз в секунду, и переход
            // только тянул бы картинку позади настоящего значения.
            lineHeight: 0,
          }}
        >
          <GoldenTokenSprite size={TOKEN_SIZE} heat={heat} red={event.red} />

          {/* Разлетающиеся монеты — только при разрешённом движении и только в первые доли секунды
              после поимки. Радиус разброса задан в спрайте и не выходит за его пределы, чтобы
              монета не налезала на подписи карточки. */}
          {motion &&
            punchAge >= 0 &&
            punchAge < TOSS_MS &&
            Array.from({ length: COIN_TOSS_COUNT }, (_, i) => {
              const toss = coinToss(punchAge, i + 1);
              if (!toss) return null;
              return (
                <span
                  key={i}
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    // Ореол из двух слоёв: монета на тёмной подложке карточки иначе была бы
                    // плоским золотым квадратиком без формы.
                    textShadow: '0 0 4px rgba(0, 0, 0, 0.9)',
                    opacity: toss.opacity,
                    transform: `translate(-50%, -50%) translate(${toss.dx}px, ${toss.dy}px) scale(${toss.scale})`,
                  }}
                >
                  <GoldenTokenSprite size={14} heat={heat} red={event.red} />
                </span>
              );
            })}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: accent }}>
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
            только у пойманного окна.
            transform здесь не задаётся: его даёт :active у .pixel-btn, и инлайновый перевёртыш
            съел бы отклик на нажатие. */}
        <button
          onClick={catchEvent}
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
            padding: '8px 14px',
            fontSize: '0.9rem',
            borderRadius: 999,
            ...(armed ? { backgroundColor: 'var(--red-solid)', borderColor: 'var(--red)' } : undefined),
          }}
        >
          {catchLabel}
        </button>
      </div>

      {/* Полоса окна. Подпись «Осталось 12 с» читается один раз, а полосу видно сразу и глазом:
          окно обязано выглядеть уходящим, иначе оно стоит как обычная плашка, которую можно не
          заметить до конца. Позже четверти цвет идёт в красный — «уходит», а не «ещё есть».
          Перехода нет: полоса перерисовывается каждый тик, и переход тянул бы её позади. */}
      <div
        aria-hidden={true}
        style={{
          height: '4px',
          backgroundColor: 'var(--bg-void)',
          borderRadius: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${(left * 100).toFixed(1)}%`,
            backgroundColor: left > 0.25 ? accent : 'var(--danger)',
          }}
        />
      </div>
    </div>
  );
};
