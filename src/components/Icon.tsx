import React from 'react';

/**
 * Иконки интерфейса.
 *
 * Встроенный SVG на `currentColor`, а не эмодзи из системного шрифта: эмодзи рисуются
 * по-разному в разных ОС и спорят с пиксель-артом, а игре нужен значок, одинаковый везде.
 * Форма прямоугольная, как у Маскотов в `MascotSprite`, поэтому вместо сглаживания стоит
 * `shape-rendering: crispEdges`.
 *
 * Каждая иконка помечена `aria-hidden`: имя кнопки задаёт её подпись, а не картинка. Иначе
 * озвучка читала бы «график» перед «Инфо» и «кубок» перед «Достижения».
 */
export type IconName =
  | 'bolt'
  | 'chat'
  | 'office'
  | 'shop'
  | 'sound-on'
  | 'sound-off'
  | 'trophy'
  | 'info'
  | 'settings'
  | 'pause'
  | 'play'
  | 'next'
  /** Корона флагмана: та же решётка 16×16, что и остальные знаки. */
  | 'crown'
  /** Стрелка вверх: престиж и переход вверх по лестнице. */
  | 'rise'
  /** Стрелка вниз: охлаждение и спад. */
  | 'fall';

const ICONS: Record<IconName, React.ReactNode> = {
  bolt: (
    <>
      <rect x="9" y="1" width="3" height="4" />
      <rect x="7" y="5" width="3" height="4" />
      <rect x="5" y="9" width="4" height="3" />
      <rect x="7" y="12" width="3" height="3" />
    </>
  ),
  chat: (
    <>
      <rect x="1" y="3" width="14" height="2" />
      <rect x="1" y="5" width="2" height="6" />
      <rect x="13" y="5" width="2" height="6" />
      <rect x="3" y="11" width="12" height="2" />
      <rect x="3" y="13" width="2" height="2" />
    </>
  ),
  office: (
    <>
      <rect x="3" y="2" width="10" height="2" />
      <rect x="2" y="4" width="12" height="2" />
      <rect x="3" y="6" width="3" height="4" />
      <rect x="10" y="6" width="3" height="4" />
      <rect x="1" y="10" width="14" height="2" />
      <rect x="6" y="12" width="4" height="2" />
    </>
  ),
  shop: (
    <>
      <rect x="1" y="2" width="2" height="2" />
      <rect x="3" y="4" width="2" height="2" />
      <rect x="5" y="6" width="9" height="2" />
      <rect x="5" y="8" width="7" height="3" />
      <rect x="7" y="11" width="2" height="2" />
      <rect x="11" y="11" width="2" height="2" />
    </>
  ),
  'sound-on': (
    <>
      <rect x="1" y="7" width="2" height="2" />
      <rect x="3" y="5" width="2" height="6" />
      <rect x="5" y="3" width="2" height="10" />
      <rect x="8" y="5" width="2" height="2" />
      <rect x="8" y="9" width="2" height="2" />
      <rect x="11" y="1" width="2" height="5" />
      <rect x="11" y="10" width="2" height="5" />
    </>
  ),
  'sound-off': (
    <>
      <rect x="1" y="7" width="2" height="2" />
      <rect x="3" y="5" width="2" height="6" />
      <rect x="5" y="3" width="2" height="10" />
      <rect x="9" y="3" width="2" height="2" />
      <rect x="11" y="5" width="2" height="2" />
      <rect x="13" y="7" width="2" height="2" />
      <rect x="13" y="3" width="2" height="2" />
      <rect x="9" y="7" width="2" height="2" />
    </>
  ),
  trophy: (
    <>
      <rect x="4" y="2" width="8" height="2" />
      <rect x="3" y="4" width="10" height="4" />
      <rect x="5" y="8" width="6" height="1" />
      <rect x="1" y="4" width="2" height="3" />
      <rect x="13" y="4" width="2" height="3" />
      <rect x="7" y="9" width="2" height="3" />
      <rect x="4" y="12" width="8" height="2" />
    </>
  ),
  info: (
    <>
      <rect x="2" y="9" width="3" height="5" />
      <rect x="6" y="6" width="3" height="8" />
      <rect x="10" y="3" width="3" height="11" />
    </>
  ),
  settings: (
    <>
      <rect x="1" y="4" width="14" height="2" />
      <rect x="4" y="2" width="3" height="6" />
      <rect x="1" y="10" width="14" height="2" />
      <rect x="9" y="8" width="3" height="6" />
    </>
  ),
  pause: (
    <>
      <rect x="4" y="3" width="3" height="10" />
      <rect x="9" y="3" width="3" height="10" />
    </>
  ),
  play: <polygon points="4,2 14,8 4,14" />,
  next: (
    <>
      <rect x="2" y="3" width="2" height="3" />
      <rect x="4" y="6" width="2" height="4" />
      <rect x="2" y="10" width="2" height="3" />
      <rect x="8" y="3" width="2" height="3" />
      <rect x="10" y="6" width="2" height="4" />
      <rect x="8" y="10" width="2" height="3" />
    </>
  ),
  // Корона: три вершины и подошва. Вершины разной высоты — ровная гребёнка читалась бы
  // как забор, а корона без зубцов не отличима от любого другого знака в шапке.
  crown: (
    <>
      <rect x="2" y="6" width="3" height="3" />
      <rect x="7" y="3" width="3" height="6" />
      <rect x="12" y="6" width="3" height="3" />
      <rect x="2" y="10" width="13" height="3" />
      <rect x="6" y="13" width="5" height="2" />
    </>
  ),
  rise: (
    <>
      <rect x="7" y="2" width="3" height="9" />
      <rect x="4" y="8" width="9" height="3" />
    </>
  ),
  fall: (
    <>
      <rect x="7" y="6" width="3" height="9" />
      <rect x="4" y="6" width="9" height="3" />
    </>
  ),
};

export const Icon: React.FC<{ name: IconName; size?: number }> = ({ name, size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="currentColor"
    shapeRendering="crispEdges"
    aria-hidden="true"
    focusable="false"
    style={{ display: 'block', flexShrink: 0 }}
  >
    {ICONS[name]}
  </svg>
);
