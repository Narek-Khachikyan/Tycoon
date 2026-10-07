import React from 'react';
import { useGameStore } from '../store/useGameStore';
import type { LabId } from '../data/labs';
import { useMotionAllowed } from './EventSprites';

interface MascotProps {
  lab: LabId;
  size?: number;
  /** Покачивание на месте: только Маскоты на Сцене, никогда не строки магазина и не окна. */
  animated?: boolean;
  className?: string;
}

// Маскоты — PNG из public/sprites: логика 24×24, экспорт 96×96 nearest-neighbor
// на прозрачном фоне. Имя файла — часть контракта: нет файла — нет Маскота,
// поэтому карта выводится из LabId, а не дублируется списком.
const MASCOT_SRC: Record<LabId, string> = {
  openai: '/sprites/mascot-openai.png',
  anthropic: '/sprites/mascot-anthropic.png',
  google: '/sprites/mascot-google.png',
  xai: '/sprites/mascot-xai.png',
  deepseek: '/sprites/mascot-deepseek.png',
  meta: '/sprites/mascot-meta.png',
  mistral: '/sprites/mascot-mistral.png',
  alibaba: '/sprites/mascot-alibaba.png',
};

/** Период покачивания. Длиннее минуты он не нужен: Сцена смотрится бодрее офиса. */
const BOB_MS = 1800;
/**
 * Амплитуда покачивания в пикселях.
 *
 * Три, а не четыре: контактная тень под Маскотом живёт в OfficeColumn и стоит на месте, пока
 * сам Маскот поднимается, поэтому каждый лишний пиксель подъёма — это видимый зазор между ногами
 * и полом. Три пикселя на спрайте 48 px глазом не отсчитываются, а зазор не виден.
 */
const BOB_PX = 3;

/**
 * Покачивание Маскота: целое число пикселей от прошедшего времени и фазы Лаборатории.
 *
 * Фаза выведена из id Лаборатории, а не из индекса в ряду: ряд меняется вместе с покупками, и
 * Маскот, купленный вторым, начинал бы покачиваться с той же фазы, что первый, а потом вдруг
 * сдвигался бы на полпериода. Фаза из id переживает любой состав офиса.
 *
 * Возвращается `0`, когда движение выключено, а не «период покоя»: тогда вызывающий не ставит
 * transform вовсе, и в покое у картинки нет ни одного анимируемого свойства.
 */
export function mascotBob(ageMs: number, seed: number): number {
  const wave = Math.sin((Math.max(0, ageMs) / BOB_MS + seed) * Math.PI * 2);
  // Ступени по пикселю: тик идёт двадцать раз в секунду, и плавный синус превращался бы в мелкую
  // дрожь. Целые пиксели двигают спрайт так же надёжно, как двигали бы keyframes.
  return -Math.round((wave * 0.5 + 0.5) * BOB_PX);
}

/**
 * Фильтр прогретого Маскота; пустая строка, пока офис холодный.
 *
 * Покачивание и его тон — из одного числа, иначе картинка меняет тон, а не двигаясь. Сепия в 12%
 * и подъём яркости на 6%: офис должен казаться прогретым, а не перекрашенным. Ниже этого тона
 * Маскот остаётся своим, выше — перестаёт узнаваться как спрайт.
 */
function heatFilter(heat: number): string {
  const warm = Math.min(1, Math.max(0, heat));
  return warm > 0.03
    ? `brightness(${(1 + warm * 0.06).toFixed(3)}) sepia(${(warm * 0.12).toFixed(3)}) saturate(${(1 + warm * 0.1).toFixed(3)})`
    : '';
}

/** Фаза Лаборатории в оборотах: id короткий, но уже не равен у двух лабораторий. */
const labPhase = (lab: LabId): number => {
  let h = 0;
  for (let i = 0; i < lab.length; i += 1) h = (h * 31 + lab.charCodeAt(i)) % 1000;
  return h / 1000;
};

/**
 * Маскот на Сцене или в строке интерфейса.
 *
 * **Покачивание считается здесь, а не вешается классом.** Класс с анимацией пришлось бы гасить
 * ещё одним правилом в index.css, а файл не наш; здесь достаточно одного числа из `lastTick` —
 * того же тика, который двигает игру двадцать раз в секунду. Часы читаются только для
 * `animated`: в ростере и в списке магазина Маскот статичен, и подписка на тик была бы там
 * лишней. Подписка при этом — на готовый целый пиксель сдвига, а не на сами часы, поэтому
 * Маскот перерисовывается только когда сдвинулся.
 *
 * **Перегрев виден на самом Маскоте.** Покачивание теплеет тоном нагрева, а не только рамкой
 * Сцены: офис должен выглядеть прогретым в упор, иначе нагрев читается только по подписи. Тон
 * тот же, что у искр над шкалой, поэтому жар на картинке и на приборе не может разойтись.
 *
 * Раскладку, тень и счётчик под Маскотом считает OfficeColumn: это свойства стоящего в комнате,
 * а не спрайта, и здесь их повторять нельзя.
 */
const MascotSpriteView: React.FC<MascotProps> = ({
  lab,
  size = 32,
  animated = false,
  className = '',
}) => {
  const motion = useMotionAllowed();
  // Подписка на готовый сдвиг и готовый фильтр, а не на часы и перегрев: тик двигает оба числа
  // двадцать раз в секунду, а картинке нужен целый пиксель сдвига (четыре значения) и строка
  // фильтра, которая меняется на сотой доле жара. Поэтому Маскот перерисовывается тогда, когда
  // он действительно сдвинулся или потеплел.
  const bob = useGameStore((s) => (animated && motion ? mascotBob(s.state.lastTick, labPhase(lab)) : 0));
  const filter = useGameStore((s) => heatFilter(s.state.heat));

  return (
    <img
      src={MASCOT_SRC[lab]}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={className}
      // Маскот всегда стоит рядом с названием Лаборатории, поэтому картинка декоративная:
      // без aria-hidden озвучка читала бы «изображение» перед именем.
      aria-hidden="true"
      style={{
        imageRendering: 'pixelated',
        // transform только когда Маскот двигается: пустой style.transform на строке магазина
        // создавал бы лишний слой композиции без причины.
        ...(bob !== 0 ? { transform: `translateY(${bob}px)` } : undefined),
        ...(filter !== '' ? { filter } : undefined),
      }}
    />
  );
};

export const MascotSprite = React.memo(MascotSpriteView);
