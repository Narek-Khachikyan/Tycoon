import React from 'react';
import type { LabId } from '../data/labs';

interface MascotProps {
  lab: LabId;
  size?: number;
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

export const MascotSprite: React.FC<MascotProps> = ({
  lab,
  size = 32,
  animated = false,
  className = '',
}) => {
  const animClass = animated ? 'animate-mascot-bob' : '';

  return (
    <img
      src={MASCOT_SRC[lab]}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`${animClass} ${className}`.trim()}
      // Маскот всегда стоит рядом с названием Лаборатории, поэтому картинка декоративная:
      // без aria-hidden озвучка читала бы «изображение» перед именем.
      aria-hidden="true"
      style={{ imageRendering: 'pixelated' }}
    />
  );
};
