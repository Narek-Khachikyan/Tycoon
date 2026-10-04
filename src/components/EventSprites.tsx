import React from 'react';

/**
 * Спрайты случайных событий: Золотой токен, Глюк и Дрон с GPU.
 *
 * Встроенный SVG из прямоугольников, как Маскоты в `MascotSprite`: события нужны сразу в нескольких
 * размерах, и один спрайт тянется на все, тогда как растр пришлось бы дублировать под каждый размер.
 * Ни SMIL, ни keyframes внутри SVG — движение (вспышка токена,
 * пролёт дрона, дёрганье глюка) вешает вызывающий классом, и тогда оно снимается одним правилом
 * под `[data-motion='reduced']` вместе со всей остальной анимацией игры. SMIL оттуда не выключается.
 *
 * Цвета заданы литералами, а не CSS-переменными: спрайт должен читаться одинаково и в магазине на
 * `--bg-card`, и в пролёте над почти чёрным полом Сцены, где выбранная тема уже не управляет
 * контрастом картинки. Среднее золото `#e8a33d` и зелёный `#4fbf6a` — те же значения, что у
 * `--gold` и `--green`, чтобы Токен читался частью интерфейса, а не чужой иконкой.
 *
 * Здесь только картинка: ни onClick, ни таймеров. Если событие нужно нажать — кнопку делает
 * вызывающий компонент, а спрайт кладёт внутрь.
 */
export interface EventSpriteProps {
  size?: number;
  className?: string;
}

/** Золотой токен: случайная находка, которую игрок ловит кликом. */
export const GoldenToken: React.FC<EventSpriteProps> = ({ size = 32, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    shapeRendering="crispEdges"
    aria-hidden={true}
    focusable="false"
    role="presentation"
    className={className}
    style={{ display: 'block', imageRendering: 'pixelated' }}
  >
    {/* Тёмный ободок по всей окружности: у диска нет отдельной обводки, а на светлой подложке
        магазина без него Токен сливается с карточкой. */}
    <g fill="#6b3c0a">
      <rect x="11" y="6" width="10" height="2" />
      <rect x="9" y="8" width="14" height="2" />
      <rect x="7" y="10" width="18" height="2" />
      <rect x="6" y="12" width="20" height="2" />
      <rect x="5" y="14" width="22" height="4" />
      <rect x="6" y="18" width="20" height="2" />
      <rect x="7" y="20" width="18" height="2" />
      <rect x="9" y="22" width="14" height="2" />
      <rect x="11" y="24" width="10" height="2" />
    </g>
    {/* Лицевая сторона, отступ 2 px — ободок остаётся рамкой. */}
    <g fill="#e8a33d">
      <rect x="13" y="8" width="6" height="2" />
      <rect x="11" y="10" width="10" height="2" />
      <rect x="10" y="12" width="12" height="2" />
      <rect x="9" y="14" width="14" height="4" />
      <rect x="10" y="18" width="12" height="2" />
      <rect x="11" y="20" width="10" height="2" />
      <rect x="13" y="22" width="6" height="2" />
    </g>
    {/* Свет сверху-слева и тень снизу-справа: два тона на диске дают объём, однотонный диск
        читался бы как плоская наклейка. */}
    <g fill="#ffd166">
      <rect x="11" y="10" width="10" height="2" />
      <rect x="9" y="14" width="2" height="4" />
    </g>
    <g fill="#a5651a">
      <rect x="21" y="14" width="2" height="4" />
      <rect x="10" y="18" width="12" height="2" />
    </g>
    {/* Блик: ступенькой, а не точкой — в 32 px одиночный пиксель мылится при апскейле. */}
    <g fill="#fff6e0">
      <rect x="12" y="12" width="4" height="2" />
      <rect x="10" y="14" width="2" height="2" />
    </g>
  </svg>
);

/** Глюк: паразит, сосущий Доход, который игрок перезапускает. */
export const GlitchSprite: React.FC<EventSpriteProps> = ({ size = 28, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 28 28"
    shapeRendering="crispEdges"
    aria-hidden={true}
    focusable="false"
    role="presentation"
    className={className}
    style={{ display: 'block', imageRendering: 'pixelated' }}
  >
    {/* Зелёный контур рисуется первым и на +2 px вправо, −2 px вверх от фиолетового тела: в
        видимой части остаётся только кайма, и силуэт читается как «двойной», без отдельной
        анимации рассинхрона. */}
    <g fill="#22c55e">
      <rect x="12" y="4" width="2" height="3" />
      <rect x="18" y="4" width="2" height="3" />
      <rect x="11" y="7" width="10" height="2" />
      <rect x="8" y="9" width="16" height="2" />
      <rect x="6" y="11" width="20" height="8" />
      <rect x="9" y="19" width="14" height="2" />
      <rect x="12" y="21" width="8" height="2" />
    </g>
    <g fill="#6d28d9">
      <rect x="9" y="9" width="10" height="2" />
      <rect x="4" y="13" width="20" height="8" />
      <rect x="7" y="21" width="14" height="2" />
      <rect x="10" y="23" width="8" height="2" />
    </g>
    {/* Свет на «шапке»: глюк тёмный, без верхнего тона силуэт сливается с каймой. */}
    <rect x="6" y="11" width="16" height="2" fill="#7c3aed" />
    {/* Лапы и разрез рта — самый тёмный тон: паразит должен читаться чужим, а не игрокским. */}
    <g fill="#1b0b2e">
      <rect x="8" y="25" width="3" height="2" />
      <rect x="17" y="25" width="3" height="2" />
      <rect x="12" y="19" width="4" height="2" />
    </g>
    {/* Глаза белым с маджентовым сдвигом на 2 px: расщепление каналов вместо зрачка. */}
    <g fill="#ffffff">
      <rect x="8" y="15" width="3" height="2" />
      <rect x="17" y="15" width="3" height="2" />
    </g>
    <g fill="#e879f9">
      <rect x="10" y="15" width="3" height="2" />
      <rect x="19" y="15" width="3" height="2" />
      {/* Разрывы за краями силуэта: «съехавшие» строки кадра, из-за которых глюк и глючит. */}
      <rect x="1" y="17" width="7" height="2" />
      <rect x="20" y="20" width="7" height="2" />
    </g>
    {/* Строка развёртки над силуэтом — та же ошибка кадра, но одиночная и в другом месте. */}
    <rect x="2" y="7" width="9" height="1" fill="#ffffff" />
  </svg>
);

// Дрон — сплющенная 40×20 картинка: size означает ширину, и высоту приходится выводить из
// пропорции viewBox. В квадрате SVG отцентрировал бы дрон и оставил пустой бокс сверху и снизу,
// а с ним лишний размер в раскладке и область клика больше самой картинки.
const DRONE_VIEW_W = 40;
const DRONE_VIEW_H = 20;

/** Дрон с GPU: пролетает мимо и роняет Токены или множитель. */
export const GpuDrone: React.FC<EventSpriteProps> = ({ size = DRONE_VIEW_W, className }) => (
  <svg
    width={size}
    height={Math.round((size * DRONE_VIEW_H) / DRONE_VIEW_W)}
    viewBox={`0 0 ${DRONE_VIEW_W} ${DRONE_VIEW_H}`}
    shapeRendering="crispEdges"
    aria-hidden={true}
    focusable="false"
    role="presentation"
    className={className}
    style={{ display: 'block', imageRendering: 'pixelated' }}
  >
    {/* Корпус и хвостовая ферма. Нос справа: дрон летит туда, куда его выносит пролёт. */}
    <rect x="10" y="8" width="20" height="6" fill="#0f172a" />
    <rect x="11" y="9" width="18" height="4" fill="#334155" />
    <rect x="11" y="9" width="12" height="1" fill="#475569" />
    <rect x="6" y="10" width="4" height="2" fill="#334155" />
    <rect x="6" y="6" width="2" height="4" fill="#64748b" />
    {/* Мачта с огоньком: единственная деталь выше корпуса, из-за неё дрон узнаётся в проёме. */}
    <rect x="20" y="4" width="1" height="4" fill="#64748b" />
    <rect x="19" y="3" width="3" height="1" fill="#cbd5e1" />
    {/* Два вентилятора кольцами на борту: вид сбоку, поэтому они видны в разрезе, а не сверху.
        Отверстие — тёмное, а не дырка в разметке: так кольцо читается на любом фоне. */}
    <g>
      <rect x="12" y="7" width="6" height="6" fill="#64748b" />
      <rect x="22" y="7" width="6" height="6" fill="#64748b" />
      <rect x="13" y="8" width="4" height="4" fill="#0f172a" />
      <rect x="23" y="8" width="4" height="4" fill="#0f172a" />
      <g fill="#94a3b8">
        <rect x="13" y="9" width="4" height="1" />
        <rect x="14" y="8" width="1" height="4" />
        <rect x="23" y="9" width="4" height="1" />
        <rect x="24" y="8" width="1" height="4" />
      </g>
      <g fill="#cbd5e1">
        <rect x="14" y="9" width="2" height="2" />
        <rect x="24" y="9" width="2" height="2" />
      </g>
    </g>
    {/* Нос с объективом, зелёный индикатор (он и есть «дрон работает») и полоз. */}
    <rect x="30" y="9" width="5" height="3" fill="#475569" />
    <rect x="34" y="10" width="2" height="2" fill="#0f172a" />
    <rect x="28" y="10" width="2" height="2" fill="#4ade80" />
    <rect x="15" y="14" width="12" height="2" fill="#334155" />
  </svg>
);

/**
 * Реестр спрайтов событий: список имён живёт в одном месте, чтобы вызывающая сторона перебирала
 * набор событий, не повторяя его руками в своём коде — как `IconName` у иконок. Ключи совпадают с
 * ид события в экономике, поэтому перебор не требует отдельной карты «событие → спрайт».
 */
export const EVENT_SPRITES = {
  goldenToken: GoldenToken,
  glitch: GlitchSprite,
  gpuDrone: GpuDrone,
} as const;
