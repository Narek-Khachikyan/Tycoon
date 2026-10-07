import React from 'react';

/**
 * Число внутри смешанной строки.
 *
 * Пиксельный шрифт остаётся только там, где нет кириллицы (ADR-0003), поэтому строка
 * вроде «+1,50 K к доходу» разбирается на части: число здесь, слово рядом в Nunito. Примитив
 * существует, чтобы правило не повторялось двадцатью одинаковыми `className="pixel-font"` и
 * чтобы его можно было нарушить в одном месте, а не в двадцати.
 *
 * `bump` — тактильный микро-отклик на смену значения (.num-bump), а при reducedMotion только
 * opacity-всплеск. Он ВЫКЛЮЧЕН по умолчанию и включается только там, где значение меняется
 * редко: тик идёт 20 раз в секунду, любое число, завязанное на кошелёк («не хватает N»
 * меняется на каждом тике), при пересоздании узла по key дёргалось бы непрерывно. Отклик
 * должен быть событием, а не фоном.
 */
const NumView: React.FC<{ children: React.ReactNode; className?: string; bump?: boolean }> = ({
  children,
  className,
  bump = false,
}) => {
  const textKey =
    bump && (typeof children === 'string' || typeof children === 'number')
      ? String(children)
      : undefined;

  return (
    <span
      key={textKey}
      className={`pixel-font${bump ? ' num-bump' : ''}${className ? ` ${className}` : ""}`}
    >
      {children}
    </span>
  );
};

/**
 * Число — лист дерева с двумя пропсами, и перерисовывать его, когда у родителя изменилась соседняя
 * строка, незачем: карточка Модели несёт шесть таких чисел, а меняется за раз одно.
 */
export const Num = React.memo(NumView);
